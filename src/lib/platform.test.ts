import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAgent, TEMPLATES, type Generate } from './platform.ts'

// Scripted model: each call returns the next set of parts.
const scripted = (...turns: object[][]): Generate => { let i = 0; return async () => ({ candidates: [{ content: { role: 'model', parts: turns[i++] } }], usageMetadata: { totalTokenCount: 10 } }) }
const spec = TEMPLATES.find(t => t.id === 'refinance-advisor')!

test('platform runtime: permissions, arg validation, grounding pass and block', async () => {
  const ok = await runAgent(spec, 'What do I pay?', { customerId: 'cust-maya' }, scripted(
    [{ functionCall: { name: 'customer_profile', args: { customerId: 'cust-maya' } } }, { functionCall: { name: 'web_search', args: { query: 'x' } } }, { functionCall: { name: 'decision_engine', args: { customerId: 'nope' } } }],
    [{ text: 'You pay $593 a month.' }],
  ))
  assert.equal(ok.status, 'ok')
  assert.deepEqual(ok.steps.filter(s => s.kind === 'tool').map(s => `${s.name}:${s.status}`), ['customer_profile:ok', 'web_search:blocked', 'decision_engine:error'])
  assert.equal(ok.tokens, 20)
  assert.ok(ok.steps.some(s => s.kind === 'guardrail' && s.status === 'ok'))

  const bad = await runAgent(spec, 'What do I pay?', { customerId: 'cust-maya' }, scripted([{ text: 'You could pay $412 a month.' }]))
  assert.equal(bad.status, 'blocked')
  assert.match(bad.answer, /\$412/)

  const loop = await runAgent({ ...spec, guardrails: { ...spec.guardrails, maxSteps: 2 } }, 'x', {}, scripted(
    [{ functionCall: { name: 'customer_profile', args: { customerId: 'cust-maya' } } }], [{ functionCall: { name: 'customer_profile', args: { customerId: 'cust-maya' } } }],
  ))
  assert.equal(loop.status, 'error')
})
