// "Ask NEXT": answers come from stored, validated results. What-if questions trigger a real re-run.
import { usd } from './finance.ts'
import { runWorkflow } from './engine.ts'
import type { StoredRecommendation } from './db.ts'
import type { CustomerProfile } from './data.ts'
import type { ScenarioResult } from './scenarios.ts'
import type { Dealer, Task } from './action-agent.ts'
import type { Assumptions } from './scenarios.ts'

export type AskActionId = 'open_plan' | 'specialist' | 'payments' | 'twin' | 'settings'
export interface Answer {
  text: string; source: 'deterministic' | 'llm' | 'simulation'; intent: string
  ran?: { overrides: Partial<Assumptions>; recommendedAction: string; headline: string }
  steps?: string[]; links?: { title: string; link: string }[]; actions?: { id: AskActionId; label: string }[]
}

/** What Michi knows beyond the recommendation: the account, the chosen scenario and what its action plan already found. */
export interface AskContext {
  customerName: string; accountId: string; contactPreference: string | null; zip: string | null
  scenarioType: string; termMonths: number | null; newPayment: number | null; target: number; lifetimeCost: number | null
  leaseEnd: string | null; payoff: number | null; officialLinks: { title: string; link: string }[]
  dealer: { name: string; phone: string | null; address: string } | null; recalls: number | null
}

export function askContext(c: CustomerProfile, r: StoredRecommendation, scen: ScenarioResult | undefined, tasks: Task[]): AskContext {
  const done = (k: Task['kind']) => tasks.find(t => t.kind === k && t.status === 'done')?.result
  const dealers = done('find_dealers') as Dealer[] | undefined
  const payoff = done('payoff_estimate') as { amount?: number } | undefined
  return {
    customerName: c.displayName.split(' ')[0], accountId: c.financing.id, contactPreference: c.contactPreference ?? null, zip: c.zip ?? null,
    scenarioType: r.scenarioKey.split(':')[0], termMonths: (scen?.inputSnapshot as { termMonths?: number } | undefined)?.termMonths ?? null,
    newPayment: scen?.monthlyPayment ?? null, target: r.inputs.paymentTarget, lifetimeCost: scen?.lifetimeCost ?? null,
    leaseEnd: c.financing.leaseEndDate, payoff: payoff?.amount ?? null,
    officialLinks: ((done('official_help') as { title: string; link: string }[] | undefined) ?? [{ title: 'Toyota Financial Services', link: 'https://www.toyotafinancial.com' }]).slice(0, 2),
    dealer: dealers?.[0] ? { name: dealers[0].name, phone: dealers[0].phone, address: dealers[0].address } : null,
    recalls: (done('check_recalls') as unknown[] | undefined)?.length ?? null,
  }
}

/** Concrete, ordered steps for the recommended move. Wording only; numbers come from the context. */
export function howToSteps(x: AskContext): string[] {
  const call = `Call Toyota Financial Services (account ${x.accountId})`
  const payoff = x.payoff != null ? `Payoff is about ${usd(x.payoff)}.` : 'Ask TFS for your payoff amount.'
  const dealer = x.dealer ? `${x.dealer.name}${x.dealer.phone ? `, ${x.dealer.phone}` : ''}` : 'a Toyota dealer near you'
  const steps: Record<string, string[]> = {
    refinance: [`${call} and ask for refinance terms${x.termMonths ? ` over ${x.termMonths} months` : ''}.`, payoff, `Compare with Michi’s estimate: ${usd(x.newPayment)}/mo.`, `Over ${usd(x.target)}? Ask for a specialist.`],
    trade_in: [`Get an appraisal at ${dealer}.`, payoff, `Keep the new payment under ${usd(x.target)}/mo.`],
    lease_return: [`Book the return inspection at ${dealer}.`, 'Ask TFS about return fees.', 'Pick your next car on the same visit.'],
    lease_buyout: [`${call} for your purchase quote.`, `Keep the payment under ${usd(x.target)}/mo.`],
    keep: ['Keep paying as usual. Autopay is in Payments.', 'Check back in 3 months.'],
    support: ['Tap “Have a specialist call me”.', `Have account ${x.accountId} ready.`],
  }
  return [...(steps[x.scenarioType] ?? [call + '.']), ...(x.recalls ? [`Free recall repair at ${dealer}.`] : [])]
}

const tfsLinks = (x: AskContext) => x.officialLinks.slice(0, 1).map(l => ({ link: l.link, title: /toyota financial/i.test(l.title) ? l.title : `Toyota Financial Services: ${l.title}` }))

/** Asked "how" again: skip the list and offer to do it for them. */
export function simplestPath(x: AskContext): Answer {
  return {
    source: 'deterministic', intent: 'how_again', links: tfsLinks(x),
    text: 'Easiest way: let Michi set it up. Tap “Have a specialist call me” and a Toyota Financial Services specialist will contact you with your real terms. Michi sends your details, so you don’t have to explain.',
    actions: [{ id: 'specialist', label: 'Have a specialist call me' }, { id: 'open_plan', label: 'Open my action plan' }],
  }
}

export function actionsFor(intent: string, x: AskContext): Answer['actions'] {
  const a: NonNullable<Answer['actions']> = [{ id: 'open_plan', label: 'Open my action plan' }]
  if (intent === 'how' || x.scenarioType === 'support') a.push({ id: 'specialist', label: 'Have a specialist call me' })
  if (intent === 'tradeoffs' || intent === 'alternatives') a.push({ id: 'twin', label: 'Compare my options' })
  if (x.scenarioType === 'keep' || x.scenarioType === 'refinance') a.push({ id: 'payments', label: 'Make a payment' })
  return a
}

export const HOW = /(how|request|apply|contact|call|reach|get in touch|book|appointment|what do i do|where do i|help me|steps|start|do it|go ahead|proceed)/

/** Pulls a hypothetical change out of a question like "what if my budget were $450?" or "over 48 months". */
export function parseWhatIf(q: string): Partial<Assumptions> | null {
  const t = q.toLowerCase()
  if (!/(what if|what happens|suppose|if i|could i|would .* change)/.test(t)) return null
  const o: Partial<Assumptions> = {}
  const money = t.match(/\$\s*(\d[\d,]*)|(\d[\d,]{2,})\s*(?:dollars|\/mo|a month|per month)/)
  const amount = money ? Number((money[1] ?? money[2]).replace(/,/g, '')) : null
  if (amount != null && /(budget|afford|payment|target)/.test(t) && amount >= 50 && amount <= 5000) { o.paymentTarget = amount; o.monthlyBudget = amount }
  else if (amount != null && /(down|put down)/.test(t) && amount <= 100000) o.downPayment = amount
  else if (amount != null && /(worth|value)/.test(t) && amount <= 300000) o.vehicleValue = amount
  const h = t.match(/(\d+)\s*(month|year)/)
  if (h) { const m = Number(h[1]) * (h[2] === 'year' ? 12 : 1); if ([12, 24, 36, 48, 60].includes(m)) o.horizonMonths = m as Assumptions['horizonMonths'] }
  if (/keep (it|the car|my)/.test(t)) o.keepVehicle = true
  if (/(total cost|cheapest overall|minimi[sz]e)/.test(t)) o.goal = 'minimize_cost'
  return Object.keys(o).length ? o : null
}

export function deterministicAnswer(q: string, r: StoredRecommendation, x?: AskContext): Answer {
  const t = q.toLowerCase()
  const pick = (i: string, text: string): Answer => ({ text, source: 'deterministic', intent: i, ...(x ? { actions: actionsFor(i, x) } : {}) })
  if (x && HOW.test(t) && !/(how much|how many)/.test(t)) {
    const steps = howToSteps(x)
    return { ...pick('how', 'Here’s how:'), steps, links: tfsLinks(x) }
  }
  if (/(offer|approv|eligib|qualif|guarantee|rate .*get|can i get)/.test(t))
    return pick('eligibility', 'Michi cannot determine approval, eligibility or what rate you would be offered. Every rate shown is an illustrative assumption you can change in NEXT Twin. To get actual terms, contact Toyota Financial Services; Next Steps can prepare a summary for that call.')
  if (/(assum|based on|inputs?)/.test(t)) return pick('assumptions', 'This recommendation is based on: ' + r.assumptions.join('; ') + '.')
  if (/(missing|don.t know|unknown|data|confiden|sure)/.test(t))
    return pick('data_quality', `Data quality: ${r.dataQuality.level}. ${r.missingInformation.length ? 'Not included: ' + r.missingInformation.join('; ') + '.' : 'No missing inputs.'}`)
  if (/(cost|total|interest|expensive|pay more|catch|downside|trade.?off)/.test(t))
    return pick('tradeoffs', [...r.tradeoffs, ...r.qualifications].join(' ') || 'No material trade-offs were found against the baseline.')
  if (/(other|alternative|instead|else|compare|why not)/.test(t))
    return pick('alternatives', 'Alternatives considered: ' + r.alternatives.map(a => `${a.label} (${a.whyNot})`).join('; ') + '.')
  if (/(next|do now|step|start)/.test(t)) return pick('next_action', r.nextAction)
  return pick('explain', r.explanation)
}

export async function whatIfAnswer(customerId: string, base: Assumptions, overrides: Partial<Assumptions>, current: StoredRecommendation): Promise<Answer> {
  const run = await runWorkflow({ customerId, overrides: { ...base, ...overrides } })
  const rec = run.recommendation
  if (!rec) return { text: `I couldn't complete that simulation: ${run.error ?? 'unknown error'}.`, source: 'simulation', intent: 'what_if' }
  const same = rec.scenarioKey === current.scenarioKey
  const changes = Object.entries(overrides).map(([k, v]) => `${k} = ${typeof v === 'number' && !/Months|Pct/.test(k) ? usd(v) : v}`).join(', ')
  return {
    source: 'simulation', intent: 'what_if', ran: { overrides, recommendedAction: rec.recommendedAction, headline: rec.headline },
    text: `I re-ran the full workflow with ${changes}. ${same ? 'The recommended move stays the same' : 'The recommended move would change'}: ${rec.headline}. ${rec.qualifications[0] ?? ''} This is a hypothetical run; your saved recommendation is unchanged. Apply it in NEXT Twin to keep it.`.trim(),
  }
}
