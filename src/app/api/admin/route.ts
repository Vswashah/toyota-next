import { z } from 'zod'
import { adminOverview, cohortPipeline } from '@/lib/admin.ts'
import { getCustomer } from '@/lib/data.ts'
import { store } from '@/lib/db.ts'
import { invokeTool, ToolError } from '@/lib/tools.ts'

export const dynamic = 'force-dynamic'

// Optional gate: set ADMIN_PASSCODE to require it on every admin call.
const denied = (req: Request) => !!process.env.ADMIN_PASSCODE && req.headers.get('x-admin-passcode') !== process.env.ADMIN_PASSCODE

export async function GET(req: Request) {
  if (denied(req)) return Response.json({ error: 'Admin passcode required' }, { status: 401 })
  const margin = Math.min(10, Math.max(0, Number(new URL(req.url).searchParams.get('margin') ?? 2) || 0))
  return Response.json({ ...adminOverview(margin), cohort: await cohortPipeline(margin), gated: !!process.env.ADMIN_PASSCODE })
}

const Body = z.object({
  customerId: z.string().max(64),
  kind: z.enum(['follow_up', 'specialist']),
  message: z.string().trim().min(1).max(500),
})

// TFS team outreach: lands in the customer's Next Steps as a tracked action (simulated, no external send).
export async function POST(req: Request) {
  if (denied(req)) return Response.json({ error: 'Admin passcode required' }, { status: 401 })
  const p = Body.safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 })
  const { customerId, kind, message } = p.data
  if (!getCustomer(customerId)) return Response.json({ error: 'Unknown customer' }, { status: 404 })
  const db = store()
  const rec = db.listRecommendations(customerId, 1)[0]
  try {
    const action = invokeTool('create_customer_action', {
      customerId, recommendationId: rec?.id ?? null,
      actionType: kind === 'specialist' ? 'human_handoff' : 'follow_up',
      title: kind === 'specialist' ? 'TFS team: a specialist will contact you' : 'TFS team: follow-up on your next move',
      details: [message, ...(rec ? [`About: ${rec.recommendedAction} (${rec.headline})`] : []), 'Sent by the Toyota Financial Services team (simulated; no message was actually sent).'],
    }, { stage: 'action', store: db })
    db.logToLatest(customerId, { stage: 'action', label: kind === 'specialist' ? 'TFS team assigned specialist' : 'TFS team follow-up', toolName: 'create_customer_action', status: 'completed', inputSummary: `admin console: ${message.slice(0, 100)}`, outputSummary: `Created ${action.id}; visible in the customer's Next Steps.` })
    return Response.json({ action })
  } catch (e) {
    return Response.json({ error: e instanceof ToolError ? `${e.kind}: ${e.message}` : String(e) }, { status: 400 })
  }
}
