import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openStore } from './db.ts'
import { runWorkflow } from './engine.ts'
import { getCustomer } from './data.ts'
import { approveTask, dismissTask, planFor, runPlan, type AgentTools } from './action-agent.ts'

const fake = (over: Partial<AgentTools> = {}): AgentTools => ({
  recalls: async () => [{ component: 'Air Bags', summary: 's', remedy: 'r', campaign: '22V519000', date: '2022' }],
  market: async () => ({ via: 'regex', query: 'q', median: 31000, low: 28000, high: 34000, count: 6, sources: [], fetchedAt: '' }),
  dealers: async zip => [{ name: `Toyota of ${zip}`, address: '1 Main St', phone: '(555) 010-0000', rating: 4.5, reviews: 100, website: null, mapsUrl: 'https://maps' }],
  officialHelp: async () => [{ title: 'TFS', link: 'https://www.toyotafinancial.com' }],
  ...over,
})
async function setup(customerId: string) {
  const db = openStore(':memory:')
  db.saveWorkflow(await runWorkflow({ customerId }), 'test')
  return db
}

test('agent: plans by recommendation type', () => {
  const c = getCustomer('cust-priya')!
  assert.deepEqual(planFor(c, { scenarioKey: 'trade_in' }).map(d => d.kind), ['market_value', 'find_dealers', 'payoff_estimate', 'check_recalls'])
  assert.equal(planFor(c, { scenarioKey: 'support' })[0].kind, 'specialist_summary')
})

test('agent: acts with tools, adapts to findings, waits for approval, then acts on it', async () => {
  const db = await setup('cust-priya') // trade-in recommendation; synthetic value $31,500
  const r = await runPlan('cust-priya', { db, tools: fake({ market: async () => ({ via: 'regex', query: 'q', median: 27000, low: 25000, high: 30000, count: 5, sources: [], fetchedAt: '' }) }) })
  const kinds = r.tasks.map(t => `${t.kind}:${t.status}`)
  assert.ok(kinds.includes('market_value:done') && kinds.includes('find_dealers:done') && kinds.includes('check_recalls:done'))
  assert.ok(kinds.includes('update_value:needs_you'), 'value 14% below estimate → propose update')
  assert.ok(kinds.includes('book_appointment:needs_you'), 'dealers found → propose appointment')
  assert.ok(r.tasks.filter(t => t.addedBy === 'adapted').length >= 2)
  assert.match(r.briefing, /need your OK/)

  const appt = r.tasks.find(t => t.kind === 'book_appointment')!
  const a = await approveTask('cust-priya', appt.id, { dealerIndex: 0 }, db)
  assert.equal(a.tasks.find(t => t.id === appt.id)!.status, 'done')
  assert.ok(db.listActions('cust-priya').some(x => x.title.startsWith('Appointment request')))

  const upd = r.tasks.find(t => t.kind === 'update_value')!
  const u = await approveTask('cust-priya', upd.id, {}, db)
  assert.ok(u.rerun)
  assert.equal(getCustomer('cust-priya')!.vehicle.estimatedMarketValue, 27000)
  assert.equal(getCustomer('cust-priya')!.vehicle.valuationSource, 'Your estimate')
  await assert.rejects(approveTask('cust-priya', upd.id, {}, db), /not waiting/)
  db.resetCustomer('cust-priya')
  assert.equal(getCustomer('cust-priya')!.vehicle.estimatedMarketValue, 31500)
})

test('agent: tool failures are recorded, not hidden; re-run retries; skip works', async () => {
  const db = await setup('cust-maya')
  const r = await runPlan('cust-maya', { db, tools: fake({ recalls: async () => { throw new Error('NHTSA down') } }) })
  const rc = r.tasks.find(t => t.kind === 'check_recalls')!
  assert.equal(rc.status, 'failed'); assert.match(rc.summary!, /NHTSA down/)
  const again = await runPlan('cust-maya', { db, tools: fake() })
  assert.equal(again.tasks.find(t => t.kind === 'check_recalls')!.status, 'done')
  const pending = again.tasks.find(t => t.status === 'needs_you')
  if (pending) assert.equal(dismissTask('cust-maya', pending.id, db).tasks.find(t => t.id === pending.id)!.status, 'skipped')
  db.resetCustomer('cust-maya')
})

test('agent: concurrent runs never duplicate the plan', async () => {
  const db = await setup('cust-maya')
  const [a, b] = await Promise.all([runPlan('cust-maya', { db, tools: fake() }), runPlan('cust-maya', { db, tools: fake() })])
  const kinds = b.tasks.map(t => t.kind)
  assert.equal(new Set(kinds).size, kinds.length)
  assert.equal(a.tasks.length, b.tasks.length)
  await runPlan('cust-maya', { db, tools: fake(), force: true })
  const again = await runPlan('cust-maya', { db, tools: fake(), force: true })
  assert.equal(db.listTasks('cust-maya', db.listRecommendations('cust-maya', 1)[0].id).length, again.tasks.length)
  db.resetCustomer('cust-maya')
})
