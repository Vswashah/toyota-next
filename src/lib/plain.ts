// Plain-language version of a validated recommendation, for customers of any age.
// Wording only: every number is passed in from engine output.
import { usd } from './finance.ts'

export interface PlainInput {
  type: string; termMonths?: number | null; model: string; replacement?: string
  currentPayment: number; newPayment: number | null; lifetimeDelta: number | null; target: number
}
export interface PlainSummary { title: string; aka: string | null; monthly: string | null; total: string | null; totalTone: 'good' | 'warn' | null; fit: string; fits: boolean; speech: string }

export const yearsText = (m: number) => m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `about ${Math.round(m / 12)} years`

export function plainSummary(p: PlainInput): PlainSummary {
  const titles: Record<string, [string, string | null]> = {
    keep: [`Keep your ${p.model} loan as it is`, null],
    refinance: [`Spread your loan over ${p.termMonths ? yearsText(p.termMonths) : 'a longer time'}`, `${p.termMonths ? `${p.termMonths} monthly payments · ` : ''}This is called refinancing`],
    trade_in: [`Trade in your ${p.model} for a ${p.replacement ?? 'different car'}`, null],
    lease_return: [`Return your ${p.model} when the lease ends and get a new car`, null],
    lease_buyout: [`Buy the ${p.model} you are leasing`, 'This is called a lease buyout'],
    support: ['Talk with a Toyota specialist', 'They can look at options this app cannot'],
  }
  const [title, aka] = titles[p.type] ?? ['Review your options', null]
  const diff = p.newPayment == null ? null : Math.round(p.newPayment - p.currentPayment)
  const monthly = p.type === 'support' || diff == null ? null
    : diff < 0 ? `You would pay ${usd(-diff)} less every month`
    : diff > 0 ? `You would pay ${usd(diff)} more every month`
    : 'Your monthly payment stays the same'
  const lt = p.lifetimeDelta == null ? null : Math.round(p.lifetimeDelta)
  const total = lt == null || lt === 0 || p.type === 'support' ? null
    : lt > 0 ? `${diff != null && diff < 0 ? 'But in' : 'In'} total, you would pay ${usd(lt)} more by the end`
    : `In total, you would save ${usd(-lt)}`
  const fits = p.newPayment != null && p.newPayment <= p.target + 0.5
  const fit = p.type === 'support' ? `No option we found gets you to ${usd(p.target)} a month` : fits ? `Fits your ${usd(p.target)} monthly budget` : `Still above your ${usd(p.target)} monthly budget`
  const speech = ['Michi suggests:', title + '.', monthly && monthly + '.', total && total + '.', fit + '.'].filter(Boolean).join(' ')
  return { title, aka, monthly, total, totalTone: lt == null || lt === 0 ? null : lt > 0 ? 'warn' : 'good', fit, fits, speech }
}
