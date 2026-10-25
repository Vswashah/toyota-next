// TFS team console: turns stored customer workflows into a pipeline Toyota can act on.
// Counts, volumes and stages come from recorded executions; income uses one explicit, adjustable margin assumption.
import { CUSTOMERS, getCustomer, registerCohort, type CustomerProfile } from './data.ts'
import { store } from './db.ts'
import { generateCohort } from './impact.ts'
import { runWorkflow, type WorkflowResult } from './engine.ts'
import type { ScenarioResult } from './scenarios.ts'

export type OpportunityType = 'new_vehicle_financing' | 'lease_buyout_financing' | 'account_restructure' | 'retained' | 'retention_risk' | 'none'

export const OPPORTUNITY: Record<OpportunityType, { label: string; meaning: string }> = {
  new_vehicle_financing: { label: 'New vehicle + financing', meaning: 'Vehicle sale lead for a dealer and a new TFS loan' },
  lease_buyout_financing: { label: 'Lease buyout financing', meaning: 'Lease converts to a TFS purchase loan; customer keeps the Toyota' },
  account_restructure: { label: 'Account restructure', meaning: 'Customer stays with TFS on a new term instead of falling behind or leaving' },
  retained: { label: 'Retained as is', meaning: 'Current account fits; nothing to sell, service effort avoided' },
  retention_risk: { label: 'Retention risk', meaning: 'No modeled option fits; specialist outreach protects the account' },
  none: { label: 'Not yet evaluated', meaning: 'No recommendation recorded yet' },
}

export function opportunityOf(scenarioKey: string | undefined): OpportunityType {
  const k = scenarioKey?.split(':')[0]
  return k === 'trade_in' || k === 'lease_return' ? 'new_vehicle_financing' : k === 'lease_buyout' ? 'lease_buyout_financing'
    : k === 'refinance' ? 'account_restructure' : k === 'keep' ? 'retained' : k === 'support' ? 'retention_risk' : 'none'
}

/** Hypothetical net finance income: amount financed × annual margin × average life (half the term, since balances amortize). */
export function financeIncome(s: Pick<ScenarioResult, 'amountFinanced' | 'inputSnapshot'> | undefined, marginPct: number) {
  const term = Number((s?.inputSnapshot as { termMonths?: number } | undefined)?.termMonths ?? 0)
  if (!s?.amountFinanced || !term) return 0
  return Math.round(s.amountFinanced * (marginPct / 100) * (term / 12) / 2)
}

type Row = Record<string, unknown>

export function adminOverview(marginPct = 2) {
  const db = store()
  const q = <T = Row>(sql: string, ...a: (string | number)[]) => db.db.prepare(sql).all(...a) as T[]
  const customers = CUSTOMERS.map(base => {
    const c = getCustomer(base.id)!
    const rec = db.listRecommendations(c.id, 1)[0] ?? null
    const execs = q<{ n: number; last: string }>(`SELECT COUNT(*) n, MAX(started_at) last FROM agent_execution WHERE customer_id=?`, c.id)[0]
    const asks = q<{ n: number }>(`SELECT COUNT(*) n FROM agent_step s JOIN agent_execution e ON e.id=s.execution_id WHERE e.customer_id=? AND s.label IN ('Answer question','What-if simulation')`, c.id)[0].n
    const actions = db.listActions(c.id)
    const scen = rec ? db.getScenarios([rec.scenarioId])[0] : undefined
    const type = opportunityOf(rec?.scenarioKey)
    const balance = c.financing.currentBalance ?? c.financing.purchaseOptionPrice ?? 0
    const volume = type === 'retention_risk' ? balance : type === 'retained' || type === 'none' ? 0 : scen?.amountFinanced ?? 0
    const live = actions.filter(a => a.status !== 'cancelled')
    const handoff = type === 'retention_risk' || live.some(a => a.actionType === 'human_handoff')
    const stage = !rec ? 'not_started' : live.some(a => a.status === 'completed') ? 'completed' : live.length ? 'action_selected' : execs.n > 1 || asks > 0 ? 'engaged' : 'identified'
    return {
      customerId: c.id, name: c.displayName, persona: c.persona, vehicle: `${c.vehicle.year} ${c.vehicle.model} ${c.vehicle.trim}`,
      financingType: c.financing.financingType, payment: c.financing.monthlyPayment, budget: c.monthlyBudget, goalText: c.goalText,
      recommendation: rec && { action: rec.recommendedAction, headline: rec.headline, status: rec.status, version: rec.version, qualifications: rec.qualifications.length, createdAt: rec.createdAt },
      opportunity: { type, ...OPPORTUNITY[type], volume, income: type === 'retention_risk' ? 0 : financeIncome(scen, marginPct) },
      stage, route: handoff ? 'specialist' : 'self-service', executions: execs.n, questions: asks, lastActivity: execs.last,
      actions: { open: live.filter(a => a.status === 'open').length, completed: live.filter(a => a.status === 'completed').length, teamFollowUps: live.filter(a => a.title.startsWith('TFS team:')).length },
    }
  })

  const evaluated = customers.filter(c => c.recommendation)
  const pay = q<{ n: number; total: number }>(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) total FROM payment`)[0]
  const autopay = q<{ n: number }>(`SELECT COUNT(*) n FROM account_setting WHERE autopay=1`)[0].n
  const steps = q<Row>(`SELECT s.*, e.customer_id FROM agent_step s JOIN agent_execution e ON e.id=s.execution_id ORDER BY s.timestamp DESC, s.seq DESC LIMIT 40`)
  const trust = q<{ revised: number; total: number }>(`SELECT SUM(CASE WHEN versions LIKE '%"revised"%' THEN 1 ELSE 0 END) revised, COUNT(*) total FROM agent_execution`)[0]
  const stepStats = q<{ failed: number; fallbacks: number; total: number }>(`SELECT SUM(status='failed') failed, SUM(tool_name='llm.explain' AND status='needs_attention') fallbacks, COUNT(*) total FROM agent_step`)[0]

  return {
    marginPct,
    kpis: {
      customers: CUSTOMERS.length, evaluated: evaluated.length,
      engaged: customers.filter(c => ['engaged', 'action_selected', 'completed'].includes(c.stage)).length,
      actionSelected: customers.filter(c => ['action_selected', 'completed'].includes(c.stage)).length,
      completed: customers.filter(c => c.stage === 'completed').length,
      selfService: evaluated.filter(c => c.route === 'self-service').length, specialist: evaluated.filter(c => c.route === 'specialist').length,
      pipelineVolume: customers.filter(c => c.opportunity.type !== 'retention_risk').reduce((s, c) => s + c.opportunity.volume, 0),
      balanceAtRisk: customers.filter(c => c.opportunity.type === 'retention_risk').reduce((s, c) => s + c.opportunity.volume, 0),
      estIncome: customers.reduce((s, c) => s + c.opportunity.income, 0),
      vehicleLeads: customers.filter(c => c.opportunity.type === 'new_vehicle_financing').length,
      paymentsCount: pay.n, paymentsTotal: Math.round(pay.total * 100) / 100, autopayEnrolled: autopay,
    },
    customers,
    activity: steps.map(s => ({ id: String(s.id), customer: getCustomer(String(s.customer_id))?.displayName ?? String(s.customer_id), stage: String(s.stage), label: String(s.label), tool: (s.tool_name as string) ?? null, status: String(s.status), summary: String(s.output_summary ?? ''), at: String(s.timestamp) })),
    trust: {
      workflows: trust.total ?? 0, challengerRevised: trust.revised ?? 0,
      qualifiedShare: evaluated.length ? evaluated.filter(c => (c.recommendation?.qualifications ?? 0) > 0).length / evaluated.length : 0,
      toolFailures: stepStats.failed ?? 0, llmFallbacks: stepStats.fallbacks ?? 0, stepsRecorded: stepStats.total ?? 0,
    },
    formulas: {
      volume: 'Amount financed in the recommended scenario (engine output). Retention risk shows the balance on the account instead.',
      income: `HYPOTHETICAL: amount financed × ${marginPct}% assumed annual net margin × (term ÷ 2 years). Not a forecast.`,
      stage: 'Identified = recommendation recorded · Engaged = re-ran scenarios or asked NEXT · Action selected = added a next step · Completed = finished a step',
    },
  }
}

/** The same pipeline computed by the real engine over the seeded synthetic cohort (Impact Lab cohort). */
const cohortCache = new Map<string, Promise<{ customers: CustomerProfile[]; runs: WorkflowResult[] }>>()
const cohortRuns = (size: number, seed: number) => {
  const k = `${size}:${seed}`
  if (!cohortCache.has(k)) cohortCache.set(k, (async () => {
    const customers = generateCohort(size, seed) // same seeded cohort as the Impact Lab
    registerCohort(customers)
    return { customers, runs: await Promise.all(customers.map(c => runWorkflow({ customerId: c.id }))) }
  })())
  return cohortCache.get(k)!
}

export async function cohortPipeline(marginPct = 2, size = 200, seed = 7) {
  const { customers, runs } = await cohortRuns(size, seed)
  const mix = new Map<OpportunityType, { count: number; volume: number; income: number }>()
  for (const [i, r] of runs.entries()) {
    const type = opportunityOf(r.recommendation?.scenarioKey)
    const s = r.scenarios.find(x => x.id === r.recommendation?.scenarioId)
    const c = customers[i]
    const m = mix.get(type) ?? { count: 0, volume: 0, income: 0 }
    m.count++
    m.volume += type === 'retention_risk' ? c.financing.currentBalance ?? c.financing.purchaseOptionPrice ?? 0 : type === 'retained' ? 0 : s?.amountFinanced ?? 0
    m.income += type === 'retention_risk' ? 0 : financeIncome(s, marginPct)
    mix.set(type, m)
  }
  return { size: customers.length, mix: [...mix.entries()].map(([type, v]) => ({ type, label: OPPORTUNITY[type].label, ...v, volume: Math.round(v.volume), income: Math.round(v.income) })).sort((a, b) => b.count - a.count) }
}
