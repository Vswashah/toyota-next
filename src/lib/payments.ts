// Account servicing: payment quotes and the account state they produce. Pure and deterministic.
// Money movement is simulated against synthetic accounts; agents may quote, only the customer confirms.
import { round2 } from './finance.ts'
import { currentApr } from './scenarios.ts'
import type { CustomerProfile, FinancingAccount } from './data.ts'

export const PAYMENT_KINDS = ['monthly', 'extra_principal', 'payoff'] as const
export type PaymentKind = typeof PAYMENT_KINDS[number]
export const FUNDING_SOURCES = [
  { id: 'demo-checking', label: 'Demo checking ••4821' },
  { id: 'demo-savings', label: 'Demo savings ••1937' },
] as const
export const FIRST_DUE = '2026-11-15'

export interface PaymentPreview {
  kind: PaymentKind; amount: number; principal: number | null; interest: number | null
  balanceBefore: number | null; balanceAfter: number | null; remainingBefore: number | null; remainingAfter: number | null
  monthsSaved: number | null; interestSaved: number | null; notes: string[]
}
export interface PaymentRecord extends PaymentPreview { id: string; customerId: string; accountId: string; method: string; confirmation: string; status: 'posted'; createdAt: string; processor?: 'demo' | 'stripe'; processorRef?: string }

/** Months and total paid to clear `balance` with a fixed payment. Throws if the payment never covers interest. */
export function payoffSchedule(balance: number, aprPct: number, pmt: number) {
  const r = aprPct / 1200
  let b = balance, months = 0, total = 0
  while (b > 0.005) {
    if (++months > 600 || pmt <= b * r) throw new Error('Payment does not cover interest')
    const pay = Math.min(pmt, b * (1 + r))
    total += pay; b = b * (1 + r) - pay
  }
  return { months, total: round2(total) }
}

export function nextDueDate(monthlyPaymentsMade: number) {
  const d = new Date(FIRST_DUE + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + monthlyPaymentsMade)
  return d.toISOString().slice(0, 10)
}

export function previewPayment(c: CustomerProfile, kind: PaymentKind, amount?: number): PaymentPreview {
  const f = c.financing
  if (f.financingType === 'lease') {
    if (kind !== 'monthly') throw new Error('Lease accounts support the monthly payment only. Buyouts go through a TFS purchase quote.')
    return { kind, amount: f.monthlyPayment, principal: null, interest: null, balanceBefore: null, balanceAfter: null, remainingBefore: null, remainingAfter: null, monthsSaved: null, interestSaved: null, notes: ['Lease payments are not split into principal and interest.'] }
  }
  const bal = f.currentBalance ?? 0, rem = f.remainingMonths ?? 0, rate = currentApr(c)
  if (bal <= 0) throw new Error('This loan is paid in full. Nothing is due.')
  if (!rate) throw new Error('APR unavailable; cannot quote a payment')
  const apr = rate.apr, r = apr / 1200, interest = round2(bal * r)
  const notes = ['Interest uses a monthly approximation; your statement may accrue daily.', ...(rate.provenance === 'derived' ? [`APR ${apr}% is derived from balance, payment and term (not on file).`] : [])]
  const before = payoffSchedule(bal, apr, f.monthlyPayment)
  const base = { balanceBefore: bal, remainingBefore: rem }

  if (kind === 'monthly') {
    const amt = round2(Math.min(f.monthlyPayment, bal + interest)), principal = round2(amt - interest)
    return { kind, amount: amt, principal, interest, ...base, balanceAfter: round2(Math.max(0, bal - principal)), remainingAfter: Math.max(0, rem - 1), monthsSaved: 0, interestSaved: 0, notes }
  }
  if (kind === 'payoff') {
    // ponytail: estimated payoff = balance + one month of interest; an official quote adds exact per-diem interest
    const amt = round2(bal + interest)
    return { kind, amount: amt, principal: bal, interest, ...base, balanceAfter: 0, remainingAfter: 0, monthsSaved: before.months, interestSaved: round2(before.total - amt), notes: ['Estimated payoff. An official payoff quote from TFS includes exact per-diem interest.', ...notes] }
  }
  if (amount == null || !Number.isFinite(amount) || amount < 1) throw new Error('Extra principal amount must be at least $1')
  if (amount >= bal) throw new Error('Amount covers the whole balance; choose payoff instead')
  const amt = round2(amount), after = payoffSchedule(bal - amt, apr, f.monthlyPayment)
  return {
    kind, amount: amt, principal: amt, interest: 0, ...base, balanceAfter: round2(bal - amt), remainingAfter: after.months,
    monthsSaved: before.months - after.months, interestSaved: round2(before.total - (after.total + amt)),
    notes: ['Extra goes to principal. Your monthly payment stays the same and the loan ends sooner.', ...notes],
  }
}

/** Account fields after the latest posted payment (payments are posted against the then-current state). */
export function accountAfter(base: FinancingAccount, latest: PaymentRecord | undefined, aprUsed: number | null): Partial<FinancingAccount> {
  if (!latest || base.financingType === 'lease' || latest.balanceAfter == null) return {}
  const paidOff = latest.balanceAfter <= 0
  return {
    currentBalance: latest.balanceAfter, remainingMonths: latest.remainingAfter,
    ...(paidOff ? { monthlyPayment: 0 } : {}),
    // Pin the APR used for servicing so a derived rate doesn't drift as the balance changes.
    ...(base.interestRate == null && aprUsed != null ? { interestRate: aprUsed } : {}),
  }
}
