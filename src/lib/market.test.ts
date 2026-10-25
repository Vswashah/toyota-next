import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPrices, summarize } from './market.ts'

test('market: extracts plausible listing prices and ignores noise', () => {
  const prices = extractPrices({
    shopping_results: [{ title: 'RAV4 XLE', product_link: 'https://a', extracted_price: 27100 }],
    organic_results: [
      { title: '2022 RAV4 XLE - $25,990', link: 'https://b', snippet: 'Only $500 down. Was $26,800, now great deal.' },
      { title: 'Lease', link: 'https://c', snippet: '$399/mo or $2,999 due at signing' },
    ],
  }, 26400)
  assert.deepEqual(prices.map(p => p.price), [27100, 25990, 26800])
  const s = summarize('q', prices)
  assert.equal(s.median, 26800); assert.equal(s.low, 25990); assert.equal(s.high, 27100)
  assert.deepEqual(s.sources.map(x => x.link), ['https://a', 'https://b'])
  assert.equal(summarize('q', prices.slice(0, 2)).median, null)
})

test('recall watch: keyword filter, signal appended, failure never fails the run', async () => {
  const { recallCandidates } = await import('./recalls.ts')
  const { getCustomer } = await import('./data.ts')
  const { runWorkflow } = await import('./engine.ts')
  const v = getCustomer('cust-maya')!.vehicle
  assert.deepEqual(recallCandidates([{ title: 'Toyota recalls 2019-2022 RAV4 over battery', link: 'a' }, { title: 'RAV4 review', link: 'b' }, { title: 'Camry recall', link: 'c' }], v).map(n => n.link), ['a'])
  const sig = { id: 'recall-news', title: 't', description: 'd', data: {}, whyItMatters: 'w', nextAction: 'n', urgency: 'watch' as const, evidence: 'e' }
  const ok = await runWorkflow({ customerId: 'cust-maya', recallWatch: async () => sig })
  assert.ok(ok.signals.some(s => s.id === 'recall-news'))
  const bad = await runWorkflow({ customerId: 'cust-maya', recallWatch: async () => { throw new Error('boom') } })
  assert.equal(bad.status, ok.status)
  assert.ok(bad.steps.some(s => s.toolName === 'serp.recalls' && /Skipped: boom/.test(s.outputSummary)))
})

test('market: reads asking prices that only appear in rich snippets', () => {
  const prices = extractPrices({ organic_results: [{ title: 'Used 2022 RAV4', link: 'https://d', snippet: 'Great deals', rich_snippet: { top: { extensions: ['$25,082', '32,000 mi'] } } }] } as never, 26400)
  assert.deepEqual(prices.map(p => p.price), [25082])
})
