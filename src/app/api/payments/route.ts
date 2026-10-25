import { z } from 'zod'
import { getCustomer } from '@/lib/data.ts'
import { store } from '@/lib/db.ts'
import { currentApr } from '@/lib/scenarios.ts'
import { invokeTool, ToolError } from '@/lib/tools.ts'
import { confirmCheckout, createCheckout, stripeMode } from '@/lib/stripe.ts'
import { FUNDING_SOURCES, nextDueDate, PAYMENT_KINDS, previewPayment, type PaymentPreview, type PaymentRecord } from '@/lib/payments.ts'

export const dynamic = 'force-dynamic'

// Quotes awaiting the customer's explicit confirmation (single use, 10 minutes).
interface Pending { customerId: string; method: string; preview: PaymentPreview; expires: number }
const g = globalThis as unknown as { __nextQuotes?: Map<string, Pending> }
const quotes = (g.__nextQuotes ??= new Map())
const METHOD_IDS = FUNDING_SOURCES.map(f => f.id) as [string, ...string[]]
const err = (error: string, status = 400) => Response.json({ error }, { status })

function account(customerId: string) {
  const db = store(), c = getCustomer(customerId)!
  const payments = db.listPayments(customerId)
  return {
    financing: c.financing, apr: currentApr(c), payments, autopay: db.getAutopay(customerId), fundingSources: FUNDING_SOURCES,
    nextDue: c.financing.currentBalance === 0 ? null : nextDueDate(payments.filter(p => p.kind === 'monthly').length),
    paidInFull: c.financing.financingType === 'loan' && c.financing.currentBalance === 0,
    stripe: stripeMode(),
  }
}

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('customerId') ?? ''
  store() // loads account overlays
  if (!getCustomer(id)) return err('Unknown customer', 404)
  return Response.json(account(id))
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('quote'), customerId: z.string().max(64), kind: z.enum(PAYMENT_KINDS), amount: z.number().positive().max(500000).optional(), method: z.enum(METHOD_IDS) }),
  z.object({ action: z.literal('confirm'), customerId: z.string().max(64), quoteId: z.string().max(64) }),
  z.object({ action: z.literal('checkout'), customerId: z.string().max(64), quoteId: z.string().max(64) }),
  z.object({ action: z.literal('stripe-confirm'), customerId: z.string().max(64), sessionId: z.string().max(200) }),
  z.object({ action: z.literal('autopay'), customerId: z.string().max(64), enabled: z.boolean(), method: z.enum(METHOD_IDS) }),
])

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null))
  if (!p.success) return err(z.prettifyError(p.error))
  const b = p.data, db = store()
  const c = getCustomer(b.customerId)
  if (!c) return err('Unknown customer', 404)
  const methodLabel = (id: string) => FUNDING_SOURCES.find(f => f.id === id)!.label

  if (b.action === 'quote') {
    try {
      const preview = invokeTool('quote_payment', { customerId: c.id, kind: b.kind, amount: b.amount }, { stage: 'action' }) as unknown as PaymentPreview
      const quoteId = `qt-${crypto.randomUUID().slice(0, 12)}`
      quotes.set(quoteId, { customerId: c.id, method: b.method, preview, expires: Date.now() + 10 * 60_000 })
      return Response.json({ quoteId, preview, method: methodLabel(b.method), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() })
    } catch (e) { return err(e instanceof ToolError ? e.message : String(e)) }
  }

  if (b.action === 'checkout') {
    const q = quotes.get(b.quoteId)
    if (!q || q.customerId !== c.id || q.expires < Date.now()) return err('Quote expired. Please review the payment again.', 410)
    try {
      const session = await createCheckout(c, q.preview, new URL(req.url).origin)
      quotes.delete(b.quoteId)
      db.logToLatest(c.id, { stage: 'action', label: 'Card checkout started (Stripe)', toolName: 'stripe.checkout', status: 'completed', inputSummary: `${q.preview.kind} · $${q.preview.amount}`, outputSummary: 'Customer sent to Stripe’s secure payment page.' })
      return Response.json({ url: session.url })
    } catch (e) { return err((e as Error).message, 502) }
  }

  if (b.action === 'stripe-confirm') {
    try {
      const receipt = await confirmCheckout(db, b.sessionId)
      if (receipt.customerId !== c.id) return err('This payment belongs to a different customer', 403)
      return Response.json({ receipt, account: account(c.id) })
    } catch (e) { return err((e as Error).message, 409) }
  }

  if (b.action === 'confirm') {
    const q = quotes.get(b.quoteId)
    if (!q || q.customerId !== c.id) return err('Quote not found or already used. Please review the payment again.', 404)
    quotes.delete(b.quoteId) // single use, even if the checks below fail
    if (q.expires < Date.now()) return err('Quote expired. Please review the payment again.', 410)
    let fresh: PaymentPreview
    try { fresh = previewPayment(c, q.preview.kind, q.preview.kind === 'extra_principal' ? q.preview.amount : undefined) } catch (e) { return err((e as Error).message, 409) }
    if (fresh.amount !== q.preview.amount || fresh.balanceBefore !== q.preview.balanceBefore) return err('Your account changed since this quote. Please review the payment again.', 409)
    const rec: PaymentRecord = {
      ...fresh, id: `pay-${crypto.randomUUID().slice(0, 8)}`, customerId: c.id, accountId: c.financing.id, method: methodLabel(q.method),
      confirmation: `TN-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`, status: 'posted', createdAt: new Date().toISOString(),
    }
    db.addPayment(rec, currentApr(c)?.apr ?? null)
    db.logToLatest(c.id, { stage: 'action', label: 'Customer payment confirmed', toolName: 'payments.confirm', status: 'completed', inputSummary: `${rec.kind} · $${rec.amount} from ${rec.method} (customer confirmed)`, outputSummary: `Posted ${rec.confirmation}. Balance ${rec.balanceAfter == null ? 'n/a' : '$' + rec.balanceAfter}. Simulated; no money moved.` })
    return Response.json({ receipt: rec, account: account(c.id) })
  }

  const autopay = db.setAutopay(c.id, b.enabled, b.enabled ? methodLabel(b.method) : null)
  db.logToLatest(c.id, { stage: 'action', label: b.enabled ? 'Autopay enrolled' : 'Autopay turned off', toolName: 'payments.autopay', status: 'completed', inputSummary: 'customer request', outputSummary: b.enabled ? `Monthly payment will draft from ${methodLabel(b.method)} (simulated).` : 'Autopay off.' })
  return Response.json({ autopay, account: account(c.id) })
}
