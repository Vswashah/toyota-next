import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getCustomer } from './data.ts'
import { openStore } from './db.ts'
import { runWorkflow } from './engine.ts'
import { nextDueDate, payoffSchedule, previewPayment, type PaymentRecord } from './payments.ts'
import { payment } from './finance.ts'

const maya = () => getCustomer('cust-maya')!
const post = (db: ReturnType<typeof openStore>, kind: PaymentRecord['kind'], amount?: number) => {
  const p = previewPayment(maya(), kind, amount)
  return db.addPayment({ ...p, id: `pay-${kind}-${Math.random()}`, customerId: 'cust-maya', accountId: 'fin-maya', method: 'Demo checking ••4821', confirmation: 'TN-TEST', status: 'posted', createdAt: new Date().toISOString() }, 6.9)
}

test('payments: monthly payment splits interest and principal', () => {
  const p = previewPayment(maya(), 'monthly')
  assert.equal(p.interest, 142.6) // 24,800 × 6.9% / 12
  assert.equal(p.principal, 450.12)
  assert.equal(p.balanceAfter, 24349.88)
  assert.equal(p.remainingAfter, 47)
})

test('payments: extra principal shortens the loan and saves interest; payoff clears it', () => {
  const x = previewPayment(maya(), 'extra_principal', 2000)
  assert.equal(x.balanceAfter, 22800)
  assert.ok(x.monthsSaved! >= 3 && x.interestSaved! > 0)
  const off = previewPayment(maya(), 'payoff')
  assert.equal(off.amount, 24942.6); assert.equal(off.balanceAfter, 0); assert.ok(off.interestSaved! > 3000)
  assert.equal(payoffSchedule(24800, 6.9, payment(24800, 6.9, 48)).months, 48)
})

test('payments: invalid requests are refused', () => {
  assert.throws(() => previewPayment(maya(), 'extra_principal', 0))
  assert.throws(() => previewPayment(maya(), 'extra_principal', 30000), /payoff/)
  assert.throws(() => previewPayment(getCustomer('cust-daniel')!, 'payoff'), /monthly payment only/)
  assert.throws(() => payoffSchedule(10000, 12, 50), /does not cover interest/)
  assert.equal(nextDueDate(2), '2027-01-15')
})

test('payments: posting updates the account everywhere; payoff still yields a valid workflow; reset restores', async () => {
  const db = openStore(':memory:')
  post(db, 'extra_principal', 2000)
  assert.equal(maya().financing.currentBalance, 22800)
  post(db, 'payoff')
  assert.equal(maya().financing.currentBalance, 0)
  assert.equal(db.listPayments('cust-maya').length, 2)
  const r = await runWorkflow({ customerId: 'cust-maya' })
  assert.notEqual(r.status, 'failed')
  assert.ok(!r.scenarios.some(s => s.type === 'refinance'))
  assert.throws(() => previewPayment(maya(), 'monthly'), /paid in full/)
  db.resetCustomer('cust-maya')
  assert.equal(maya().financing.currentBalance, 24800)
})

test('stripe: paid sessions post once (idempotent), unpaid are refused, live keys blocked', async () => {
  const { postStripePayment, stripeMode } = await import('./stripe.ts')
  const db = openStore(':memory:')
  const session = (over: Record<string, unknown> = {}) => ({
    id: 'cs_test_abc12345XYZ', livemode: false, payment_status: 'paid', amount_total: 59272, client_reference_id: 'cust-maya',
    metadata: { customerId: 'cust-maya', kind: 'monthly', amount: '592.72' },
    payment_intent: { latest_charge: { payment_method_details: { card: { brand: 'visa', last4: '4242' } } } }, ...over,
  }) as never
  assert.throws(() => postStripePayment(db, session({ payment_status: 'unpaid' })), /not marked this payment as paid/)
  const a = postStripePayment(db, session()), b = postStripePayment(db, session())
  assert.equal(a.id, b.id); assert.equal(db.listPayments('cust-maya').length, 1)
  assert.equal(a.method, 'Visa ••4242 (Stripe test)'); assert.equal(a.processor, 'stripe')
  assert.equal(maya().financing.currentBalance, a.balanceAfter)
  // account changed after checkout → amount still applied, to principal
  const c = postStripePayment(db, session({ id: 'cs_test_second999', amount_total: 59272 }))
  assert.equal(c.kind, 'monthly') // still a valid monthly payment on the new balance
  const d = postStripePayment(db, session({ id: 'cs_test_third7777', amount_total: 12345, metadata: { customerId: 'cust-maya', kind: 'monthly' } }))
  assert.equal(d.kind, 'extra_principal'); assert.equal(d.amount, 123.45); assert.match(d.notes[0], /applied to principal/)
  db.resetCustomer('cust-maya')
  const old = process.env.STRIPE_SECRET_KEY
  process.env.STRIPE_SECRET_KEY = 'sk_live_x'; assert.equal(stripeMode(), 'live-blocked')
  process.env.STRIPE_SECRET_KEY = 'sk_test_x'; assert.equal(stripeMode(), 'test')
  if (old == null) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = old
})
