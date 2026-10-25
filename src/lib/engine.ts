// NEXT Decision Intelligence Engine: a bounded, observable workflow over typed tools.
// Stages: context → investigation → simulation → challenger (≤ maxIterations) → decision → action.

import { valueKind, getCustomer, type CustomerProfile, type GoalId } from './data.ts'
import { usd } from './finance.ts'
import { AssumptionsSchema, defaultAssumptions, type Assumptions, type ScenarioResult } from './scenarios.ts'
import { decide, deterministicExplanation, preliminaryPick, type ComparisonRow, type Finding, type ProposedAction, type RankEntry, type Recommendation, type Signal, type Validation } from './decision.ts'
import { invokeTool, ToolError, type Stage, type ToolContext, type ToolName } from './tools.ts'

export type StepStatus = 'pending' | 'running' | 'completed' | 'needs_attention' | 'failed'

export interface StepRecord {
  id: string; executionId: string; seq: number; stage: Stage; label: string; toolName: string | null
  status: StepStatus; inputSummary: string; outputSummary: string; validationFindings: Finding[] | null
  timestamp: string; durationMs: number
}

export type WorkflowEvent = { type: 'stage'; stage: Stage; status: StepStatus } | { type: 'step'; step: StepRecord }

export interface ExplainFacts {
  customerName: string; goal: GoalId; recommendedAction: string; headline: string
  reasons: string[]; tradeoffs: string[]; qualifications: string[]
  scenarios: { label: string; monthlyPayment: number | null; netCostOverHorizon: number | null; lifetimeCost: number | null }[]
  horizonMonths: number
}
export type Explainer = (facts: ExplainFacts, signal: AbortSignal) => Promise<string>

export interface DecisionBrief {
  customerId: string; financingType: 'loan' | 'lease'; goal: GoalId; goalSource: 'customer input' | 'request' | 'profile'
  decisionProblem: string; hardConstraints: string[]; preferences: string[]
  known: { field: string; value: string; provenance: string }[]; missing: string[]
}

export interface RecommendationVersion { version: number; kind: 'preliminary' | 'revised'; scenarioId: string; label: string; reason: string }

export interface WorkflowResult {
  executionId: string; customerId: string; status: 'completed' | 'needs_attention' | 'failed'; error?: string
  assumptions: Assumptions | null; brief: DecisionBrief | null
  scenarios: ScenarioResult[]; comparison: ComparisonRow[]; ranking: RankEntry[]
  validations: Validation[]; versions: RecommendationVersion[]; iterations: number
  recommendation: Omit<Recommendation, 'id' | 'version' | 'createdAt'> | null
  signals: Signal[]; plan: ProposedAction[]
  steps: StepRecord[]; stageStatus: Record<Stage, StepStatus>
  startedAt: string; completedAt: string
}

export interface RunOptions {
  customerId: string
  request?: string
  overrides?: Partial<Assumptions>
  explainer?: Explainer | null
  explainTimeoutMs?: number
  recallWatch?: ((v: CustomerProfile['vehicle'], signal: AbortSignal) => Promise<Signal | null>) | null
  maxIterations?: number
  faults?: ToolContext['faults']
  executionId?: string
  onEvent?: (e: WorkflowEvent) => void
}

export const MAX_ITERATIONS = 4
const GOAL_LABEL: Record<GoalId, string> = {
  lower_payment: 'Lower my monthly payment', minimize_cost: 'Minimize total modeled cost', replace_vehicle: 'Replace my vehicle',
  lease_end: 'Decide what to do at lease end', understand_options: 'Understand my options',
}
export const goalLabel = (g: GoalId) => GOAL_LABEL[g]

/** Context Agent request parsing. Customer text is data: it can set a goal or target, never instructions. */
export function parseRequest(text: string | undefined): { goal?: GoalId; paymentTarget?: number } {
  const t = (text ?? '').slice(0, 500).toLowerCase()
  const out: { goal?: GoalId; paymentTarget?: number } = {}
  if (/lease/.test(t) && /(end|return|buy|turn in|over)/.test(t)) out.goal = 'lease_end'
  else if (/(lower|reduce|cut|drop|cheaper|smaller|afford).{0,30}payment|payment.{0,30}(lower|under|below|less)/.test(t)) out.goal = 'lower_payment'
  else if (/(trade|replace|upgrade|new (car|vehicle|suv|truck))/.test(t)) out.goal = 'replace_vehicle'
  else if (/(total cost|overall cost|cheapest overall|minimi[sz]e|save the most|least interest)/.test(t)) out.goal = 'minimize_cost'
  else if (/(options|what can i do|next move)/.test(t)) out.goal = 'understand_options'
  const m = t.match(/(?:under|below|less than|at most|to|around|about|max(?:imum)?)\s*\$?\s*(\d{2,5}(?:,\d{3})?)(?!\s*(?:months|mo\b|miles|k\b|%))/)
  if (m) { const n = Number(m[1].replace(/,/g, '')); if (n >= 50 && n <= 5000) out.paymentTarget = n }
  return out
}

interface PlannedCall { tool: ToolName; args: Record<string, unknown>; reason: string }

/** Investigation Agent: chooses only the scenarios relevant to this customer and goal. */
export function planInvestigation(c: CustomerProfile, a: Assumptions, loanKnown: boolean) {
  const calls: PlannedCall[] = [], skipped: { scenario: string; reason: string }[] = []
  const base = { customerId: c.id, assumptions: a }
  if (c.financing.financingType === 'lease') {
    calls.push({ tool: 'simulate_lease_end', args: { ...base, option: 'return' }, reason: 'Lease account: model return + replacement' })
    if (c.financing.purchaseOptionPrice != null) calls.push({ tool: 'simulate_lease_end', args: { ...base, option: 'buyout' }, reason: 'Purchase option price on file' })
    else skipped.push({ scenario: 'Lease buyout', reason: 'Purchase option price not on file' })
    calls.push({ tool: 'simulate_trade_in', args: base, reason: 'Check whether lease equity could reduce a replacement loan' })
    skipped.push({ scenario: 'Refinancing', reason: 'Not applicable to a lease' })
  } else {
    if (!loanKnown) skipped.push({ scenario: 'Keep / refinance', reason: 'Loan position could not be calculated' })
    else {
      calls.push({ tool: 'simulate_keep_vehicle', args: base, reason: 'Baseline: current loan unchanged' })
      if (a.goal === 'replace_vehicle') skipped.push({ scenario: 'Refinancing', reason: 'Goal is to replace the vehicle' })
      else if ((c.financing.currentBalance ?? 0) <= 0) skipped.push({ scenario: 'Refinancing', reason: 'Loan is paid in full' })
      else {
        const rem = c.financing.remainingMonths ?? 0
        const terms = [...new Set([a.refiTermMonths, rem + 12, 72])].filter(t => t > rem && t <= 84).sort((x, y) => x - y)
        for (const t of terms) calls.push({ tool: 'simulate_refinancing', args: { ...base, termMonths: t }, reason: `Illustrative ${t}-month term at ${a.refiAprPct}% (customer’s own rate unless changed)` })
        if (!terms.length) skipped.push({ scenario: 'Refinancing', reason: 'No longer term than the remaining term is in range' })
      }
    }
    calls.push({ tool: 'simulate_trade_in', args: base, reason: a.goal === 'replace_vehicle' ? 'Stated goal: replace the vehicle' : 'Check whether a lower-priced vehicle fits the goal' })
    skipped.push({ scenario: 'Lease return / buyout', reason: 'Conventional loan, not a lease' })
  }
  if (a.goal === 'lower_payment' || a.goal === 'understand_options') calls.push({ tool: 'simulate_support_options', args: base, reason: 'Options NEXT cannot evaluate (TFS specialist)' })
  return { calls, skipped }
}

const id = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`

function withTimeout<T>(f: (s: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => { ctl.abort(); reject(new Error(`timed out after ${ms} ms`)) }, ms)
    f(ctl.signal).then(v => { clearTimeout(t); resolve(v) }, e => { clearTimeout(t); reject(e) })
  })
}

export async function runWorkflow(o: RunOptions): Promise<WorkflowResult> {
  const executionId = o.executionId ?? id('exe')
  const startedAt = new Date().toISOString()
  const steps: StepRecord[] = []
  const stageStatus = Object.fromEntries(['context', 'investigation', 'simulation', 'challenger', 'decision', 'action'].map(s => [s, 'pending'])) as Record<Stage, StepStatus>
  const res: WorkflowResult = {
    executionId, customerId: o.customerId, status: 'completed', assumptions: null, brief: null, scenarios: [], comparison: [], ranking: [],
    validations: [], versions: [], iterations: 0, recommendation: null, signals: [], plan: [], steps, stageStatus, startedAt, completedAt: startedAt,
  }
  const setStage = (stage: Stage, status: StepStatus) => { stageStatus[stage] = status; o.onEvent?.({ type: 'stage', stage, status }) }
  const record = (p: Omit<StepRecord, 'id' | 'executionId' | 'seq' | 'timestamp' | 'durationMs' | 'validationFindings'> & { durationMs?: number; validationFindings?: Finding[] | null }) => {
    const s: StepRecord = { id: id('stp'), executionId, seq: steps.length + 1, timestamp: new Date().toISOString(), durationMs: 0, validationFindings: null, ...p }
    steps.push(s); o.onEvent?.({ type: 'step', step: s }); return s
  }
  const call = <N extends ToolName>(stage: Stage, label: string, tool: N, input: unknown, inputSummary: string, summarize: (out: ReturnType<typeof invokeTool<N>>) => string, findings?: (out: ReturnType<typeof invokeTool<N>>) => Finding[]) => {
    const t0 = performance.now()
    try {
      const out = invokeTool(tool, input, { stage, faults: o.faults })
      record({ stage, label, toolName: tool, status: 'completed', inputSummary, outputSummary: summarize(out), validationFindings: findings?.(out) ?? null, durationMs: Math.round(performance.now() - t0) })
      return out
    } catch (e) {
      const msg = e instanceof ToolError ? `${e.kind}: ${e.message}` : String(e)
      record({ stage, label, toolName: tool, status: 'failed', inputSummary, outputSummary: msg, durationMs: Math.round(performance.now() - t0) })
      throw e
    }
  }
  const note = (stage: Stage, label: string, status: StepStatus, outputSummary: string, inputSummary = '') => record({ stage, label, toolName: null, status, inputSummary, outputSummary })
  const scen = (s: unknown) => s as ScenarioResult

  try {
    // ---- CONTEXT AGENT
    setStage('context', 'running')
    const ctx = call('context', 'Retrieve customer context', 'get_customer_context', { customerId: o.customerId }, `customerId=${o.customerId}`,
      out => `${(out.customer as unknown as CustomerProfile).displayName}; missing on file: ${out.missingFields.join(', ') || 'none'}`)
    const c = ctx.customer as unknown as CustomerProfile
    const parsed = parseRequest(o.request ?? c.goalText)
    const a = AssumptionsSchema.parse({ ...defaultAssumptions(c), ...parsed, ...o.overrides })
    res.assumptions = a
    const goalSource: DecisionBrief['goalSource'] = o.overrides?.goal ? 'customer input' : parsed.goal ? 'request' : 'profile'
    const f = c.financing
    const brief: DecisionBrief = {
      customerId: c.id, financingType: f.financingType, goal: a.goal, goalSource,
      decisionProblem: `${goalLabel(a.goal)} for a ${c.vehicle.year} ${c.vehicle.model} ${f.financingType}, evaluated over ${a.horizonMonths} months.`,
      hardConstraints: [`Payment ≤ monthly budget ${usd(a.monthlyBudget)}`, ...(a.goal === 'lower_payment' ? [`Payment ≤ target ${usd(a.paymentTarget)}`] : []), ...(a.goal === 'replace_vehicle' ? ['Must replace the vehicle'] : []), 'No unsupported offers, rates or eligibility'],
      preferences: ['Minimize net modeled cost over the horizon', 'Avoid unnecessary new debt', ...(a.keepVehicle ? ['Keep the current vehicle'] : [])],
      known: [
        { field: 'Monthly payment', value: usd(f.monthlyPayment), provenance: 'supplied' },
        ...(f.currentBalance != null ? [{ field: 'Balance', value: usd(f.currentBalance), provenance: 'supplied' }] : []),
        ...(f.remainingMonths != null ? [{ field: 'Remaining term', value: `${f.remainingMonths} mo`, provenance: 'supplied' }] : []),
        ...(f.interestRate != null ? [{ field: 'APR', value: `${f.interestRate}%`, provenance: 'supplied' }] : []),
        ...(f.leaseEndDate ? [{ field: 'Lease end', value: f.leaseEndDate, provenance: 'supplied' }] : []),
        { field: 'Vehicle value', value: usd(a.vehicleValue), provenance: ({ supplied: 'your estimate', synthetic: 'synthetic estimate', illustrative: 'customer-adjusted' } as const)[valueKind(c, a.vehicleValue)] },
      ],
      missing: ctx.missingFields.map(m => ({ interestRate: 'Interest rate (APR)', dispositionFee: 'Lease disposition fee', excessMileageRate: 'Excess-mileage rate', purchaseOptionPrice: 'Purchase option price' } as Record<string, string>)[m] ?? m),
    }
    res.brief = brief
    note('context', 'Build decision brief', brief.missing.length ? 'needs_attention' : 'completed',
      `Goal: ${goalLabel(a.goal)} (from ${goalSource}). Hard: ${brief.hardConstraints.slice(0, 2).join('; ')}. Missing: ${brief.missing.join(', ') || 'none'}.`,
      `request: "${(o.request ?? c.goalText).slice(0, 120)}"`)
    setStage('context', brief.missing.length ? 'needs_attention' : 'completed')

    // ---- INVESTIGATION AGENT
    setStage('investigation', 'running')
    let loanKnown = f.financingType === 'loan'
    if (f.financingType === 'loan') {
      try {
        call('investigation', 'Calculate current loan position', 'calculate_current_loan_position', { customerId: c.id, horizonMonths: a.horizonMonths }, `horizon=${a.horizonMonths}`,
          out => `APR ${out.aprPct}% (${out.aprKind}); ${usd(out.scheduledPayments)} scheduled over horizon; ${usd(out.balanceAtHorizon)} left at month ${a.horizonMonths}${out.warnings.length ? '. ' + out.warnings[0] : ''}`)
      } catch { loanKnown = false }
    }
    const plan = planInvestigation(c, a, loanKnown)
    note('investigation', 'Select scenarios', 'completed', `Investigate: ${plan.calls.map(p => p.reason.split(':')[0]).join(' · ')}. Skipped: ${plan.skipped.map(s => `${s.scenario} (${s.reason})`).join('; ') || 'none'}.`)
    setStage('investigation', 'completed')

    // ---- FINANCIAL SIMULATION
    setStage('simulation', 'running')
    let simFailed = false
    const runSim = (p: PlannedCall, stage: Stage = 'simulation') => {
      try {
        const s = scen(call(stage, `Simulate: ${p.reason}`, p.tool, p.args, `${p.tool}(${Object.entries(p.args).filter(([k]) => !['assumptions', 'customerId'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', ') || 'defaults'})`,
          out => { const r = scen(out); return r.computed ? `${r.label}: ${usd(r.monthlyPayment)}/mo · ${usd(r.netCostOverHorizon)} net over ${r.horizonMonths} mo · ${usd(r.lifetimeCost)} lifetime` : `${r.label}: non-financial option` }))
        res.scenarios.push(s); return s
      } catch { simFailed = true; return null }
    }
    for (const p of plan.calls) runSim(p)

    // Investigation follow-up: if nothing meets a lower-payment target, try the longest illustrative term once.
    const meets = () => res.scenarios.some(s => s.monthlyPayment != null && s.monthlyPayment <= a.paymentTarget + 0.5)
    if (a.goal === 'lower_payment' && !meets() && loanKnown && !res.scenarios.some(s => s.key === 'refinance:84')) {
      note('investigation', 'Request additional scenario', 'needs_attention', `No scenario reaches ${usd(a.paymentTarget)}. Requesting an 84-month illustration before concluding.`)
      runSim({ tool: 'simulate_refinancing', args: { customerId: c.id, assumptions: a, termMonths: 84 }, reason: 'Illustrative 84-month term (follow-up)' })
    }
    res.comparison = call('simulation', 'Compare scenarios', 'compare_scenarios', { scenarios: res.scenarios, assumptions: a }, `${res.scenarios.length} scenarios, ${a.horizonMonths}-month horizon`,
      out => `${out.length} comparable rows; ${(out as unknown as ComparisonRow[]).filter(r => r.meetsTarget).length} meet the ${usd(a.paymentTarget)} target`) as unknown as ComparisonRow[]
    setStage('simulation', simFailed ? 'needs_attention' : 'completed')

    // ---- CHALLENGER (bounded loop)
    setStage('challenger', 'running')
    const support = res.scenarios.find(s => s.type === 'support')
    const prelim = preliminaryPick(res.scenarios, a)
    let candidate = prelim?.id ?? support?.id ?? res.scenarios[0]?.id
    if (!candidate) throw new Error('No scenarios could be produced')
    const label = (sid: string) => res.scenarios.find(s => s.id === sid)?.label ?? sid
    res.versions.push({ version: 1, kind: 'preliminary', scenarioId: candidate, label: label(candidate), reason: a.goal === 'lower_payment' || a.goal === 'lease_end' ? 'Lowest monthly payment' : a.goal === 'replace_vehicle' ? 'Replaces the vehicle' : 'Lowest net modeled cost' })
    note('challenger', 'Preliminary recommendation', 'completed', `${label(candidate)} (${res.versions[0].reason})`)
    const max = o.maxIterations ?? MAX_ITERATIONS
    let v: Validation | null = null
    while (res.iterations < max) {
      res.iterations++
      v = call('challenger', `Challenge #${res.iterations}: ${label(candidate)}`, 'validate_recommendation', { candidateId: candidate, scenarios: res.scenarios, assumptions: a }, `candidate=${candidate}`,
        out => `${out.status.toUpperCase()}: ${(out as unknown as Validation).findings.filter(x => x.severity !== 'pass').map(x => x.code).join(', ') || 'all checks passed'}`,
        out => (out as unknown as Validation).findings) as unknown as Validation
      res.validations.push(v)
      if (v.status === 'revise' && v.betterScenarioId) {
        candidate = v.betterScenarioId
        res.versions.push({ version: res.versions.length + 1, kind: 'revised', scenarioId: candidate, label: label(candidate), reason: v.findings.find(x => x.code === 'BETTER_TRADEOFF' && x.severity === 'material')?.message ?? 'Hard constraint' })
        note('challenger', 'Recommendation revised', 'needs_attention', `Material issue found → re-evaluating with ${label(candidate)}`)
        continue
      }
      if (v.requiredRecalculations.length) {
        for (const r of v.requiredRecalculations) {
          const src = res.scenarios.find(s => s.id === r.scenarioId)!
          runSim(src.type === 'refinance'
            ? { tool: 'simulate_refinancing', args: { customerId: c.id, assumptions: a, termMonths: (src.inputSnapshot as { termMonths: number }).termMonths, aprPct: r.aprPct, sensitivityOf: src.id }, reason: `Rate sensitivity: ${r.aprPct}%` }
            : { tool: 'simulate_trade_in', args: { customerId: c.id, assumptions: a, aprPct: r.aprPct, sensitivityOf: src.id }, reason: `Rate sensitivity: ${r.aprPct}%` }, 'challenger')
        }
        continue
      }
      break
    }
    if (!v) throw new Error('Challenger did not run')
    const unresolved = v.status === 'revise' || v.requiredRecalculations.length > 0
    if (unresolved) {
      note('challenger', 'Iteration limit reached', 'needs_attention', `Stopped after ${max} iteration(s); recommendation is presented with qualifications.`)
      v = { ...v, qualifications: [...v.qualifications, `Validation stopped at the ${max}-iteration limit before every issue was resolved.`] }
    }
    setStage('challenger', unresolved || v.status === 'blocked' ? 'needs_attention' : 'completed')

    // ---- DECISION AGENT
    setStage('decision', 'running')
    res.ranking = call('decision', 'Rank scenarios', 'rank_scenarios', { scenarios: res.scenarios, assumptions: a }, 'hard constraints → score',
      out => `${(out as unknown as RankEntry[]).filter(r => r.eligible).length} eligible; top: ${(out as unknown as RankEntry[])[0]?.label}`) as unknown as RankEntry[]
    const draft = decide(c, res.scenarios, a, candidate, v)
    let explanation = deterministicExplanation(draft), source: 'llm' | 'deterministic' = 'deterministic'
    if (o.explainer) {
      const t0 = performance.now()
      const facts: ExplainFacts = {
        customerName: c.displayName.split(' ')[0], goal: a.goal, recommendedAction: draft.recommendedAction, headline: draft.headline,
        reasons: draft.reasons, tradeoffs: draft.tradeoffs, qualifications: draft.qualifications, horizonMonths: a.horizonMonths,
        scenarios: res.scenarios.filter(s => !s.sensitivityOf).map(s => ({ label: s.label, monthlyPayment: s.monthlyPayment, netCostOverHorizon: s.netCostOverHorizon, lifetimeCost: s.lifetimeCost })),
      }
      try {
        explanation = await withTimeout(sig => o.explainer!(facts, sig), o.explainTimeoutMs ?? 12000); source = 'llm'
        record({ stage: 'decision', label: 'Compose explanation', toolName: 'llm.explain', status: 'completed', inputSummary: 'validated facts only', outputSummary: 'LLM explanation passed the number-grounding check', durationMs: Math.round(performance.now() - t0) })
      } catch (e) {
        record({ stage: 'decision', label: 'Compose explanation', toolName: 'llm.explain', status: 'needs_attention', inputSummary: 'validated facts only', outputSummary: `LLM unavailable (${(e as Error).message}); used deterministic explanation`, durationMs: Math.round(performance.now() - t0) })
      }
    } else note('decision', 'Compose explanation', 'completed', 'Deterministic explanation (no LLM configured)')
    res.recommendation = { ...draft, explanation, explanationSource: source }
    note('decision', 'Validated recommendation', v.status === 'blocked' ? 'needs_attention' : 'completed', `${draft.recommendedAction} · ${v.status}${draft.qualifications.length ? ` with ${draft.qualifications.length} qualification(s)` : ''}`)
    setStage('decision', v.status === 'blocked' ? 'needs_attention' : 'completed')

    // ---- ACTION AGENT
    setStage('action', 'running')
    res.signals = call('action', 'Evaluate signals', 'detect_signals', { customerId: c.id, assumptions: a, scenarios: res.scenarios, validation: v }, 'rules over profile + scenarios',
      out => `${out.length} signal(s): ${out.map(s => s.title).join('; ')}`) as unknown as Signal[]
    if (o.recallWatch) {
      const t0 = performance.now()
      try {
        const s = await withTimeout(sig => o.recallWatch!(c.vehicle, sig), 10000)
        if (s) res.signals = [...res.signals, s]
        record({ stage: 'action', label: 'Recall Watch', toolName: 'serp.recalls', status: 'completed', inputSummary: `${c.vehicle.year} ${c.vehicle.model} news`, outputSummary: s ? `Recall headline found: ${s.description}` : 'No recall headlines for this model year', durationMs: Math.round(performance.now() - t0) })
      } catch (e) {
        // optional external check: a failure is logged, never fails the decision
        record({ stage: 'action', label: 'Recall Watch', toolName: 'serp.recalls', status: 'completed', inputSummary: `${c.vehicle.year} ${c.vehicle.model} news`, outputSummary: `Skipped: ${(e as Error).message}`, durationMs: Math.round(performance.now() - t0) })
      }
    }
    res.plan = call('action', 'Prepare action plan', 'prepare_action_plan', { customerId: c.id, recommendation: draft, scenarios: res.scenarios }, 'proposals only',
      out => `${out.length} proposed step(s): ${out.map(p => p.title).join('; ')}. Awaiting customer confirmation.`) as unknown as ProposedAction[]
    setStage('action', 'completed')

    res.status = Object.values(stageStatus).includes('needs_attention') ? 'needs_attention' : 'completed'
  } catch (e) {
    res.status = 'failed'; res.error = e instanceof Error ? e.message : String(e)
    const running = (Object.entries(stageStatus).find(([, s]) => s === 'running')?.[0] ?? 'context') as Stage
    setStage(running, 'failed')
  }
  res.completedAt = new Date().toISOString()
  return res
}

export const getCustomerOrThrow = (cid: string) => { const c = getCustomer(cid); if (!c) throw new Error('Unknown customer'); return c }
