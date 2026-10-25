import { z } from 'zod'
import { CUSTOMERS, getCustomer } from '@/lib/data.ts'
import { store } from '@/lib/db.ts'
import { decodeVin, SettingsSchema, toProfileEdit } from '@/lib/profile.ts'

export const dynamic = 'force-dynamic'

const view = (id: string) => {
  const c = getCustomer(id)!, base = CUSTOMERS.find(x => x.id === id)!
  return {
    customer: { vehicle: c.vehicle, zip: c.zip ?? null, monthlyBudget: c.monthlyBudget, contactPreference: c.contactPreference ?? null },
    original: { vehicle: base.vehicle, zip: base.zip ?? null, monthlyBudget: base.monthlyBudget },
    settings: store().getSettings(id),
  }
}

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('customerId') ?? ''
  store()
  if (!getCustomer(id)) return Response.json({ error: 'Unknown customer' }, { status: 404 })
  return Response.json(view(id))
}

// Replaces the customer's saved settings (send {} to undo all edits).
export async function PUT(req: Request) {
  const p = z.object({ customerId: z.string().max(64), settings: SettingsSchema }).safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 })
  const db = store(), { customerId, settings } = p.data
  if (!getCustomer(customerId)) return Response.json({ error: 'Unknown customer' }, { status: 404 })
  db.saveSettings(customerId, settings, toProfileEdit(settings))
  db.logToLatest(customerId, { stage: 'context', label: 'Customer updated their details', toolName: 'profile.update', status: 'completed', inputSummary: Object.keys(settings).join(', ') || 'cleared all edits', outputSummary: 'Profile overlay updated; Michi will re-check with the new details.' })
  return Response.json(view(customerId))
}

export async function POST(req: Request) {
  const p = z.object({ action: z.literal('decode-vin'), vin: z.string().max(20) }).safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: 'Send { action: "decode-vin", vin }' }, { status: 400 })
  try { return Response.json(await decodeVin(p.data.vin, AbortSignal.timeout(10000))) }
  catch (e) { return Response.json({ error: e instanceof z.ZodError ? e.issues[0].message : (e as Error).message }, { status: 400 }) }
}
