// NEXT Impact Lab: runs the real engine over a seeded synthetic cohort, then applies explicit,
// configurable funnel assumptions. Engine-derived numbers and assumed rates are labeled separately.
import { z } from 'zod'
import { registerCohort, type CustomerProfile, type GoalId } from './data.ts'
import { payment } from './finance.ts'
import { runWorkflow, type WorkflowResult } from './engine.ts'

export const ImpactConfigSchema = z.object({
  cohortSize: z.number().int().min(20).max(500).default(200),
  seed: z.number().int().min(1).max(1e6).default(7),
  conventional: z.object({
    findsRelevantOptionRate: z.number().min(0).max(1).default(0.35),
    actionRate: z.number().min(0).max(1).default(0.15),
    contactRate: z.number().min(0).max(1).default(0.42),
  }).default({ findsRelevantOptionRate: 0.35, actionRate: 0.15, contactRate: 0.42 }),
  next: z.object({
    exploreRate: z.number().min(0).max(1).default(0.65),
    selectActionRate: z.number().min(0).max(1).default(0.5),
    completionRate: z.number().min(0).max(1).default(0.7),
    residualContactRate: z.number().min(0).max(1).default(0.12),
  }).default({ exploreRate: 0.65, selectActionRate: 0.5, completionRate: 0.7, residualContactRate: 0.12 }),
  minutesPerContact: z.number().min(1).max(120).default(11),
  retention: z.object({
    baselineRate: z.number().min(0).max(1).default(0.55),
    hypotheticalUpliftPts: z.number().min(-10).max(20).default(2),
    valuePerRetainedCustomer: z.number().min(0).max(50000).default(1800),
  }).default({ baselineRate: 0.55, hypotheticalUpliftPts: 2, valuePerRetainedCustomer: 1800 }),
})
export type ImpactConfig = z.infer<typeof ImpactConfigSchema>

// mulberry32: tiny seeded PRNG so the cohort is identical every run.
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const MODELS = [['Corolla', 22000], ['Camry', 29000], ['RAV4', 31000], ['Highlander', 42000], ['Tacoma', 36000], ['Prius', 30000], ['Tundra', 52000]] as const

export function generateCohort(size: number, seed: number): CustomerProfile[] {
  const r = rng(seed), between = (a: number, b: number) => a + (b - a) * r(), round = (n: number, s = 1) => Math.round(n / s) * s
  return Array.from({ length: size }, (_, i) => {
    const [model, msrp] = MODELS[Math.floor(r() * MODELS.length)]
    const id = `cohort-${seed}-${i}`, lease = r() < 0.3
    const value = round(msrp * between(0.6, 0.95), 100)
    const goals: GoalId[] = lease ? ['lease_end', 'lease_end', 'replace_vehicle', 'minimize_cost'] : ['lower_payment', 'lower_payment', 'minimize_cost', 'replace_vehicle', 'understand_options']
    const goal = goals[Math.floor(r() * goals.length)]
    const base = { id, displayName: `Synthetic #${i + 1}`, persona: 'Synthetic cohort member', profileType: lease ? 'lease' as const : 'loan' as const, primaryGoal: goal, goalText: '', keepVehiclePreference: r() < 0.5, replacement: { label: 'Illustrative replacement', price: round(msrp * between(0.85, 1.25), 100) } }
    const vehicle = { id: `veh-${id}`, customerId: id, make: 'Toyota', model, year: 2020 + Math.floor(r() * 5), trim: 'LE', estimatedMarketValue: value, valuationSource: 'Synthetic cohort', valuationTimestamp: '2026-10-20', odometer: round(between(8000, 60000), 100), annualMiles: round(between(8000, 16000), 100), color: '—' }
    if (lease) {
      const pmt = round(between(260, 520))
      const months = 1 + Math.floor(r() * 14)
      const end = new Date(Date.UTC(2026, 9 + months, 24)).toISOString().slice(0, 10)
      return { ...base, monthlyBudget: round(pmt * between(0.85, 1.4)), vehicle, financing: { id: `fin-${id}`, customerId: id, financingType: 'lease' as const, monthlyPayment: pmt, currentBalance: null, remainingMonths: null, interestRate: null, leaseEndDate: end, mileageAllowanceTotal: 36000, excessMileageRate: r() < 0.8 ? 0.15 : null, dispositionFee: r() < 0.5 ? 350 : null, purchaseOptionPrice: round(value * between(0.85, 1.1), 50) } }
    }
    const bal = round(value * between(0.55, 1.25), 100), rem = 18 + Math.floor(r() * 49), apr = round(between(3.9, 11.9), 0.1)
    const pmt = Math.round(payment(bal, apr, rem) * 100) / 100
    return { ...base, monthlyBudget: round(pmt * between(0.8, 1.2)), vehicle, financing: { id: `fin-${id}`, customerId: id, financingType: 'loan' as const, monthlyPayment: pmt, currentBalance: bal, remainingMonths: rem, interestRate: r() < 0.15 ? null : apr, leaseEndDate: null, mileageAllowanceTotal: null, excessMileageRate: null, dispositionFee: null, purchaseOptionPrice: null } }
  })
}

const cache = new Map<string, { customers: CustomerProfile[]; runs: WorkflowResult[] }>()

async function cohortRuns(size: number, seed: number) {
  const k = `${size}:${seed}`
  if (!cache.has(k)) {
    const customers = generateCohort(size, seed)
    registerCohort(customers)
    const runs = await Promise.all(customers.map(c => runWorkflow({ customerId: c.id })))
    cache.set(k, { customers, runs })
  }
  return cache.get(k)!
}

/** Two-proportion sample size per arm (α = 0.05 two-sided, power = 0.8). */
export function sampleSizePerArm(p1: number, p2: number) {
  if (p1 === p2) return null
  const za = 1.959964, zb = 0.841621
  return Math.ceil(((za + zb) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (p1 - p2) ** 2)
}

export async function computeImpact(input: unknown) {
  const cfg = ImpactConfigSchema.parse(input ?? {})
  const { customers, runs } = await cohortRuns(cfg.cohortSize, cfg.seed)
  const n = customers.length
  const evaluated = runs.filter(r => r.status !== 'failed' && r.recommendation).length
  const withOptions = runs.filter(r => r.ranking.some(x => x.eligible)).length
  const human = runs.filter(r => r.signals.some(s => s.id === 'human-support') || r.recommendation?.scenarioKey === 'support').length
  const selfService = evaluated - human
  const challengerRevised = runs.filter(r => r.versions.some(v => v.kind === 'revised')).length
  const qualified = runs.filter(r => (r.recommendation?.qualifications.length ?? 0) > 0).length
  const explored = Math.round(evaluated * cfg.next.exploreRate)
  const selected = Math.round(Math.min(explored, withOptions + human) * cfg.next.selectActionRate)
  const completed = Math.round(selected * cfg.next.completionRate)
  const nextContacts = Math.round(human + selfService * cfg.next.residualContactRate)
  const convContacts = Math.round(n * cfg.conventional.contactRate)
  const convFound = Math.round(n * cfg.conventional.findsRelevantOptionRate)
  const convActed = Math.round(n * cfg.conventional.actionRate)
  const tally = (f: (r: WorkflowResult) => string | undefined) => {
    const m = new Map<string, number>()
    runs.forEach(r => { const k = f(r); if (k) m.set(k, (m.get(k) ?? 0) + 1) })
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }
  const label: Record<string, string> = { keep: 'Keep', refinance: 'Refinance (illustrative)', trade_in: 'Trade in', lease_return: 'Lease return', lease_buyout: 'Lease buyout', support: 'Human support' }
  const retainedGain = n * (cfg.retention.hypotheticalUpliftPts / 100)

  const metric = (id: string, name: string, value: number, of: number | null, kind: 'engine' | 'assumed' | 'hypothetical', formula: string) => ({ id, name, value, of, kind, formula })
  return {
    config: cfg, cohortSize: n,
    metrics: [
      metric('evaluated', 'Goals evaluated', evaluated, n, 'engine', 'Workflows that completed with a validated recommendation'),
      metric('options', 'Relevant option identified', withOptions, n, 'engine', 'At least one scenario passed every hard constraint'),
      metric('revised', 'Challenger revised the first pick', challengerRevised, n, 'engine', 'Workflows with a "revised" recommendation version'),
      metric('qualified', 'Recommendation carried qualifications', qualified, n, 'engine', 'Validated recommendation with ≥1 Challenger qualification'),
      metric('explored', 'Explored scenarios', explored, n, 'assumed', `evaluated × explore rate ${cfg.next.exploreRate}`),
      metric('selected', 'Selected a next action', selected, n, 'assumed', `min(explored, options + human-routed) × select rate ${cfg.next.selectActionRate}`),
      metric('completed', 'Completed the action (simulated)', completed, n, 'assumed', `selected × completion rate ${cfg.next.completionRate}`),
      metric('self', 'Self-service resolution path', selfService, n, 'engine', 'evaluated − human-routed'),
      metric('human', 'Routed to human support', human, n, 'engine', 'Human-support signal or support recommendation'),
    ],
    comparison: {
      conventional: { foundOption: convFound, acted: convActed, contacts: convContacts, minutes: convContacts * cfg.minutesPerContact },
      next: { foundOption: withOptions, acted: selected, contacts: nextContacts, minutes: nextContacts * cfg.minutesPerContact },
      formulas: {
        conventional: `cohort × rates (finds ${cfg.conventional.findsRelevantOptionRate}, acts ${cfg.conventional.actionRate}, contacts ${cfg.conventional.contactRate})`,
        next: `contacts = human-routed + self-service × residual ${cfg.next.residualContactRate}; minutes = contacts × ${cfg.minutesPerContact}`,
      },
    },
    hypothetical: {
      label: 'HYPOTHETICAL MODEL: not an observed result',
      retainedCustomers: Math.round(retainedGain * 10) / 10,
      value: Math.round(retainedGain * cfg.retention.valuePerRetainedCustomer),
      formula: `cohort × ${cfg.retention.hypotheticalUpliftPts} pt assumed retention uplift × $${cfg.retention.valuePerRetainedCustomer} assumed value`,
    },
    distributions: {
      recommendation: tally(r => { const k = r.recommendation?.scenarioKey.split(':')[0]; return k ? label[k] ?? k : undefined }),
      goals: tally(r => r.assumptions?.goal.replace(/_/g, ' ')),
      signals: (() => { const m = new Map<string, number>(); runs.forEach(r => r.signals.forEach(s => m.set(s.title, (m.get(s.title) ?? 0) + 1))); return [...m].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 7) })(),
    },
    experiment: {
      design: 'Randomize eligible customers 50/50 at first visit to the conventional experience or NEXT. Unit: customer. Duration: one full billing cycle plus 30 days.',
      primaryMetric: 'Share of customers who select a next action within 14 days',
      secondary: ['Contact-center contacts per 100 customers', 'Customer-reported decision confidence (post-visit survey)', 'Lower-payment requests resolved without a delinquency event within 90 days', 'Recommendations later overturned by a specialist (safety guardrail)'],
      baselineRate: cfg.conventional.actionRate,
      expectedRate: Math.round((selected / n) * 1000) / 1000,
      samplePerArm: sampleSizePerArm(cfg.conventional.actionRate, selected / n),
      sampleFormula: 'n = (z₀.₉₇₅ + z₀.₈)² · (p₁(1−p₁) + p₂(1−p₂)) / (p₁ − p₂)²',
    },
  }
}
