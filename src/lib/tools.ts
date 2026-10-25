import { z } from 'zod'
import { getCustomer, type CustomerProfile } from './data.ts'
import { balanceAfter, round2 } from './finance.ts'
import {
  AssumptionsSchema, currentApr, simulateKeep, simulateLeaseEnd, simulateRefinance, simulateSupport, simulateTradeIn,
  type Assumptions, type ScenarioResult,
} from './scenarios.ts'
import {
  ACTION_TYPES, compareScenarios, detectSignals, prepareActionPlan, rankScenarios, validateRecommendation,
  type Recommendation, type Validation,
} from './decision.ts'
import { PAYMENT_KINDS, previewPayment } from './payments.ts'

export const STAGES = ['context', 'investigation', 'simulation', 'challenger', 'decision', 'action'] as const
export type Stage = typeof STAGES[number]

export interface ActionRecord { id: string; customerId: string; recommendationId: string | null; actionType: string; title: string; details: string[]; status: 'open' | 'completed' | 'cancelled'; createdAt: string; completedAt: string | null }
export interface ActionStore {
  createAction(a: Omit<ActionRecord, 'id' | 'createdAt' | 'completedAt' | 'status'>): ActionRecord
  updateAction(id: string, status: ActionRecord['status']): ActionRecord | null
}

export interface ToolContext { stage: Stage; store?: ActionStore; faults?: Record<string, 'throw' | 'bad_output'> }

const Id = z.string().min(1).max(64).regex(/^[\w-]+$/)
const Num = z.number().finite()
const NumN = Num.nullable()

const ScenarioOut = z.looseObject({
  id: z.string(), type: z.string(), label: z.string(), computed: z.boolean(), horizonMonths: z.number().int(),
  monthlyPayment: NumN, paymentsOverHorizon: NumN, balanceAtHorizon: NumN, netCostOverHorizon: NumN, lifetimeCost: NumN,
  assumptions: z.array(z.object({ label: z.string(), value: z.string(), kind: z.string() })),
  missing: z.array(z.string()), limitations: z.array(z.string()),
})

const customerOf = (id: string): CustomerProfile => {
  const c = getCustomer(id)
  if (!c) throw new Error(`Unknown customer ${id}`)
  return c
}

const ScenarioInput = z.object({ customerId: Id, assumptions: AssumptionsSchema })
const ScenarioList = z.array(ScenarioOut).max(30)

interface ToolDef<I extends z.ZodType, O extends z.ZodType> {
  name: string; description: string; stages: Stage[]; input: I; output: O
  run: (input: z.infer<I>, ctx: ToolContext) => unknown
}
const tool = <I extends z.ZodType, O extends z.ZodType>(t: ToolDef<I, O>) => t

export const TOOLS = {
  get_customer_context: tool({
    name: 'get_customer_context', description: 'Retrieve the synthetic customer profile, vehicle, financing and provenance.', stages: ['context'],
    input: z.object({ customerId: Id }),
    output: z.looseObject({ customer: z.looseObject({ id: z.string() }), provenance: z.record(z.string(), z.string()), missingFields: z.array(z.string()) }),
    run: ({ customerId }) => {
      const c = customerOf(customerId), f = c.financing
      const provenance: Record<string, string> = { monthlyPayment: 'supplied', estimatedMarketValue: 'synthetic' }
      const missingFields: string[] = []
      const field = (k: keyof typeof f, required: boolean) => {
        if (f[k] == null) { if (required) { missingFields.push(k); provenance[k] = 'missing' } } else provenance[k] = 'supplied'
      }
      if (f.financingType === 'loan') { field('currentBalance', true); field('remainingMonths', true); field('interestRate', true) }
      else { field('leaseEndDate', true); field('mileageAllowanceTotal', true); field('excessMileageRate', true); field('dispositionFee', true); field('purchaseOptionPrice', true) }
      return { customer: c, provenance, missingFields }
    },
  }),

  calculate_current_loan_position: tool({
    name: 'calculate_current_loan_position', description: 'Balance, APR and scheduled payments over the horizon for the current loan.', stages: ['investigation'],
    input: z.object({ customerId: Id, horizonMonths: z.number().int().min(1).max(84) }),
    output: z.object({ balance: Num, aprPct: Num, aprKind: z.string(), payment: Num, remainingMonths: z.number().int(), scheduledPayments: Num, balanceAtHorizon: Num, warnings: z.array(z.string()) }),
    run: ({ customerId, horizonMonths }) => {
      const c = customerOf(customerId), f = c.financing, rate = currentApr(c)
      if (f.financingType !== 'loan' || f.currentBalance == null || f.remainingMonths == null) throw new Error('Not a loan account')
      if (!rate) throw new Error('APR is missing and cannot be derived from balance, payment and term')
      const k = Math.min(horizonMonths, f.remainingMonths)
      return {
        balance: f.currentBalance, aprPct: rate.apr, aprKind: rate.provenance, payment: f.monthlyPayment, remainingMonths: f.remainingMonths,
        scheduledPayments: round2(f.monthlyPayment * k), balanceAtHorizon: round2(balanceAfter(f.currentBalance, rate.apr, f.remainingMonths, horizonMonths, f.monthlyPayment)),
        warnings: rate.provenance === 'derived' ? ['APR not on file; derived from balance, payment and remaining term.'] : [],
      }
    },
  }),

  simulate_keep_vehicle: tool({
    name: 'simulate_keep_vehicle', description: 'Project the current loan unchanged over the horizon.', stages: ['simulation'],
    input: ScenarioInput, output: ScenarioOut,
    run: ({ customerId, assumptions }) => simulateKeep(customerOf(customerId), assumptions),
  }),

  simulate_refinancing: tool({
    name: 'simulate_refinancing', description: 'Illustrative refinance at an explicitly supplied rate and term. Never an offer.', stages: ['simulation', 'challenger'],
    input: ScenarioInput.extend({ termMonths: z.number().int().min(12).max(84).optional(), aprPct: z.number().min(0).max(40).optional(), sensitivityOf: z.string().optional() }),
    output: ScenarioOut,
    run: ({ customerId, assumptions, ...o }) => simulateRefinance(customerOf(customerId), assumptions, o),
  }),

  simulate_trade_in: tool({
    name: 'simulate_trade_in', description: 'Trade-in plus illustrative replacement financing.', stages: ['simulation', 'challenger'],
    input: ScenarioInput.extend({ aprPct: z.number().min(0).max(40).optional(), sensitivityOf: z.string().optional() }),
    output: ScenarioOut,
    run: ({ customerId, assumptions, ...o }) => simulateTradeIn(customerOf(customerId), assumptions, o),
  }),

  simulate_lease_end: tool({
    name: 'simulate_lease_end', description: 'Lease return or buyout using only contract inputs on file.', stages: ['simulation', 'challenger'],
    input: ScenarioInput.extend({ option: z.enum(['return', 'buyout']) }), output: ScenarioOut,
    run: ({ customerId, assumptions, option }) => simulateLeaseEnd(customerOf(customerId), assumptions, option),
  }),

  simulate_support_options: tool({
    name: 'simulate_support_options', description: 'Non-financial placeholder: points to TFS for options NEXT cannot evaluate.', stages: ['simulation'],
    input: ScenarioInput, output: ScenarioOut,
    run: ({ customerId, assumptions }) => simulateSupport(customerOf(customerId), assumptions),
  }),

  compare_scenarios: tool({
    name: 'compare_scenarios', description: 'Comparable deltas, goal fit and trade-offs over one horizon.', stages: ['simulation'],
    input: z.object({ scenarios: ScenarioList, assumptions: AssumptionsSchema }),
    output: z.array(z.looseObject({ scenarioId: z.string(), label: z.string() })),
    run: ({ scenarios, assumptions }) => compareScenarios(scenarios as unknown as ScenarioResult[], assumptions),
  }),

  validate_recommendation: tool({
    name: 'validate_recommendation', description: 'Challenger rules over actual scenario outputs.', stages: ['challenger'],
    input: z.object({ candidateId: z.string(), scenarios: ScenarioList, assumptions: AssumptionsSchema }),
    output: z.looseObject({ status: z.enum(['approved', 'qualified', 'revise', 'blocked']), findings: z.array(z.looseObject({ code: z.string() })), canPresent: z.boolean() }),
    run: ({ candidateId, scenarios, assumptions }) => validateRecommendation(candidateId, scenarios as unknown as ScenarioResult[], assumptions),
  }),

  rank_scenarios: tool({
    name: 'rank_scenarios', description: 'Hard constraints first, then the published scoring formula.', stages: ['decision'],
    input: z.object({ scenarios: ScenarioList, assumptions: AssumptionsSchema }),
    output: z.array(z.looseObject({ scenarioId: z.string(), eligible: z.boolean() })),
    run: ({ scenarios, assumptions }) => rankScenarios(scenarios as unknown as ScenarioResult[], assumptions),
  }),

  detect_signals: tool({
    name: 'detect_signals', description: 'Transparent rule-based signals.', stages: ['action'],
    input: z.object({ customerId: Id, assumptions: AssumptionsSchema, scenarios: ScenarioList, validation: z.any() }),
    output: z.array(z.looseObject({ id: z.string(), title: z.string(), urgency: z.enum(['info', 'watch', 'act']) })),
    run: ({ customerId, assumptions, scenarios, validation }) => detectSignals(customerOf(customerId), assumptions, scenarios as unknown as ScenarioResult[], (validation ?? null) as Validation | null),
  }),

  prepare_action_plan: tool({
    name: 'prepare_action_plan', description: 'Proposed next steps. Proposals only; nothing is created until the customer confirms.', stages: ['action'],
    input: z.object({ customerId: Id, recommendation: z.looseObject({ scenarioKey: z.string(), missingInformation: z.array(z.string()) }), scenarios: ScenarioList }),
    output: z.array(z.object({ actionType: z.enum(ACTION_TYPES), title: z.string(), details: z.array(z.string()) })),
    run: ({ customerId, recommendation, scenarios }) => prepareActionPlan(customerOf(customerId), recommendation as unknown as Recommendation, scenarios as unknown as ScenarioResult[]),
  }),

  create_customer_action: tool({
    name: 'create_customer_action', description: 'Create a tracked next step for the customer. Simulated; no external transaction.', stages: ['action'],
    input: z.object({ customerId: Id, recommendationId: z.string().max(64).nullable(), actionType: z.enum(ACTION_TYPES), title: z.string().min(1).max(160), details: z.array(z.string().max(500)).max(30) }),
    output: z.looseObject({ id: z.string(), status: z.literal('open'), createdAt: z.string() }),
    run: (input, ctx) => {
      if (!ctx.store) throw new Error('Action store unavailable')
      customerOf(input.customerId)
      return ctx.store.createAction(input)
    },
  }),

  quote_payment: tool({
    name: 'quote_payment', description: 'Quote a monthly, extra-principal or payoff payment on the current account. Quotes only; never moves money.', stages: ['action'],
    input: z.object({ customerId: Id, kind: z.enum(PAYMENT_KINDS), amount: z.number().positive().max(500000).optional() }),
    output: z.looseObject({ kind: z.enum(PAYMENT_KINDS), amount: Num, balanceAfter: NumN }),
    run: ({ customerId, kind, amount }) => previewPayment(customerOf(customerId), kind, amount),
  }),

  update_customer_action: tool({
    name: 'update_customer_action', description: 'Mark a next step completed or cancelled at the customer’s request.', stages: ['action'],
    input: z.object({ actionId: Id, status: z.enum(['open', 'completed', 'cancelled']) }),
    output: z.looseObject({ id: z.string(), status: z.string() }),
    run: ({ actionId, status }, ctx) => {
      if (!ctx.store) throw new Error('Action store unavailable')
      const r = ctx.store.updateAction(actionId, status)
      if (!r) throw new Error(`Unknown action ${actionId}`)
      return r
    },
  }),
}

export type ToolName = keyof typeof TOOLS

export class ToolError extends Error {
  tool: string; kind: 'not_permitted' | 'invalid_input' | 'execution' | 'invalid_output'
  constructor(tool: string, kind: ToolError['kind'], message: string) { super(message); this.tool = tool; this.kind = kind }
}

/** The only way an agent stage can act. Validates permission, input and output; never reports success it didn't get. */
export function invokeTool<N extends ToolName>(name: N, rawInput: unknown, ctx: ToolContext): z.infer<(typeof TOOLS)[N]['output']> {
  const t = TOOLS[name] as ToolDef<z.ZodType, z.ZodType>
  if (!t) throw new ToolError(String(name), 'not_permitted', `No such tool: ${String(name)}`)
  if (!t.stages.includes(ctx.stage)) throw new ToolError(name, 'not_permitted', `${name} is not available to the ${ctx.stage} stage`)
  const parsed = t.input.safeParse(rawInput)
  if (!parsed.success) throw new ToolError(name, 'invalid_input', z.prettifyError(parsed.error))
  let out: unknown
  try {
    if (ctx.faults?.[name] === 'throw') throw new Error('Injected fault')
    out = t.run(parsed.data, ctx)
    if (ctx.faults?.[name] === 'bad_output') out = { garbage: true }
  } catch (e) {
    throw new ToolError(name, 'execution', (e as Error).message)
  }
  const checked = t.output.safeParse(out)
  if (!checked.success) throw new ToolError(name, 'invalid_output', z.prettifyError(checked.error))
  return out as z.infer<(typeof TOOLS)[N]['output']>
}

export type { Assumptions }
