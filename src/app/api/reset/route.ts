import { z } from 'zod'
import { store } from '@/lib/db.ts'

export async function POST(req: Request) {
  const p = z.object({ customerId: z.string().max(64) }).safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: 'customerId required' }, { status: 400 })
  store().resetCustomer(p.data.customerId)
  return Response.json({ ok: true })
}
