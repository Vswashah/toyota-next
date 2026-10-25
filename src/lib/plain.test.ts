import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plainSummary, yearsText } from './plain.ts'

test('plain: refinance reads as everyday words, with the catch stated', () => {
  const s = plainSummary({ type: 'refinance', termMonths: 60, model: 'RAV4', currentPayment: 592.72, newPayment: 489.9, lifetimeDelta: 943.47, target: 500 })
  assert.equal(s.title, 'Spread your loan over 5 years')
  assert.equal(s.aka, '60 monthly payments · This is called refinancing')
  assert.equal(s.monthly, 'You would pay $103 less every month')
  assert.equal(s.total, 'But in total, you would pay $943 more by the end')
  assert.equal(s.totalTone, 'warn')
  assert.ok(s.fits); assert.equal(s.fit, 'Fits your $500 monthly budget')
  assert.match(s.speech, /^Michi suggests: Spread your loan over 5 years\./)
})

test('plain: specialist and odd terms', () => {
  const s = plainSummary({ type: 'support', model: 'Corolla', currentPayment: 452, newPayment: null, lifetimeDelta: null, target: 340 })
  assert.equal(s.title, 'Talk with a Toyota specialist'); assert.equal(s.monthly, null); assert.equal(s.fits, false)
  assert.equal(yearsText(59), 'about 5 years')
  assert.equal(yearsText(12), '1 year')
})

test('ask: "how" gets concrete steps from the account and action plan', async () => {
  const { howToSteps, simplestPath } = await import('./ask.ts')
  const x = { customerName: 'Maya', accountId: 'fin-maya', contactPreference: null, zip: '75080', scenarioType: 'refinance', termMonths: 60, newPayment: 489.9, target: 500, lifetimeCost: 29394, leaseEnd: null, payoff: 24942.6, officialLinks: [{ title: 'Contact Us', link: 'https://www.toyotafinancial.com/contact' }], dealer: { name: 'Toyota of Richardson', phone: '(972) 201-9228', address: 'x' }, recalls: 1 }
  const s = howToSteps(x)
  assert.match(s[0], /Call Toyota Financial Services \(account fin-maya\).*60 months/)
  assert.equal(s[1], 'Payoff is about $24,943.')
  assert.equal(s.at(-1), 'Free recall repair at Toyota of Richardson, (972) 201-9228.')
  const again = simplestPath(x)
  assert.equal(again.actions![0].id, 'specialist'); assert.match(again.links![0].title, /^Toyota Financial Services/)
})
