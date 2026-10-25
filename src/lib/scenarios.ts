import { z } from 'zod'
import { balanceAfter, depreciatedValue, impliedApr, payment, round2 } from './finance.ts'
import { AS_OF, valueKind, type CustomerProfile, type GoalId, type Provenance } from './data.ts'

export const HORIZONS = [12, 24, 36, 48, 60] as const
export const GOALS = ['lower_payment', 'minimize_cost', 'replace_vehicle', 'lease_end', 'understand_options'] as const

// Everything the customer can change in NEXT Twin. Validated at every API boundary.
export const AssumptionsSchema = z.object({
  goal: z.enum(GOALS),
  horizonMonths: z.union(HORIZONS.map(h => z.literal(h)) as [z.ZodLiteral<12>, z.ZodLiteral<24>, z.ZodLiteral<36>, z.ZodLiteral<48>, z.ZodLiteral<60>]),
  monthlyBudget: z.number().min(0).max(10000),
  paymentTarget: z.number().min(0).max(10000),
  vehicleValue: z.number().min(0).max(500000),
  depreciationRatePct: z.number().min(0).max(60),
  refiAprPct: z.number().min(0).max(40),
  refiTermMonths: z.number().int().min(12).max(84),
  refiFees: z.number().min(0).max(10000).nullable(),
  replacementPrice: z.number().min(0).max(500000),
  replacementAprPct: z.number().min(0).max(40),
  replacementTermMonths: z.number().int().min(12).max(84),
  downPayment: z.number().min(0).max(500000),
  tradeCosts: z.number().min(0).max(20000).nullable(),
  keepVehicle: z.boolean(),
})
export type Assumptions = z.infer<typeof AssumptionsSchema>

export const ASSUMPTION_LABELS: Record<keyof Assumptions, string> = {
  goal: 'Customer goal', horizonMonths: 'Evaluation horizon', monthlyBudget: 'Monthly budget', paymentTarget: 'Payment target',
  vehicleValue: 'Estimated vehicle value', depreciationRatePct: 'Annual depreciation', refiAprPct: 'Illustrative refinance APR',
  refiTermMonths: 'Refinance term', refiFees: 'Refinance fees', replacementPrice: 'Replacement vehicle price',
  replacementAprPct: 'Illustrative replacement APR', replacementTermMonths: 'Replacement loan term', downPayment: 'Down payment',
  tradeCosts: 'Trade-in transaction costs', keepVehicle: 'Prefers to keep vehicle',
}

/** Rate on file, or the APR implied by balance/payment/term when the rate is missing. */
export function currentApr(c: CustomerProfile): { apr: number; provenance: Provenance } | null {
  const f = c.financing
  if (f.financingType !== 'loan' || f.currentBalance == null || f.remainingMonths == null) return null
  if (f.interestRate != null) return { apr: f.interestRate, provenance: 'supplied' }
  const apr = impliedApr(f.currentBalance, f.monthlyPayment, f.remainingMonths)
  return apr == null ? null : { apr, provenance: 'derived' }
}

export function monthsUntil(date: string, from = AS_OF) {
  const a = new Date(from + 'T00:00:00Z'), b = new Date(date + 'T00:00:00Z')
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / (30.4375 * 864e5)))
}

export function defaultAssumptions(c: CustomerProfile): Assumptions {
  return {
    goal: c.primaryGoal,
    horizonMonths: 36,
    monthlyBudget: c.monthlyBudget,
    paymentTarget: c.monthlyBudget,
    vehicleValue: c.vehicle.estimatedMarketValue,
    depreciationRatePct: 12,
    // No invented "better" rate: the illustrative refinance rate starts at the customer's own rate.
    refiAprPct: currentApr(c)?.apr ?? 7.5,
    refiTermMonths: 60,
    refiFees: null,
    replacementPrice: c.replacement.price,
    replacementAprPct: 6.9,
    replacementTermMonths: 60,
    downPayment: 0,
    tradeCosts: null,
    keepVehicle: c.keepVehiclePreference,
  }
}

export type ScenarioType = 'keep' | 'refinance' | 'trade_in' | 'support' | 'lease_return' | 'lease_buyout'

export interface AssumptionNote { label: string; value: string; kind: Provenance }
export interface TimelinePoint { month: number; cumulativePaid: number; balance: number; value: number | null; equity: number | null }

export interface ScenarioResult {
  id: string; key: string; type: ScenarioType; label: string; customerId: string
  computed: boolean
  inputSnapshot: Record<string, unknown>
  horizonMonths: number
  monthlyPayment: number | null
  upfrontCash: number // display only; already included in timeline cumulativePaid
  paymentsOverHorizon: number | null
  balanceAtHorizon: number | null
  vehicleValueAtHorizon: number | null
  equityAtHorizon: number | null
  /** cash out (incl. upfront) + debt left − vehicle value, over the horizon. Same starting position for every scenario, so comparable. */
  netCostOverHorizon: number | null
  /** every remaining payment until the debt is gone, plus upfront cash */
  lifetimeCost: number | null
  amountFinanced: number | null
  aprUsed: number | null
  aprKind: Provenance | null
  newDebt: number | null
  keepsVehicle: boolean
  timeline: TimelinePoint[]
  assumptions: AssumptionNote[]
  missing: string[]
  limitations: string[]
  sensitivityOf?: string // set on challenger-requested recalculations
}

// FNV-1a: stable, dependency-free id so identical inputs give identical scenario ids.
export function hashId(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

function finish(base: Omit<ScenarioResult, 'id' | 'paymentsOverHorizon' | 'balanceAtHorizon' | 'vehicleValueAtHorizon' | 'equityAtHorizon' | 'netCostOverHorizon'>): ScenarioResult {
  const last = base.timeline.at(-1)
  const r2 = (n: number | null | undefined) => (n == null ? null : round2(n))
  return {
    ...base,
    id: `scn-${base.type}-${hashId(base.key + JSON.stringify(base.inputSnapshot))}`,
    paymentsOverHorizon: last ? r2(last.cumulativePaid) : null,
    balanceAtHorizon: last ? r2(last.balance) : null,
    vehicleValueAtHorizon: r2(last?.value),
    equityAtHorizon: r2(last?.equity),
    netCostOverHorizon: last && last.value != null ? round2(last.cumulativePaid + last.balance - last.value) : null,
    monthlyPayment: r2(base.monthlyPayment),
    lifetimeCost: r2(base.lifetimeCost),
    timeline: base.timeline.map(p => ({ month: p.month, cumulativePaid: round2(p.cumulativePaid), balance: round2(p.balance), value: r2(p.value), equity: r2(p.equity) })),
  }
}

/** Builds a month-by-month path for a loan that starts at `startMonth` (earlier months carry `before`). */
function loanPath(h: number, opts: { principal: number; apr: number; term: number; pmt: number; startMonth?: number; upfront?: number; prePayment?: number; valueAt: (m: number) => number | null }) {
  const start = opts.startMonth ?? 0
  const out: TimelinePoint[] = []
  for (let m = 0; m <= h; m++) {
    const pre = Math.min(m, start) * (opts.prePayment ?? 0)
    const k = Math.max(0, m - start)
    const paid = pre + Math.min(k, opts.term) * opts.pmt + (m >= start ? opts.upfront ?? 0 : 0)
    const bal = m < start ? 0 : balanceAfter(opts.principal, opts.apr, opts.term, k, opts.pmt)
    const value = opts.valueAt(m)
    out.push({ month: m, cumulativePaid: paid, balance: bal, value, equity: value == null ? null : value - bal })
  }
  return out
}

function baseNotes(a: Assumptions): AssumptionNote[] {
  return [
    { label: 'Evaluation horizon', value: `${a.horizonMonths} months`, kind: 'supplied' },
    { label: 'Annual depreciation', value: `${a.depreciationRatePct}% / yr`, kind: 'illustrative' },
  ]
}

export function simulateKeep(c: CustomerProfile, a: Assumptions): ScenarioResult {
  const f = c.financing, rate = currentApr(c)
  if (f.currentBalance == null || f.remainingMonths == null || !rate) throw new Error('Keep scenario requires loan balance, remaining term and a known or derivable APR')
  const h = a.horizonMonths, P = f.currentBalance, n = f.remainingMonths, pmt = f.monthlyPayment
  const timeline = loanPath(h, { principal: P, apr: rate.apr, term: n, pmt, valueAt: m => depreciatedValue(a.vehicleValue, a.depreciationRatePct, m) })
  return finish({
    key: 'keep', type: 'keep', label: `Keep my ${c.vehicle.model}`, customerId: c.id, computed: true,
    inputSnapshot: { balance: P, remainingMonths: n, payment: pmt, apr: rate.apr, vehicleValue: a.vehicleValue, depreciationRatePct: a.depreciationRatePct, horizonMonths: h },
    horizonMonths: h, monthlyPayment: pmt, upfrontCash: 0, lifetimeCost: pmt * n, amountFinanced: P,
    aprUsed: rate.apr, aprKind: rate.provenance, newDebt: 0, keepsVehicle: true, timeline,
    assumptions: [
      { label: 'Current balance', value: money(P), kind: 'supplied' },
      { label: 'Scheduled payment', value: money(pmt) + '/mo', kind: 'supplied' },
      { label: 'Remaining term', value: `${n} months`, kind: 'supplied' },
      { label: 'APR', value: `${rate.apr}%`, kind: rate.provenance },
      { label: 'Vehicle value today', value: money(a.vehicleValue), kind: valueKind(c, a.vehicleValue) },
      ...baseNotes(a),
    ],
    missing: rate.provenance === 'derived' ? ['Interest rate on file (APR derived from balance, payment and term)'] : [],
    limitations: ['Vehicle value path is an illustrative depreciation assumption, not a forecast.'],
  })
}

export function simulateRefinance(c: CustomerProfile, a: Assumptions, opts: { termMonths?: number; aprPct?: number; sensitivityOf?: string } = {}): ScenarioResult {
  const f = c.financing
  if (f.currentBalance == null) throw new Error('Refinance scenario requires a loan balance')
  const h = a.horizonMonths, fees = a.refiFees ?? 0, P = f.currentBalance + fees
  const apr = opts.aprPct ?? a.refiAprPct, term = opts.termMonths ?? a.refiTermMonths
  const pmt = payment(P, apr, term)
  const timeline = loanPath(h, { principal: P, apr, term, pmt, valueAt: m => depreciatedValue(a.vehicleValue, a.depreciationRatePct, m) })
  return finish({
    key: `refinance:${term}${opts.sensitivityOf ? ':s' + apr : ''}`, type: 'refinance', customerId: c.id, computed: true,
    label: opts.sensitivityOf ? `Refinance · ${term} mo @ ${apr}% (sensitivity)` : `Refinance · ${term} mo`,
    inputSnapshot: { balance: f.currentBalance, fees, apr, termMonths: term, vehicleValue: a.vehicleValue, depreciationRatePct: a.depreciationRatePct, horizonMonths: h },
    horizonMonths: h, monthlyPayment: pmt, upfrontCash: 0, lifetimeCost: pmt * term, amountFinanced: P,
    aprUsed: apr, aprKind: 'illustrative', newDebt: fees, keepsVehicle: true, timeline, sensitivityOf: opts.sensitivityOf,
    assumptions: [
      { label: 'Amount refinanced', value: money(P), kind: 'derived' },
      { label: 'APR', value: `${apr}%`, kind: 'illustrative' },
      { label: 'New term', value: `${term} months`, kind: 'illustrative' },
      { label: 'Fees rolled into loan', value: money(fees), kind: a.refiFees == null ? 'missing' : 'illustrative' },
      ...baseNotes(a),
    ],
    missing: a.refiFees == null ? ['Refinance fees (modeled as $0)'] : [],
    limitations: ['Illustrative rate and term only. Not an offer; eligibility and approval are not determined by NEXT.'],
  })
}

export function simulateTradeIn(c: CustomerProfile, a: Assumptions, opts: { aprPct?: number; sensitivityOf?: string } = {}): ScenarioResult {
  const f = c.financing, h = a.horizonMonths
  const isLease = f.financingType === 'lease'
  const payoff = isLease ? f.purchaseOptionPrice : f.currentBalance
  if (payoff == null) throw new Error('Trade-in scenario requires a payoff estimate')
  const costs = a.tradeCosts ?? 0
  const equity = a.vehicleValue - payoff - costs
  const financed = Math.max(0, a.replacementPrice - a.downPayment - equity)
  const apr = opts.aprPct ?? a.replacementAprPct, term = a.replacementTermMonths
  const pmt = payment(financed, apr, term)
  const timeline = loanPath(h, { principal: financed, apr, term, pmt, upfront: a.downPayment, valueAt: m => depreciatedValue(a.replacementPrice, a.depreciationRatePct, m) })
  return finish({
    key: `trade_in${opts.sensitivityOf ? ':s' + apr : ''}`, type: 'trade_in', customerId: c.id, computed: true,
    label: opts.sensitivityOf ? `Trade in @ ${apr}% (sensitivity)` : `Trade in for ${c.replacement.label.split(' (')[0]}`,
    inputSnapshot: { vehicleValue: a.vehicleValue, payoff, tradeCosts: costs, replacementPrice: a.replacementPrice, downPayment: a.downPayment, apr, termMonths: term, depreciationRatePct: a.depreciationRatePct, horizonMonths: h },
    horizonMonths: h, monthlyPayment: pmt, upfrontCash: a.downPayment, lifetimeCost: a.downPayment + pmt * term, amountFinanced: financed,
    aprUsed: apr, aprKind: 'illustrative', newDebt: financed - (f.currentBalance ?? 0), keepsVehicle: false, timeline, sensitivityOf: opts.sensitivityOf,
    assumptions: [
      { label: 'Trade-in value', value: money(a.vehicleValue), kind: valueKind(c, a.vehicleValue) },
      { label: isLease ? 'Lease payoff (purchase option price)' : 'Payoff (current balance)', value: money(payoff), kind: isLease ? 'supplied' : 'derived' },
      { label: 'Estimated equity', value: money(equity), kind: 'derived' },
      { label: 'Replacement price', value: money(a.replacementPrice), kind: 'illustrative' },
      { label: 'Down payment', value: money(a.downPayment), kind: 'supplied' },
      { label: 'Amount financed', value: money(financed), kind: 'derived' },
      { label: 'APR / term', value: `${apr}% · ${term} mo`, kind: 'illustrative' },
      { label: 'Transaction costs', value: money(costs), kind: a.tradeCosts == null ? 'missing' : 'illustrative' },
      ...baseNotes(a),
    ],
    missing: [
      ...(a.tradeCosts == null ? ['Trade-in transaction costs (modeled as $0)'] : []),
      'Sales tax, title and registration on the replacement vehicle',
      ...(isLease ? [] : ['Official payoff quote (current balance used)']),
    ],
    limitations: [
      'Illustrative financing. Not an offer; approval is not determined by NEXT.',
      ...(isLease ? ['Whether lease equity can be applied in a trade depends on lessor policy.'] : []),
      ...(equity < 0 ? [`Negative equity of ${money(-equity)} is rolled into the new loan.`] : []),
    ],
  })
}

export function simulateSupport(c: CustomerProfile, a: Assumptions): ScenarioResult {
  return finish({
    key: 'support', type: 'support', label: 'Explore support options with TFS', customerId: c.id, computed: false,
    inputSnapshot: { horizonMonths: a.horizonMonths }, horizonMonths: a.horizonMonths, monthlyPayment: null, upfrontCash: 0,
    lifetimeCost: null, amountFinanced: null, aprUsed: null, aprKind: null, newDebt: null, keepsVehicle: true, timeline: [],
    assumptions: [], missing: ['Which account options apply to this customer'],
    limitations: ['NEXT cannot determine eligibility for any payment-assistance or account option. A Toyota Financial Services specialist can.'],
  })
}

export function leaseFacts(c: CustomerProfile) {
  const f = c.financing
  if (f.financingType !== 'lease' || !f.leaseEndDate) throw new Error('Lease facts require a lease account')
  const monthsLeft = monthsUntil(f.leaseEndDate)
  const projectedMiles = Math.round(c.vehicle.odometer + (c.vehicle.annualMiles * monthsLeft) / 12)
  const excessMiles = f.mileageAllowanceTotal == null ? null : Math.max(0, projectedMiles - f.mileageAllowanceTotal)
  const mileageCharge = excessMiles == null || f.excessMileageRate == null ? null : round2(excessMiles * f.excessMileageRate)
  return { monthsLeft, projectedMiles, excessMiles, mileageCharge, dispositionFee: f.dispositionFee }
}

export function simulateLeaseEnd(c: CustomerProfile, a: Assumptions, option: 'return' | 'buyout'): ScenarioResult {
  const f = c.financing, h = a.horizonMonths, L = leaseFacts(c)
  const endFees = (option === 'return' ? (L.mileageCharge ?? 0) + (L.dispositionFee ?? 0) : 0)
  const apr = a.replacementAprPct, term = a.replacementTermMonths
  const principal = option === 'return' ? Math.max(0, a.replacementPrice - a.downPayment) : Math.max(0, (f.purchaseOptionPrice ?? 0) - a.downPayment)
  if (option === 'buyout' && f.purchaseOptionPrice == null) throw new Error('Buyout requires the purchase option price from the contract')
  const pmt = payment(principal, apr, term)
  const valueAt = (m: number) => option === 'return'
    ? (m < L.monthsLeft ? null : depreciatedValue(a.replacementPrice, a.depreciationRatePct, m - L.monthsLeft))
    : depreciatedValue(a.vehicleValue, a.depreciationRatePct, m)
  const timeline = loanPath(h, { principal, apr, term, pmt, startMonth: L.monthsLeft, prePayment: f.monthlyPayment, upfront: a.downPayment + endFees, valueAt })
  const missing = option === 'return'
    ? [...(L.dispositionFee == null ? ['Disposition fee (not on file, modeled as $0)'] : []), ...(L.mileageCharge == null ? ['Excess-mileage rate'] : []), 'Wear-and-use charges (determined at inspection)', 'Sales tax, title and registration on the replacement']
    : ['Purchase-option fee and taxes (not on file, modeled as $0)']
  return finish({
    key: `lease_${option}`, type: option === 'return' ? 'lease_return' : 'lease_buyout', customerId: c.id, computed: true,
    label: option === 'return' ? `Return lease, finance ${c.replacement.label.split(' (')[0]}` : `Buy out my ${c.vehicle.model}`,
    inputSnapshot: { leaseEndDate: f.leaseEndDate, monthsLeft: L.monthsLeft, leasePayment: f.monthlyPayment, projectedMiles: L.projectedMiles, endFees, principal, apr, termMonths: term, downPayment: a.downPayment, horizonMonths: h },
    horizonMonths: h, monthlyPayment: pmt, upfrontCash: a.downPayment + endFees, lifetimeCost: f.monthlyPayment * L.monthsLeft + endFees + a.downPayment + pmt * term,
    amountFinanced: principal, aprUsed: apr, aprKind: 'illustrative', newDebt: principal, keepsVehicle: option === 'buyout', timeline,
    assumptions: [
      { label: 'Lease payments left', value: `${L.monthsLeft} × ${money(f.monthlyPayment)}`, kind: 'supplied' },
      ...(option === 'return'
        ? [{ label: 'Projected excess miles', value: `${(L.excessMiles ?? 0).toLocaleString()} mi`, kind: 'derived' as Provenance },
           { label: 'Excess-mileage charge', value: L.mileageCharge == null ? 'unknown' : money(L.mileageCharge), kind: (L.mileageCharge == null ? 'missing' : 'derived') as Provenance },
           { label: 'Replacement price', value: money(a.replacementPrice), kind: 'illustrative' as Provenance }]
        : [{ label: 'Purchase option price', value: money(f.purchaseOptionPrice ?? 0), kind: 'supplied' as Provenance }]),
      { label: 'APR / term after lease end', value: `${apr}% · ${term} mo`, kind: 'illustrative' },
      ...baseNotes(a),
    ],
    missing,
    limitations: ['Illustrative financing after lease end. Not an offer.', option === 'return' ? 'Mileage projection assumes your current driving pace continues.' : 'Modeled without excess-mileage charges; confirm in your lease contract.'],
  })
}
