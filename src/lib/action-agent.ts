// Michi's action agent: plan → act with real tools → observe → adapt, with the customer approving anything consequential.
// Bounded (≤ MAX_TASKS), every tool call logged, results persisted per recommendation.
import { getCustomer, type CustomerProfile, type Vehicle } from './data.ts'
import { store as defaultStore, type Store, type StoredRecommendation } from './db.ts'
import { usd } from './finance.ts'
import { lookupMarketValue, serpConfigured, type MarketLookup } from './market.ts'
import { previewPayment } from './payments.ts'
import { SettingsSchema, toProfileEdit } from './profile.ts'
import { invokeTool } from './tools.ts'

export type TaskKind = 'check_recalls' | 'market_value' | 'find_dealers' | 'official_help' | 'payoff_estimate' | 'set_reminder' | 'specialist_summary' | 'book_appointment' | 'update_value'
export type TaskStatus = 'pending' | 'running' | 'done' | 'needs_you' | 'failed' | 'skipped'
export interface Task {
  id: string; customerId: string; recommendationId: string; seq: number; kind: TaskKind
  title: string; why: string; tool: string; status: TaskStatus; summary: string | null; result: unknown
  addedBy: 'plan' | 'adapted'; params?: Record<string, unknown>; updatedAt: string
}
export interface Recall { component: string; summary: string; remedy: string; campaign: string; date: string }
export interface Dealer { name: string; address: string; phone: string | null; rating: number | null; reviews: number | null; website: string | null; mapsUrl: string }
export interface Link { title: string; link: string }

/** External tools, injectable so tests never touch the network. */
export interface AgentTools {
  recalls(v: Vehicle, signal: AbortSignal): Promise<Recall[]>
  market(v: Vehicle, signal: AbortSignal): Promise<MarketLookup>
  dealers(zip: string, signal: AbortSignal): Promise<Dealer[]>
  officialHelp(topic: string, signal: AbortSignal): Promise<Link[]>
}

export const MAX_TASKS = 10
const CONFIRM: TaskKind[] = ['specialist_summary', 'book_appointment', 'update_value']
const TOOL: Record<TaskKind, string> = {
  check_recalls: 'nhtsa.recalls', market_value: 'serpapi.google', find_dealers: 'serpapi.google_maps', official_help: 'serpapi.google',
  payoff_estimate: 'quote_payment', set_reminder: 'calendar', specialist_summary: 'create_customer_action', book_appointment: 'create_customer_action', update_value: 'profile.update',
}

// ---------- live tools ----------
const cache = new Map<string, { at: number; v: unknown }>()
async function cached<T>(key: string, f: () => Promise<T>): Promise<T> { // ponytail: in-memory 1h cache to save SerpApi credits
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 3600_000) return hit.v as T
  const v = await f(); cache.set(key, { at: Date.now(), v }); return v
}
async function serp(params: Record<string, string>, signal: AbortSignal) {
  if (!serpConfigured()) throw new Error('Live search needs SERPAPI_KEY')
  const res = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ hl: 'en', gl: 'us', ...params, api_key: process.env.SERPAPI_KEY! })}`, { signal, cache: 'no-store' })
  const j = await res.json()
  if (!res.ok || j.error) throw new Error(j.error ?? `SerpApi ${res.status}`)
  return j
}
const firstSentence = (s = '', max = 170) => { const t = s.split(/(?<=\.)\s/)[0] ?? ''; return t.length > max ? t.slice(0, max - 1) + '…' : t }

export const liveTools: AgentTools = {
  recalls: (v, signal) => cached(`recalls:${v.year}:${v.model}`, async () => {
    const res = await fetch(`https://api.nhtsa.gov/recalls/recallsByVehicle?${new URLSearchParams({ make: v.make, model: v.model, modelYear: String(v.year) })}`, { signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`NHTSA ${res.status}`)
    return ((await res.json()).results ?? []).map((r: Record<string, string>) => ({
      component: (r.Component ?? '').split(':')[0].toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()),
      summary: firstSentence(r.Summary), remedy: firstSentence(r.Remedy), campaign: r.NHTSACampaignNumber, date: r.ReportReceivedDate,
    }))
  }),
  market: (v, signal) => cached(`market:${v.year}:${v.model}:${v.trim}`, () => lookupMarketValue(v, signal)),
  dealers: (zip, signal) => cached(`dealers:${zip}`, async () => {
    const j = await serp({ engine: 'google_maps', type: 'search', q: `Toyota dealership near ${zip}` }, signal)
    return ((j.local_results ?? []) as Record<string, unknown>[])
      .filter(p => /toyota/i.test(String(p.title)) && !/pre-owned|parts|collision/i.test(String(p.title))).slice(0, 3)
      .map(p => ({
        name: String(p.title), address: String(p.address ?? ''), phone: (p.phone as string) ?? null, rating: (p.rating as number) ?? null,
        reviews: (p.reviews as number) ?? null, website: (p.website as string) ?? null,
        mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.title} ${p.address ?? ''}`)}`,
      }))
  }),
  officialHelp: (topic, signal) => cached(`help:${topic}`, async () => {
    if (!serpConfigured()) return [{ title: 'Toyota Financial Services', link: 'https://www.toyotafinancial.com' }]
    const j = await serp({ engine: 'google', q: `site:toyotafinancial.com ${topic}` }, signal)
    const out = ((j.organic_results ?? []) as Record<string, string>[]).slice(0, 3).map(r => ({ title: r.title, link: r.link }))
    return out.length ? out : [{ title: 'Toyota Financial Services', link: 'https://www.toyotafinancial.com' }]
  }),
}

// ---------- planning ----------
type Draft = Pick<Task, 'kind' | 'title' | 'why'> & { params?: Record<string, unknown> }
const addDays = (iso: string, d: number) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10) }

export function planFor(c: CustomerProfile, rec: Pick<StoredRecommendation, 'scenarioKey'>): Draft[] {
  const type = rec.scenarioKey.split(':')[0], v = c.vehicle
  const recalls: Draft = { kind: 'check_recalls', title: 'Check for safety recalls', why: `Any open recall on a ${v.year} ${v.model} should be fixed first, and it’s free.` }
  const value: Draft = { kind: 'market_value', title: 'See what your car is worth today', why: 'Real listings near today’s prices, to check our estimate.' }
  const payoff: Draft = { kind: 'payoff_estimate', title: c.financing.financingType === 'lease' ? 'Know your lease purchase price' : 'Know your payoff amount', why: 'The number a lender or dealer will ask for.' }
  const plans: Record<string, Draft[]> = {
    refinance: [payoff, { kind: 'official_help', title: 'Get official refinance help', why: 'Real terms come from Toyota Financial Services, not this estimate.', params: { topic: 'refinance loan contact' } }, recalls,
      { kind: 'set_reminder', title: 'Remind me to compare real terms', why: 'Decide within a month while your numbers are fresh.', params: { days: 30 } }],
    trade_in: [value, { kind: 'find_dealers', title: 'Find a Toyota dealer near you', why: 'For an appraisal and to see the replacement car.', params: { purpose: 'trade-in appraisal' } }, payoff, recalls],
    lease_return: [recalls, { kind: 'find_dealers', title: 'Find where to return your lease', why: 'A Toyota dealer handles the return inspection.', params: { purpose: 'lease-return inspection' } },
      { kind: 'official_help', title: 'Read the official lease-end guide', why: 'Fees and steps come from your contract.', params: { topic: 'lease end return' } },
      { kind: 'set_reminder', title: 'Remind me to book the inspection', why: 'Book it about 45 days before the lease ends.', params: { date: c.financing.leaseEndDate ? addDays(c.financing.leaseEndDate, -45) : null } }],
    lease_buyout: [value, payoff, { kind: 'official_help', title: 'Read the official lease purchase steps', why: 'The buyout quote and fees come from Toyota Financial Services.', params: { topic: 'lease purchase buyout' } },
      { kind: 'set_reminder', title: 'Remind me before the lease ends', why: 'Give yourself time to arrange the purchase.', params: { date: c.financing.leaseEndDate ? addDays(c.financing.leaseEndDate, -45) : null } }],
    keep: [recalls, value, { kind: 'set_reminder', title: 'Check in again in 3 months', why: 'Your balance and car value will have changed.', params: { days: 90 } }],
    support: [{ kind: 'specialist_summary', title: 'Send your situation to a specialist', why: 'Michi writes it up so you don’t have to explain twice.' },
      { kind: 'official_help', title: 'Find official payment help', why: 'Toyota Financial Services lists the options it offers.', params: { topic: 'payment assistance' } }, recalls],
  }
  return plans[type] ?? [recalls]
}

/** Observe → adapt: new steps that follow from what a finished step found. */
export function adapt(t: Task, all: Task[], c: CustomerProfile): Draft[] {
  const has = (k: TaskKind) => all.some(x => x.kind === k)
  const out: Draft[] = []
  if (t.kind === 'check_recalls' && (t.result as Recall[]).length) {
    if (!has('find_dealers')) out.push({ kind: 'find_dealers', title: 'Find a dealer to fix the recall', why: 'Recall repairs are done by Toyota dealers at no cost.', params: { purpose: 'recall repair' } })
    else if (!has('book_appointment')) out.push({ kind: 'book_appointment', title: 'Request a recall repair appointment', why: `${(t.result as Recall[]).length} recall(s) found for your model year.`, params: { purpose: 'recall repair' } })
  }
  if (t.kind === 'market_value') {
    const m = t.result as MarketLookup, est = c.vehicle.estimatedMarketValue
    if (m.median && Math.abs(m.median - est) / est > 0.08 && !has('update_value'))
      out.push({ kind: 'update_value', title: `Update your car’s value to ${usd(m.median)}?`, why: `Listings suggest ${usd(m.median)}, ${Math.round(Math.abs(m.median - est) / est * 100)}% ${m.median > est ? 'above' : 'below'} our ${usd(est)} estimate. Michi will re-check your options.`, params: { value: m.median } })
  }
  if (t.kind === 'find_dealers' && (t.result as Dealer[]).length && !has('book_appointment')) {
    const purpose = String(t.params?.purpose ?? 'appointment')
    out.push({ kind: 'book_appointment', title: `Request a ${purpose} appointment`, why: 'Pick a dealer and Michi prepares the request for you.', params: { purpose } })
  }
  return out
}

// ---------- acting ----------
function withTimeout<T>(f: (s: AbortSignal) => Promise<T>, ms = 15000): Promise<T> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms)
  return f(ctl.signal).finally(() => clearTimeout(t))
}

async function execute(t: Task, c: CustomerProfile, tools: AgentTools): Promise<Pick<Task, 'status' | 'summary' | 'result'>> {
  const v = c.vehicle
  switch (t.kind) {
    case 'check_recalls': {
      const r = await withTimeout(s => tools.recalls(v, s))
      return { status: 'done', result: r, summary: r.length ? `${r.length} recall campaign(s) for the ${v.year} ${v.model}: ${r.map(x => x.component).join(', ')}. Check your VIN to confirm.` : `No recalls listed for the ${v.year} ${v.model}.` }
    }
    case 'market_value': {
      const m = await withTimeout(s => tools.market(v, s))
      return { status: 'done', result: m, summary: m.median ? `Listings run ${usd(m.low)}–${usd(m.high)}, typically about ${usd(m.median)} (${m.count} prices).` : 'Not enough listings to give a range.' }
    }
    case 'find_dealers': {
      if (!c.zip) return { status: 'needs_you', result: { needs: 'zip' }, summary: 'Add your ZIP code in Settings so Michi can find dealers near you.' }
      const d = await withTimeout(s => tools.dealers(c.zip!, s))
      return { status: 'done', result: d, summary: d.length ? `${d.length} Toyota dealers near ${c.zip}. Closest: ${d[0].name}.` : `No Toyota dealers found near ${c.zip}.` }
    }
    case 'official_help': {
      const l = await withTimeout(s => tools.officialHelp(String(t.params?.topic ?? 'help'), s))
      return { status: 'done', result: l, summary: `${l.length} official Toyota Financial Services page(s) found.` }
    }
    case 'payoff_estimate': {
      if (c.financing.financingType === 'lease') return { status: 'done', result: { amount: c.financing.purchaseOptionPrice }, summary: `Your contract’s purchase price is ${usd(c.financing.purchaseOptionPrice)}, before fees and tax.` }
      const q = invokeTool('quote_payment', { customerId: c.id, kind: 'payoff' }, { stage: 'action' })
      return { status: 'done', result: q, summary: `About ${usd(q.amount)} to pay off today. Ask TFS for the official quote.` }
    }
    case 'set_reminder': {
      const date = (t.params?.date as string | null) ?? addDays(new Date().toISOString().slice(0, 10), Number(t.params?.days ?? 30))
      return { status: 'done', result: { date, title: t.title.replace(/^Remind me to /, '').replace(/^\w/, x => x.toUpperCase()) }, summary: `Reminder set for ${new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. Add it to your calendar.` }
    }
    default:
      return { status: 'needs_you', result: null, summary: 'Waiting for your OK.' }
  }
}

const now = () => new Date().toISOString()
const uid = () => `tsk-${crypto.randomUUID().slice(0, 8)}`

// One run per customer at a time: a second request waits, then reuses the plan the first one built.
const locks = new Map<string, Promise<unknown>>()
type RunOpts = { tools?: AgentTools; db?: Store; force?: boolean; onTask?: (t: Task) => void }
export function runPlan(customerId: string, opts: RunOpts = {}) {
  const run = (locks.get(customerId) ?? Promise.resolve()).then(() => runPlanNow(customerId, opts))
  locks.set(customerId, run.catch(() => {}))
  return run
}

async function runPlanNow(customerId: string, opts: RunOpts) {
  const db = opts.db ?? defaultStore(), tools = opts.tools ?? liveTools
  const c = getCustomer(customerId), rec = db.listRecommendations(customerId, 1)[0]
  if (!c || !rec) throw new Error('Michi needs a recommendation before planning next steps')
  if (opts.force) db.clearTasks(customerId, rec.id) // start over replaces the plan, never stacks a second one
  let tasks = db.listTasks<Task>(customerId, rec.id)
  const save = (t: Task) => { t.updatedAt = now(); db.saveTask(t); opts.onTask?.(t); return t }
  const add = (d: Draft, by: Task['addedBy']) => {
    if (tasks.length >= MAX_TASKS) return
    tasks.push(save({ id: uid(), customerId, recommendationId: rec.id, seq: tasks.length + 1, ...d, tool: TOOL[d.kind], status: 'pending', summary: null, result: null, addedBy: by, updatedAt: now() }))
  }
  if (!tasks.length) planFor(c, rec).forEach(d => add(d, 'plan'))
  else tasks.forEach(t => { // a re-run retries failures and steps that were waiting on Settings (e.g. ZIP)
    if (t.status === 'failed' || (t.kind === 'find_dealers' && t.status === 'needs_you')) t.status = 'pending'
    opts.onTask?.(t)
  })

  for (let i = 0; i < tasks.length; i++) { // tasks may grow as the agent adapts; bounded by MAX_TASKS
    const t = tasks[i]
    if (t.status !== 'pending') continue
    if (CONFIRM.includes(t.kind)) { Object.assign(t, { status: 'needs_you', summary: 'Waiting for your OK.' }); save(t); continue }
    save(Object.assign(t, { status: 'running' }))
    try { Object.assign(t, await execute(t, getCustomer(customerId)!, tools)) }
    catch (e) { Object.assign(t, { status: 'failed', summary: `Couldn’t finish: ${(e as Error).message}` }) }
    save(t)
    const status = t.status as TaskStatus // mutated by execute(); TS still narrows it to 'pending'
    db.logToLatest(customerId, { stage: 'action', label: `Michi: ${t.title}`, toolName: t.tool, status: status === 'failed' ? 'failed' : status === 'needs_you' ? 'needs_attention' : 'completed', inputSummary: t.params ? JSON.stringify(t.params).slice(0, 120) : t.kind, outputSummary: t.summary ?? '' })
    if (status === 'done') adapt(t, tasks, c).forEach(d => add(d, 'adapted'))
  }
  return { tasks, briefing: briefing(tasks) }
}

export function briefing(tasks: Task[]) {
  const done = tasks.filter(t => t.status === 'done').length, you = tasks.filter(t => t.status === 'needs_you'), failed = tasks.filter(t => t.status === 'failed').length
  const adapted = tasks.filter(t => t.addedBy === 'adapted').length
  return [`Michi finished ${done} of ${tasks.length} steps.`, adapted ? `It added ${adapted} step${adapted > 1 ? 's' : ''} based on what it found.` : '',
    you.length ? `${you.length} need${you.length === 1 ? 's' : ''} your OK: ${you.map(t => t.title.replace(/\?$/, '')).join('; ')}.` : 'Nothing needs your OK right now.', failed ? `${failed} couldn’t finish; you can try again.` : ''].filter(Boolean).join(' ')
}

/** Customer approves a waiting step. Only here do consequential actions happen. */
export async function approveTask(customerId: string, taskId: string, choice: { dealerIndex?: number; when?: string } = {}, db: Store = defaultStore()) {
  const c = getCustomer(customerId), rec = db.listRecommendations(customerId, 1)[0]
  if (!c || !rec) throw new Error('Unknown customer or no recommendation')
  const tasks = db.listTasks<Task>(customerId, rec.id), t = tasks.find(x => x.id === taskId)
  if (!t || t.status !== 'needs_you') throw new Error('That step is not waiting for approval')
  let rerun = false
  if (t.kind === 'specialist_summary') {
    const details = [`Situation: ${c.displayName}, ${c.vehicle.year} ${c.vehicle.model}, ${usd(c.financing.monthlyPayment)}/mo, budget ${usd(c.monthlyBudget)}/mo.`, `Michi’s suggestion: ${rec.recommendedAction} (${rec.headline}).`, ...rec.qualifications.map(q => `Open question: ${q}`), `Contact preference: ${c.contactPreference ?? 'not set'}.`]
    const a = invokeTool('create_customer_action', { customerId, recommendationId: rec.id, actionType: 'human_handoff', title: 'Specialist request from Michi', details }, { stage: 'action', store: db })
    Object.assign(t, { status: 'done', result: { actionId: a.id, details }, summary: 'Your summary is ready for a Toyota specialist (simulated; nothing was sent).' })
  } else if (t.kind === 'book_appointment') {
    const dealers = (tasks.find(x => x.kind === 'find_dealers' && x.status === 'done')?.result as Dealer[] | undefined) ?? []
    const d = dealers[choice.dealerIndex ?? 0]
    if (!d) throw new Error('Find a dealer first')
    const purpose = String(t.params?.purpose ?? 'appointment'), when = choice.when ?? 'Next available weekday morning'
    const a = invokeTool('create_customer_action', { customerId, recommendationId: rec.id, actionType: 'follow_up', title: `Appointment request: ${purpose} at ${d.name}`, details: [`Dealer: ${d.name}, ${d.address}`, d.phone ? `Phone: ${d.phone}` : 'Phone: see website', `Preferred time: ${when}`, `Vehicle: ${c.vehicle.year} ${c.vehicle.model}${c.vehicle.vin ? `, VIN ${c.vehicle.vin}` : ''}`, 'Prepared by Michi. The dealer is not contacted automatically in this prototype; call to confirm.'] }, { stage: 'action', store: db })
    Object.assign(t, { status: 'done', result: { actionId: a.id, dealer: d, when }, summary: `Request ready for ${d.name}${d.phone ? `. Call ${d.phone} to confirm` : ''}. Added to your tracked steps.` })
  } else if (t.kind === 'update_value') {
    const value = Number(t.params?.value)
    const settings = SettingsSchema.parse({ ...db.getSettings(customerId), estimatedMarketValue: value })
    db.saveSettings(customerId, settings, toProfileEdit(settings))
    Object.assign(t, { status: 'done', result: { value }, summary: `Your car’s value is now ${usd(value)} (from web listings). Michi is re-checking your options.` })
    rerun = true
  } else throw new Error('Nothing to approve for this step')
  db.saveTask(Object.assign(t, { updatedAt: now() }))
  db.logToLatest(customerId, { stage: 'action', label: `Customer approved: ${t.title}`, toolName: t.tool, status: 'completed', inputSummary: JSON.stringify(choice).slice(0, 100), outputSummary: t.summary ?? '' })
  return { tasks, briefing: briefing(tasks), rerun }
}

export function dismissTask(customerId: string, taskId: string, db: Store = defaultStore()) {
  const rec = db.listRecommendations(customerId, 1)[0]
  const tasks = rec ? db.listTasks<Task>(customerId, rec.id) : [], t = tasks.find(x => x.id === taskId)
  if (!t || !['needs_you', 'failed', 'pending'].includes(t.status)) throw new Error('That step can’t be skipped')
  db.saveTask(Object.assign(t, { status: 'skipped', summary: 'Skipped by you.', updatedAt: now() }))
  return { tasks, briefing: briefing(tasks) }
}

