// Deterministic loan math. Every dollar figure NEXT shows comes from here, never from an LLM.

export const round2 = (n: number) => Math.round(n * 100) / 100

function check(name: string, v: number, min = 0) {
  if (!Number.isFinite(v) || v < min) throw new RangeError(`${name} must be a finite number >= ${min} (got ${v})`)
}

/** Fixed-rate monthly payment. aprPct is an annual percentage, e.g. 6.9. */
export function payment(principal: number, aprPct: number, months: number): number {
  check('principal', principal); check('aprPct', aprPct); check('months', months, 1)
  if (principal === 0) return 0
  const r = aprPct / 100 / 12
  if (r === 0) return principal / months
  return (principal * r) / (1 - Math.pow(1 + r, -months))
}

/** Balance remaining after k scheduled payments of `pmt` (defaults to the amortizing payment). */
export function balanceAfter(principal: number, aprPct: number, months: number, k: number, pmt = payment(principal, aprPct, months)): number {
  check('k', k)
  const r = aprPct / 100 / 12
  const n = Math.min(k, months)
  const b = r === 0 ? principal - pmt * n : principal * Math.pow(1 + r, n) - (pmt * (Math.pow(1 + r, n) - 1)) / r
  return k >= months ? 0 : Math.max(0, b)
}

/** APR implied by a balance, payment and remaining term (bisection). null when the inputs are inconsistent. */
export function impliedApr(principal: number, pmt: number, months: number): number | null {
  check('principal', principal); check('pmt', pmt); check('months', months, 1)
  if (pmt * months < principal - 0.5) return null // payments can't even repay principal
  if (Math.abs(pmt * months - principal) <= 0.5) return 0
  let lo = 0, hi = 60
  if (payment(principal, hi, months) < pmt) return null
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2
    if (payment(principal, mid, months) > pmt) hi = mid; else lo = mid
  }
  return Math.round(((lo + hi) / 2) * 100) / 100
}

/** Illustrative straight-percentage annual depreciation. A scenario assumption, not a forecast. */
export function depreciatedValue(value: number, annualRatePct: number, months: number): number {
  check('value', value); check('annualRatePct', annualRatePct); check('months', months)
  return value * Math.pow(1 - Math.min(annualRatePct, 100) / 100, months / 12)
}

export const usd = (n: number | null | undefined, cents = false) =>
  n == null ? '—' : (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 })
