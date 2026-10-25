import type { CustomerProfile } from './data.ts'
import { usd } from './finance.ts'
import { leaseFacts, type Assumptions, type ScenarioResult } from './scenarios.ts'

// ---------- Comparison ----------

export interface ComparisonRow {
  scenarioId: string; label: string; type: ScenarioResult['type']
  monthlyPayment: number | null; paymentDelta: number | null
  netCostOverHorizon: number | null; netCostDelta: number | null
  lifetimeCost: number | null; lifetimeDelta: number | null
  meetsTarget: boolean | null; withinBudget: boolean | null
  tradeoffs: string[]
}

export function baselineOf(scenarios: ScenarioResult[]) {
  return scenarios.find(s => s.type === 'keep' && !s.sensitivityOf) ?? scenarios.find(s => s.type === 'lease_return') ?? null
}

export function compareScenarios(scenarios: ScenarioResult[], a: Assumptions): ComparisonRow[] {
  const base = baselineOf(scenarios)
  const d = (x: number | null, y: number | null | undefined) => (x == null || y == null ? null : Math.round((x - y) * 100) / 100)
  return scenarios.filter(s => !s.sensitivityOf).map(s => {
    const tradeoffs: string[] = []
    const pd = d(s.monthlyPayment, base?.monthlyPayment), nd = d(s.netCostOverHorizon, base?.netCostOverHorizon), ld = d(s.lifetimeCost, base?.lifetimeCost)
    if (s !== base && pd != null && pd < 0 && ld != null && ld > 0) tradeoffs.push(`Lowers the payment by ${usd(-pd)}/mo but adds ${usd(ld)} in total remaining payments.`)
    if (s !== base && nd != null && nd > 0) tradeoffs.push(`Costs ${usd(nd)} more over ${a.horizonMonths} months than ${base?.label ?? 'the baseline'}.`)
    if (s !== base && nd != null && nd < 0) tradeoffs.push(`Costs ${usd(-nd)} less over ${a.horizonMonths} months than ${base?.label ?? 'the baseline'}.`)
    if (s.newDebt != null && s.newDebt > 0 && s.type !== 'lease_return' && s.type !== 'lease_buyout') tradeoffs.push(`Adds ${usd(s.newDebt)} of new debt.`)
    if (s.equityAtHorizon != null && s.equityAtHorizon < 0) tradeoffs.push(`Estimated negative equity of ${usd(-s.equityAtHorizon)} at month ${a.horizonMonths}.`)
    return {
      scenarioId: s.id, label: s.label, type: s.type,
      monthlyPayment: s.monthlyPayment, paymentDelta: pd,
      netCostOverHorizon: s.netCostOverHorizon, netCostDelta: nd,
      lifetimeCost: s.lifetimeCost, lifetimeDelta: ld,
      meetsTarget: s.monthlyPayment == null ? null : s.monthlyPayment <= a.paymentTarget + 0.5,
      withinBudget: s.monthlyPayment == null ? null : s.monthlyPayment <= a.monthlyBudget + 0.5,
      tradeoffs,
    }
  })
}

// ---------- Ranking (Decision Agent) ----------

export const SCORING = {
  newDebtWeight: 0.25, // each $ of new debt counts as $0.25 of cost
  keepVehicleCredit: 300, // credit when the customer prefers to keep the vehicle and the scenario does
  formula: 'score = net modeled cost over horizon + 0.25 × new debt − $300 if it keeps a vehicle the customer wants to keep (lower is better)',
}

export interface RankEntry { scenarioId: string; label: string; eligible: boolean; violations: string[]; score: number | null; breakdown: string }

export function hardConstraints(s: ScenarioResult, a: Assumptions): string[] {
  const v: string[] = []
  if (!s.computed || s.monthlyPayment == null) return ['Not a calculable financial scenario']
  if (s.sensitivityOf) v.push('Sensitivity run, not a separate option')
  if (s.monthlyPayment > a.monthlyBudget + 0.5) v.push(`Payment ${usd(s.monthlyPayment)} exceeds monthly budget ${usd(a.monthlyBudget)}`)
  if (a.goal === 'lower_payment' && s.monthlyPayment > a.paymentTarget + 0.5) v.push(`Payment ${usd(s.monthlyPayment)} misses the ${usd(a.paymentTarget)} target`)
  if (a.goal === 'replace_vehicle' && s.type !== 'trade_in') v.push('Does not replace the vehicle (stated goal)')
  return v
}

export function rankScenarios(scenarios: ScenarioResult[], a: Assumptions): RankEntry[] {
  return scenarios.filter(s => !s.sensitivityOf).map(s => {
    const violations = hardConstraints(s, a)
    if (s.netCostOverHorizon == null) return { scenarioId: s.id, label: s.label, eligible: false, violations, score: null, breakdown: 'not scored' }
    const debt = Math.max(0, s.newDebt ?? 0) * SCORING.newDebtWeight
    const credit = a.keepVehicle && s.keepsVehicle ? SCORING.keepVehicleCredit : 0
    const score = Math.round((s.netCostOverHorizon + debt - credit) * 100) / 100
    return { scenarioId: s.id, label: s.label, eligible: violations.length === 0, violations, score, breakdown: `${usd(s.netCostOverHorizon)} net cost + ${usd(debt)} debt weight − ${usd(credit)} keep credit` }
  }).sort((x, y) => Number(y.eligible) - Number(x.eligible) || (x.score ?? Infinity) - (y.score ?? Infinity))
}

/** What a single-metric tool would pick. The Challenger exists to test this. */
export function preliminaryPick(scenarios: ScenarioResult[], a: Assumptions): ScenarioResult | null {
  const calc = scenarios.filter(s => s.computed && !s.sensitivityOf)
  const by = (f: (s: ScenarioResult) => number) => [...calc].sort((x, y) => f(x) - f(y))[0] ?? null
  if (a.goal === 'lower_payment' || a.goal === 'lease_end') return by(s => s.monthlyPayment ?? Infinity)
  if (a.goal === 'replace_vehicle') return calc.find(s => s.type === 'trade_in') ?? by(s => s.monthlyPayment ?? Infinity)
  return by(s => s.netCostOverHorizon ?? Infinity)
}

// ---------- Challenger ----------

export type Severity = 'pass' | 'info' | 'qualify' | 'material'
export interface Finding { code: string; severity: Severity; message: string; evidence: string }
export interface Validation {
  status: 'approved' | 'qualified' | 'revise' | 'blocked'
  findings: Finding[]
  requiredRecalculations: { kind: 'rate_sensitivity'; scenarioId: string; aprPct: number }[]
  qualifications: string[]
  canPresent: boolean
  betterScenarioId: string | null
}

export const SENSITIVITY_BUMP = 1.5 // percentage points

export function validateRecommendation(candidateId: string, scenarios: ScenarioResult[], a: Assumptions): Validation {
  const c = scenarios.find(s => s.id === candidateId)
  if (!c) throw new Error(`Unknown scenario ${candidateId}`)
  const base = baselineOf(scenarios)
  const ranking = rankScenarios(scenarios, a)
  const findings: Finding[] = []
  const recalcs: Validation['requiredRecalculations'] = []
  let better: string | null = null
  const add = (code: string, severity: Severity, message: string, evidence: string) => findings.push({ code, severity, message, evidence })

  const eligible = ranking.filter(r => r.eligible)
  if (eligible.length === 0) {
    add('NO_FEASIBLE_OPTION', 'material', 'No modeled scenario satisfies the hard constraints.', ranking.map(r => `${r.label}: ${r.violations.join('; ') || 'ok'}`).join(' | '))
    return { status: 'blocked', findings, requiredRecalculations: [], qualifications: ['None of the modeled options meet the stated constraints.'], canPresent: true, betterScenarioId: null }
  }

  const v = hardConstraints(c, a)
  if (v.length) add('HARD_CONSTRAINT', 'material', 'The preliminary pick violates a hard constraint.', v.join('; '))
  else add('HARD_CONSTRAINT', 'pass', 'Meets payment budget and target.', `${usd(c.monthlyPayment)}/mo vs budget ${usd(a.monthlyBudget)}, target ${usd(a.paymentTarget)}`)

  const top = eligible[0]
  const mine = ranking.find(r => r.scenarioId === c.id)
  if (top.scenarioId !== c.id && (v.length > 0 || (mine?.score != null && top.score != null && top.score < mine.score - 1))) {
    better = top.scenarioId
    add('BETTER_TRADEOFF', 'material', `${top.label} meets the same constraints at a lower modeled cost.`, `score ${usd(top.score)} vs ${usd(mine?.score ?? null)} (${SCORING.formula})`)
  } else add('BETTER_TRADEOFF', 'pass', 'No eligible alternative has a better modeled trade-off.', `top eligible: ${top.label}`)

  const horizons = new Set(scenarios.filter(s => s.computed).map(s => s.horizonMonths))
  add('HORIZON_CONSISTENCY', horizons.size <= 1 ? 'pass' : 'material', horizons.size <= 1 ? 'All scenarios compared over the same horizon.' : 'Scenarios use different horizons.', [...horizons].join(', ') + ' months')

  if (base && c !== base && c.monthlyPayment != null && base.monthlyPayment != null && c.monthlyPayment < base.monthlyPayment && c.lifetimeCost != null && base.lifetimeCost != null && c.lifetimeCost > base.lifetimeCost + 1)
    add('PAYMENT_VS_TOTAL_COST', 'qualify', `A lower payment here means more paid in total: ${usd(c.lifetimeCost - base.lifetimeCost)} more over the life of the loan.`, `${usd(c.monthlyPayment)}/mo × remaining term = ${usd(c.lifetimeCost)} vs ${usd(base.lifetimeCost)} if kept as is`)
  else add('PAYMENT_VS_TOTAL_COST', 'pass', 'No hidden total-cost increase versus the baseline.', base ? `lifetime ${usd(c.lifetimeCost)} vs ${usd(base.lifetimeCost)}` : 'no baseline')

  if (base && c !== base && c.balanceAtHorizon != null && base.balanceAtHorizon != null && c.balanceAtHorizon > base.balanceAtHorizon + 1)
    add('DEBT_AT_HORIZON', 'qualify', `You would still owe ${usd(c.balanceAtHorizon - base.balanceAtHorizon)} more at month ${a.horizonMonths} than if you kept your current loan.`, `${usd(c.balanceAtHorizon)} vs ${usd(base.balanceAtHorizon)}`)

  if (c.aprKind === 'illustrative' && c.aprUsed != null) {
    const sens = scenarios.find(s => s.sensitivityOf === c.id)
    if (!sens && c.type !== 'refinance' && c.type !== 'trade_in') {
      add('ILLUSTRATIVE_RATE', 'qualify', `Relies on an illustrative ${c.aprUsed}% APR after lease end; actual terms may differ.`, 'aprKind = illustrative')
    } else if (!sens) {
      recalcs.push({ kind: 'rate_sensitivity', scenarioId: c.id, aprPct: Math.round((c.aprUsed + SENSITIVITY_BUMP) * 100) / 100 })
      add('ILLUSTRATIVE_RATE', 'qualify', `Relies on an illustrative ${c.aprUsed}% APR. Requesting a +${SENSITIVITY_BUMP} pt sensitivity recalculation.`, 'aprKind = illustrative')
    } else {
      const stillOk = sens.monthlyPayment != null && sens.monthlyPayment <= Math.min(a.monthlyBudget, a.goal === 'lower_payment' ? a.paymentTarget : Infinity) + 0.5
      add('RATE_SENSITIVITY', stillOk ? 'info' : 'qualify',
        stillOk ? `Still within target if the rate were ${sens.aprUsed}% (${usd(sens.monthlyPayment)}/mo).` : `Fragile: at ${sens.aprUsed}% the payment would be ${usd(sens.monthlyPayment)}/mo, which misses the target.`,
        `sensitivity scenario ${sens.id}`)
    }
  }

  if (c.missing.length) add('MISSING_INPUTS', 'qualify', `Result excludes: ${c.missing.join('; ')}.`, `${c.missing.length} missing input(s)`)
  const neg = c.limitations.find(l => l.startsWith('Negative equity'))
  if (neg) add('NEGATIVE_EQUITY', 'qualify', neg, `equity = value − payoff − costs`)
  if (c.aprKind === 'derived' || base?.aprKind === 'derived') add('DERIVED_RATE', 'qualify', 'Your interest rate is not on file. NEXT derived it from your balance, payment and term.', `derived APR ${base?.aprUsed}%`)

  const material = findings.some(f => f.severity === 'material')
  const qualifications = findings.filter(f => f.severity === 'qualify').map(f => f.message)
  return {
    status: material ? 'revise' : recalcs.length ? 'qualified' : qualifications.length ? 'qualified' : 'approved',
    findings, requiredRecalculations: recalcs, qualifications, canPresent: !material, betterScenarioId: better,
  }
}

// ---------- Decision ----------

export interface Recommendation {
  id: string; customerId: string; version: number; scenarioId: string; scenarioKey: string
  recommendedAction: string; headline: string; explanation: string; explanationSource: 'llm' | 'deterministic'
  reasons: string[]; tradeoffs: string[]; assumptions: string[]; missingInformation: string[]
  qualifications: string[]; alternatives: { scenarioId: string; label: string; whyNot: string }[]
  dataQuality: { level: 'high' | 'medium' | 'low'; notes: string[] }
  nextAction: string; status: Validation['status']
  ranking: RankEntry[]; inputs: Assumptions; createdAt: string
}

export function decide(customer: CustomerProfile, scenarios: ScenarioResult[], a: Assumptions, chosenId: string | null, validation: Validation): Omit<Recommendation, 'id' | 'version' | 'createdAt' | 'explanation' | 'explanationSource'> {
  const ranking = rankScenarios(scenarios, a)
  const support = scenarios.find(s => s.type === 'support')
  const pick = (validation.status === 'blocked' ? support : scenarios.find(s => s.id === chosenId)) ?? support ?? scenarios[0]
  const base = baselineOf(scenarios)
  const rows = compareScenarios(scenarios, a)
  const row = rows.find(r => r.scenarioId === pick.id)
  const missing = [...new Set(scenarios.filter(s => !s.sensitivityOf).flatMap(s => s.missing))]
  const derived = scenarios.some(s => s.aprKind === 'derived')
  // Quality of the chosen result: its own missing inputs, capped at medium when the APR had to be derived.
  const own = pick.missing.length
  const level = own === 0 && !derived ? 'high' : own <= 2 ? 'medium' : 'low'

  const reasons: string[] = []
  if (pick.type === 'support') {
    reasons.push(validation.findings.find(f => f.code === 'NO_FEASIBLE_OPTION')?.message ?? 'No modeled option meets the stated constraints.')
    const closest = [...scenarios].filter(s => s.monthlyPayment != null && !s.sensitivityOf).sort((x, y) => x.monthlyPayment! - y.monthlyPayment!)[0]
    if (closest) reasons.push(`The lowest modeled payment is ${usd(closest.monthlyPayment)}/mo (${closest.label}), against a target of ${usd(a.paymentTarget)}.`)
    reasons.push('A specialist can review account options NEXT cannot evaluate.')
  } else {
    if (a.goal === 'lower_payment') reasons.push(`Meets your ${usd(a.paymentTarget)} target at ${usd(pick.monthlyPayment)}/mo.`)
    else reasons.push(`Fits your ${usd(a.monthlyBudget)} monthly budget at ${usd(pick.monthlyPayment)}/mo.`)
    const r = ranking.find(x => x.scenarioId === pick.id)
    if (r?.score != null) reasons.push(`Lowest modeled score among eligible options (${r.breakdown}).`)
    if (base && pick !== base && row?.netCostDelta != null) reasons.push(row.netCostDelta <= 0 ? `Net modeled cost over ${a.horizonMonths} months is ${usd(-row.netCostDelta)} lower than ${base.label}.` : `Net modeled cost over ${a.horizonMonths} months is ${usd(row.netCostDelta)} higher than ${base.label}, the price of meeting your goal.`)
    if (pick.keepsVehicle && a.keepVehicle) reasons.push('Keeps the vehicle you said you want to keep.')
  }

  const alternatives = ranking.filter(r => r.scenarioId !== pick.id).map(r => ({
    scenarioId: r.scenarioId, label: r.label,
    whyNot: r.violations.length ? r.violations.join('; ') : `Higher modeled score (${usd(r.score)})`,
  }))

  const titles: Record<string, string> = {
    keep: `Keep your ${customer.vehicle.model} on its current loan`,
    refinance: `Explore refinancing to ${pick.label.split('· ')[1] ?? 'a new term'}`,
    trade_in: pick.label, lease_return: 'Return your lease and finance a replacement', lease_buyout: pick.label,
    support: 'Talk with a Toyota Financial Services specialist',
  }
  const nextActions: Record<string, string> = {
    keep: 'Review your budget against the current payment schedule; no account change needed.',
    refinance: 'Request actual refinance terms from Toyota Financial Services and compare them to this illustration.',
    trade_in: 'Get an official payoff quote and a dealer appraisal, then compare real terms to this illustration.',
    lease_return: 'Schedule your pre-return inspection and confirm the disposition fee in your contract.',
    lease_buyout: 'Request your official lease purchase quote, including fees and taxes.',
    support: 'Prepare a summary and contact a Toyota Financial Services specialist.',
  }
  return {
    customerId: customer.id, scenarioId: pick.id, scenarioKey: pick.key,
    recommendedAction: titles[pick.type],
    headline: pick.type === 'support' ? 'No modeled option meets your goal. A specialist is the right next step.' : `${pick.label}: ${usd(pick.monthlyPayment)}/mo`,
    reasons, tradeoffs: row?.tradeoffs ?? [], qualifications: validation.qualifications,
    assumptions: pick.assumptions.map(n => `${n.label}: ${n.value} (${n.kind})`),
    missingInformation: missing, alternatives,
    dataQuality: { level, notes: [`${own} missing input(s) in the recommended result`, `${missing.length} across all scenarios`, ...(derived ? ['APR derived, not on file'] : [])] },
    nextAction: nextActions[pick.type], status: validation.status, ranking, inputs: a,
  }
}

export function deterministicExplanation(r: Pick<Recommendation, 'recommendedAction' | 'reasons' | 'tradeoffs' | 'qualifications'>) {
  return [
    `${r.recommendedAction}.`, r.reasons[0],
    ...(r.tradeoffs.length ? ['Trade-off: ' + r.tradeoffs[0]] : []),
    ...(r.qualifications.length ? ['Keep in mind: ' + r.qualifications[0]] : []),
  ].join(' ')
}

// ---------- Action plan ----------

export const ACTION_TYPES = ['checklist', 'comparison_summary', 'follow_up', 'human_handoff', 'resource'] as const
export type ActionType = typeof ACTION_TYPES[number]
export interface ProposedAction { actionType: ActionType; title: string; details: string[] }

export function prepareActionPlan(customer: CustomerProfile, rec: Pick<Recommendation, 'scenarioKey' | 'missingInformation' | 'headline' | 'recommendedAction' | 'reasons' | 'qualifications' | 'status'>, scenarios: ScenarioResult[]): ProposedAction[] {
  const plan: ProposedAction[] = []
  const docs = ['Most recent statement for account ' + customer.financing.id, ...rec.missingInformation.map(m => 'Confirm: ' + m.replace(/ \(.*\)$/, ''))]
  plan.push({ actionType: 'checklist', title: 'Gather what you need', details: docs })
  plan.push({ actionType: 'comparison_summary', title: 'Save the financing comparison', details: scenarios.filter(s => !s.sensitivityOf && s.monthlyPayment != null).map(s => `${s.label}: ${usd(s.monthlyPayment)}/mo · ${usd(s.netCostOverHorizon)} net over ${s.horizonMonths} mo`) })
  if (rec.status === 'blocked' || rec.scenarioKey === 'support' || rec.qualifications.length >= 3)
    plan.push({ actionType: 'human_handoff', title: 'Prepare a summary for a TFS specialist', details: [rec.headline, ...rec.reasons, ...rec.qualifications.map(q => 'Open question: ' + q)] })
  plan.push({ actionType: 'follow_up', title: 'Revisit this decision in 30 days', details: ['Re-run NEXT with updated balance, value and budget.'] })
  plan.push({ actionType: 'resource', title: 'Official resources', details: ['Toyota Financial Services account center: toyotafinancial.com', 'Lease-end and payoff information is available from your TFS account.'] })
  return plan
}

// ---------- Signals ----------

export interface Signal { id: string; title: string; description: string; data: Record<string, string>; whyItMatters: string; nextAction: string; urgency: 'info' | 'watch' | 'act'; evidence: string; url?: string }

export function detectSignals(c: CustomerProfile, a: Assumptions, scenarios: ScenarioResult[], validation: Validation | null): Signal[] {
  const out: Signal[] = []
  const f = c.financing
  if (f.monthlyPayment > a.paymentTarget + 0.5) out.push({
    id: 'payment-target-mismatch', title: 'Payment above your target', urgency: a.goal === 'lower_payment' ? 'act' : 'watch',
    description: `Your current payment is ${usd(f.monthlyPayment)}, ${usd(f.monthlyPayment - a.paymentTarget)} above your ${usd(a.paymentTarget)} target.`,
    data: { current: usd(f.monthlyPayment), target: usd(a.paymentTarget) }, whyItMatters: 'A persistent gap strains your monthly budget.',
    nextAction: 'Compare options in NEXT Twin.', evidence: `current payment ${f.monthlyPayment} > target ${a.paymentTarget} (account record vs your input)`,
  })
  if (f.financingType === 'lease') {
    const L = leaseFacts(c)
    if (L.monthsLeft <= 6) out.push({
      id: 'lease-window', title: 'Lease-end planning window is open', urgency: L.monthsLeft <= 3 ? 'act' : 'watch',
      description: `Your lease ends ${f.leaseEndDate}, about ${L.monthsLeft} months from now.`, data: { leaseEnd: f.leaseEndDate!, monthsLeft: String(L.monthsLeft) },
      whyItMatters: 'Return, buyout and replacement each need lead time (inspection, quotes, financing).', nextAction: 'Compare return vs. buyout.', evidence: `months until ${f.leaseEndDate} from ${'2026-10-24'} = ${L.monthsLeft}`,
    })
    if (L.excessMiles) out.push({
      id: 'mileage-projection', title: 'Projected to exceed mileage allowance', urgency: 'watch',
      description: `At your current pace you'd return the car with ~${L.projectedMiles.toLocaleString()} miles, ${L.excessMiles.toLocaleString()} over the allowance.`,
      data: { projected: L.projectedMiles.toLocaleString(), allowance: (f.mileageAllowanceTotal ?? 0).toLocaleString(), charge: L.mileageCharge == null ? 'unknown' : usd(L.mileageCharge) },
      whyItMatters: 'Excess-mileage charges apply on return at your contract rate.', nextAction: 'Factor the charge into return vs. buyout.',
      evidence: `${c.vehicle.odometer} + ${c.vehicle.annualMiles}×${L.monthsLeft}/12 − ${f.mileageAllowanceTotal} = ${L.excessMiles} mi × $${f.excessMileageRate}`,
    })
  }
  const payoff = f.financingType === 'lease' ? f.purchaseOptionPrice : f.currentBalance
  if (payoff != null) {
    const eq = a.vehicleValue - payoff
    out.push({
      id: eq >= 0 ? 'positive-equity' : 'negative-equity', title: eq >= 0 ? 'Estimated positive equity' : 'Estimated negative equity', urgency: eq >= 0 ? 'info' : 'watch',
      description: `Estimated value ${usd(a.vehicleValue)} vs ${f.financingType === 'lease' ? 'purchase option' : 'balance'} ${usd(payoff)}: ${usd(eq)}.`,
      data: { value: usd(a.vehicleValue), payoff: usd(payoff), equity: usd(eq) },
      whyItMatters: eq >= 0 ? 'Equity can reduce what you finance if you trade.' : 'Trading now would roll the shortfall into new debt.',
      nextAction: 'Get an official appraisal and payoff quote before acting.', evidence: 'value (synthetic estimate) − payoff; not a guaranteed price',
    })
  }
  const missing = [...new Set(scenarios.flatMap(s => s.missing))]
  if (missing.length) out.push({
    id: 'missing-info', title: `${missing.length} missing input${missing.length > 1 ? 's' : ''} affect the result`, urgency: 'info',
    description: missing.slice(0, 3).join('; ') + (missing.length > 3 ? '…' : ''), data: { count: String(missing.length) },
    whyItMatters: 'Results exclude these costs, so real totals may be higher.', nextAction: 'Add the missing details in NEXT Twin.', evidence: 'scenario.missing fields',
  })
  const meets = scenarios.some(s => !s.sensitivityOf && s.monthlyPayment != null && s.monthlyPayment <= a.paymentTarget + 0.5)
  if (!meets) out.push({
    id: 'no-scenario-meets-target', title: 'No modeled option reaches your target', urgency: 'act',
    description: `None of the calculated scenarios get to ${usd(a.paymentTarget)}/mo.`, data: { target: usd(a.paymentTarget) },
    whyItMatters: 'Self-service options alone may not close the gap.', nextAction: 'Talk with a TFS specialist.', evidence: 'all scenario.monthlyPayment > target',
  })
  if (validation?.status === 'blocked' || (!meets && a.goal === 'lower_payment')) out.push({
    id: 'human-support', title: 'Human support recommended', urgency: 'act',
    description: 'Your situation needs options NEXT cannot evaluate, such as account-level assistance.', data: {},
    whyItMatters: 'A specialist can review account options and eligibility directly.', nextAction: 'Prepare a specialist summary in Next Steps.', evidence: `validation.status = ${validation?.status}`,
  })
  return out
}
