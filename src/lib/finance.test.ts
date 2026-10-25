import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceAfter, depreciatedValue, impliedApr, payment } from './finance.ts'
import { CUSTOMERS, getCustomer } from './data.ts'
import { defaultAssumptions, leaseFacts, simulateKeep, simulateLeaseEnd, simulateRefinance, simulateTradeIn, type Assumptions } from './scenarios.ts'

const near = (a: number | null, b: number, tol = 0.01) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≉ ${b}`)
const maya = getCustomer('cust-maya')!, daniel = getCustomer('cust-daniel')!, marcus = getCustomer('cust-marcus')!

test('fixed-rate payment matches reference values', () => {
  near(payment(10000, 6, 60), 193.33)
  near(payment(24800, 6.9, 48), 592.72)
  near(payment(12000, 0, 48), 250)
  assert.equal(payment(0, 7, 36), 0)
})

test('remaining balance: endpoints and present-value identity', () => {
  const P = 24800, r = 6.9, n = 48
  near(balanceAfter(P, r, n, 0), P)
  assert.equal(balanceAfter(P, r, n, n), 0)
  assert.equal(balanceAfter(P, r, n, n + 10), 0)
  const b = balanceAfter(P, r, n, 20)
  near(payment(b, r, n - 20), payment(P, r, n)) // remaining balance re-amortizes to the same payment
  near(balanceAfter(12000, 0, 48, 12), 9000)
})

test('implied APR round-trips and rejects inconsistent inputs', () => {
  near(impliedApr(21900, payment(21900, 8.75, 60), 60), 8.75)
  assert.equal(impliedApr(12000, 250, 48), 0)
  assert.equal(impliedApr(20000, 100, 60), null)
})

test('invalid inputs throw instead of returning garbage', () => {
  assert.throws(() => payment(-1, 5, 60), RangeError)
  assert.throws(() => payment(1000, Number.NaN, 60), RangeError)
  assert.throws(() => payment(1000, 5, 0), RangeError)
  assert.throws(() => depreciatedValue(1000, -1, 12), RangeError)
})

test('depreciation is a simple illustrative curve', () => {
  near(depreciatedValue(20000, 12, 12), 17600)
  near(depreciatedValue(20000, 12, 0), 20000)
})

test('keep scenario: payments, balance and net cost are internally consistent', () => {
  const a = defaultAssumptions(maya), s = simulateKeep(maya, a)
  near(s.paymentsOverHorizon, 592.72 * 36)
  near(s.balanceAtHorizon, balanceAfter(24800, 6.9, 48, 36, 592.72))
  near(s.netCostOverHorizon, s.paymentsOverHorizon! + s.balanceAtHorizon! - s.vehicleValueAtHorizon!)
  assert.equal(s.timeline.length, 37)
})

test('missing APR is derived and labeled, never invented', () => {
  const s = simulateKeep(marcus, defaultAssumptions(marcus))
  assert.equal(s.aprKind, 'derived')
  assert.ok(s.missing.some(m => /Interest rate/.test(m)))
})

test('estimated equity and trade-in amount financed', () => {
  const a = defaultAssumptions(maya), s = simulateTradeIn(maya, a)
  assert.ok(s.assumptions.some(x => x.label === 'Estimated equity' && x.value === '$1,600'))
  near(s.amountFinanced, 27500 - 1600)
  near(s.monthlyPayment, payment(25900, 6.9, 60))
  const withCosts = simulateTradeIn(maya, { ...a, tradeCosts: 500, downPayment: 2000 })
  near(withCosts.amountFinanced, 27500 - 2000 - 1100)
  assert.ok(!withCosts.missing.some(m => /transaction costs/.test(m)))
})

test('negative equity is rolled in and disclosed', () => {
  const s = simulateTradeIn(marcus, defaultAssumptions(marcus))
  assert.ok(s.amountFinanced! > 21500)
  assert.ok(s.limitations.some(l => /Negative equity of \$2,100/.test(l)))
})

test('refinance fees: missing by default, rolled in when supplied', () => {
  const a = defaultAssumptions(maya)
  assert.ok(simulateRefinance(maya, a).missing.includes('Refinance fees (modeled as $0)'))
  const s = simulateRefinance(maya, { ...a, refiFees: 400 })
  near(s.amountFinanced, 25200); assert.equal(s.missing.length, 0)
  assert.ok(s.limitations[0].includes('Not an offer'))
})

test('lease-end: mileage projection from contract inputs; unknown fees stay missing', () => {
  const L = leaseFacts(daniel)
  assert.equal(L.monthsLeft, 4)
  assert.equal(L.projectedMiles, 38800)
  assert.equal(L.excessMiles, 2800)
  near(L.mileageCharge, 420)
  const ret = simulateLeaseEnd(daniel, defaultAssumptions(daniel), 'return')
  assert.ok(ret.missing.some(m => /Disposition fee/.test(m)))
  near(ret.upfrontCash, 420)
  const buy = simulateLeaseEnd(daniel, defaultAssumptions(daniel), 'buyout')
  near(buy.amountFinanced, 21450)
  assert.ok(buy.keepsVehicle)
})

test('scenarios are reproducible: same inputs → same id and numbers; changed input → new id', () => {
  const a: Assumptions = defaultAssumptions(maya)
  assert.deepEqual(simulateRefinance(maya, a), simulateRefinance(maya, a))
  assert.notEqual(simulateRefinance(maya, a).id, simulateRefinance(maya, { ...a, vehicleValue: 25000 }).id)
})

test('every demo profile simulates without errors', () => {
  for (const c of CUSTOMERS) {
    const a = defaultAssumptions(c)
    const s = c.profileType === 'loan' ? simulateKeep(c, a) : simulateLeaseEnd(c, a, 'return')
    assert.ok(Number.isFinite(s.netCostOverHorizon))
  }
})
