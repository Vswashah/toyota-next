import { z } from 'zod'
import { computeImpact } from '@/lib/impact.ts'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return Response.json(await computeImpact(await req.json().catch(() => ({}))))
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? z.prettifyError(e) : String(e) }, { status: 400 })
  }
}
