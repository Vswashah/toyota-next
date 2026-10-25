import { store } from '@/lib/db.ts'
import { postStripePayment, retrieveSession, verifyWebhook } from '@/lib/stripe.ts'

export const dynamic = 'force-dynamic'

// Stripe → us: posts the payment even if the customer closed the tab before returning. Signature-verified.
export async function POST(req: Request) {
  const sig = req.headers.get('stripe-signature')
  if (!sig) return Response.json({ error: 'Missing signature' }, { status: 400 })
  let event
  try { event = verifyWebhook(await req.text(), sig) }
  catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }) }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    try { postStripePayment(store(), await retrieveSession(event.data.object.id)) }
    catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }) } // Stripe retries on 5xx
  }
  return Response.json({ received: true })
}
