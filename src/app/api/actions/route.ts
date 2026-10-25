import { z } from 'zod'
import { store } from '@/lib/db.ts'
import { invokeTool, ToolError } from '@/lib/tools.ts'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  return Response.json({ actions: store().listActions(new URL(req.url).searchParams.get('customerId') ?? '') })
}

const fail = (e: unknown) => Response.json({ error: e instanceof ToolError ? `${e.kind}: ${e.message}` : String(e) }, { status: e instanceof ToolError && e.kind === 'execution' ? 404 : 400 })

// The Action Agent creates steps only through its tool, and only when the customer asks.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const db = store()
  try {
    const a = invokeTool('create_customer_action', body, { stage: 'action', store: db })
    db.logToLatest(a.customerId as string, { stage: 'action', label: 'Create customer action', toolName: 'create_customer_action', status: 'completed', inputSummary: `${a.actionType}: ${a.title}`, outputSummary: `Created ${a.id} (open). Simulated; no external transaction.` })
    return Response.json({ action: a })
  } catch (e) { return fail(e) }
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null)
  const p = z.object({ customerId: z.string().max(64) }).passthrough().safeParse(body)
  const db = store()
  try {
    const a = invokeTool('update_customer_action', { actionId: (body as { actionId?: unknown })?.actionId, status: (body as { status?: unknown })?.status }, { stage: 'action', store: db })
    if (p.success) db.logToLatest(p.data.customerId, { stage: 'action', label: 'Update customer action', toolName: 'update_customer_action', status: 'completed', inputSummary: `${a.id} → ${a.status}`, outputSummary: `${a.title} marked ${a.status} at the customer’s request (simulated).` })
    return Response.json({ action: a })
  } catch (e) { return fail(e) }
}
