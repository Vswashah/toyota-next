// Real card payments through Stripe Checkout (hosted page: card data never touches this app).
// Test mode only by default: these are synthetic accounts, so live keys are refused unless STRIPE_ALLOW_LIVE=1.
import Stripe from 'stripe'
import { getCustomer, type CustomerProfile } from './data.ts'
import type { Store } from './db.ts'
import { currentApr } from './scenarios.ts'
import { previewPayment, type PaymentKind, type PaymentPreview, type PaymentRecord } from './payments.ts'

export type StripeMode = 'off' | 'test' | 'live' | 'live-blocked'
export function stripeMode(): StripeMode {
  const k = process.env.STRIPE_SECRET_KEY ?? ''
  if (!k) return 'off'
  if (/^(sk|rk)_test_/.test(k)) return 'test'
  if (/^(sk|rk)_live_/.test(k)) return process.env.STRIPE_ALLOW_LIVE === '1' ? 'live' : 'live-blocked'
  return 'off'
}

let client: Stripe | null = null
const stripe = () => (client ??= new Stripe(process.env.STRIPE_SECRET_KEY!)) // created lazily so builds don't need the key

const KIND_NAME: Record<PaymentKind, string> = { monthly: 'Monthly payment', extra_principal: 'Extra payment toward principal', payoff: 'Loan payoff' }

export async function createCheckout(c: CustomerProfile, preview: PaymentPreview, origin: string) {
  const mode = stripeMode()
  if (mode !== 'test' && mode !== 'live') throw new Error(mode === 'live-blocked' ? 'Live Stripe keys are blocked for this demo. Use a test key (sk_test_…).' : 'Stripe is not configured')
  const back = `${origin}/?customer=${encodeURIComponent(c.id)}&view=payments`
  return stripe().checkout.sessions.create({
    mode: 'payment',
    // Cards (incl. wallets) only: no buy-now-pay-later for a loan payment, no slow bank debits that settle days later.
    excluded_payment_method_types: ['affirm', 'afterpay_clearpay', 'klarna', 'zip', 'sunbit', 'scalapay', 'alma', 'cashapp', 'us_bank_account', 'pay_by_bank'],
    client_reference_id: c.id,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: Math.round(preview.amount * 100), product_data: { name: `${KIND_NAME[preview.kind]} · Toyota NEXT`, description: `Account ${c.financing.id} · ${c.vehicle.year} ${c.vehicle.model}` } } }],
    metadata: { customerId: c.id, kind: preview.kind, amount: preview.amount.toFixed(2), balanceBefore: String(preview.balanceBefore ?? '') },
    success_url: `${back}&paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back}&canceled=1`,
  })
}

/** Posts a payment that Stripe says is paid. Idempotent per Checkout Session (redirect and webhook can both call it). */
export function postStripePayment(db: Store, session: Stripe.Checkout.Session): PaymentRecord {
  const customerId = session.metadata?.customerId ?? session.client_reference_id ?? ''
  const c = getCustomer(customerId)
  if (!c) throw new Error('Unknown customer on this payment')
  if (session.payment_status !== 'paid') throw new Error('Stripe has not marked this payment as paid')
  const existing = db.listPayments(customerId).find(p => p.processorRef === session.id)
  if (existing) return existing
  const paid = (session.amount_total ?? 0) / 100, kind = (session.metadata?.kind ?? 'monthly') as PaymentKind
  // Apply exactly what was paid. If the account moved since checkout, the money goes to principal instead.
  let fresh: PaymentPreview
  try {
    fresh = previewPayment(c, kind, kind === 'extra_principal' ? paid : undefined)
    if (Math.abs(fresh.amount - paid) > 0.009) throw new Error('amount changed')
  } catch {
    fresh = { ...previewPayment(c, 'extra_principal', Math.min(paid, Math.max(1, (c.financing.currentBalance ?? paid) - 0.01))), amount: paid }
    fresh.notes = ['Account changed after checkout, so this payment was applied to principal.', ...fresh.notes]
  }
  const charge = typeof session.payment_intent === 'object' && session.payment_intent?.latest_charge && typeof session.payment_intent.latest_charge === 'object' ? session.payment_intent.latest_charge : null
  const card = charge?.payment_method_details?.card
  const rec: PaymentRecord = {
    ...fresh, id: `pay-${crypto.randomUUID().slice(0, 8)}`, customerId, accountId: c.financing.id,
    method: card ? `${card.brand?.replace(/^\w/, x => x.toUpperCase())} ••${card.last4} (Stripe ${session.livemode ? 'live' : 'test'})` : `Card via Stripe ${session.livemode ? '' : '(test mode)'}`.trim(),
    confirmation: `TN-${session.id.slice(-8).toUpperCase()}`, status: 'posted', createdAt: new Date().toISOString(), processor: 'stripe', processorRef: session.id,
  }
  db.addPayment(rec, currentApr(c)?.apr ?? null)
  db.logToLatest(customerId, { stage: 'action', label: 'Card payment received (Stripe)', toolName: 'stripe.checkout', status: 'completed', inputSummary: `${rec.kind} · $${rec.amount} · ${session.id.slice(0, 18)}…`, outputSummary: `Posted ${rec.confirmation}. Balance ${rec.balanceAfter == null ? 'n/a' : '$' + rec.balanceAfter}.` })
  return rec
}

export async function confirmCheckout(db: Store, sessionId: string) {
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new Error('Invalid Checkout Session id')
  const session = await stripe().checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] })
  return postStripePayment(db, session)
}

export function verifyWebhook(rawBody: string, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set')
  return stripe().webhooks.constructEvent(rawBody, signature, secret)
}

export const retrieveSession = (id: string) => stripe().checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge'] })
