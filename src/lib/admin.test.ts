import { test } from 'node:test'
import assert from 'node:assert/strict'
import { financeIncome, opportunityOf } from './admin.ts'

test('admin: recommendations map to TFS opportunity types', () => {
  assert.equal(opportunityOf('trade_in'), 'new_vehicle_financing')
  assert.equal(opportunityOf('lease_return'), 'new_vehicle_financing')
  assert.equal(opportunityOf('lease_buyout'), 'lease_buyout_financing')
  assert.equal(opportunityOf('refinance:72'), 'account_restructure')
  assert.equal(opportunityOf('keep'), 'retained')
  assert.equal(opportunityOf('support'), 'retention_risk')
  assert.equal(opportunityOf(undefined), 'none')
})

test('admin: hypothetical income = financed × margin × half the term in years', () => {
  assert.equal(financeIncome({ amountFinanced: 24800, inputSnapshot: { termMonths: 60 } }, 2), 1240)
  assert.equal(financeIncome({ amountFinanced: 24800, inputSnapshot: { termMonths: 60 } }, 0), 0)
  assert.equal(financeIncome({ amountFinanced: null, inputSnapshot: {} }, 2), 0)
  assert.equal(financeIncome(undefined, 2), 0)
})
