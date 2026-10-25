import { z } from 'zod'
import { getCustomer } from '@/lib/data.ts'
import { store } from '@/lib/db.ts'
import { approveTask, briefing, dismissTask, runPlan, type Task } from '@/lib/action-agent.ts'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('customerId') ?? ''
  const db = store(), rec = db.listRecommendations(id, 1)[0]
  const tasks = rec ? db.listTasks<Task>(id, rec.id) : []
  return Response.json({ tasks, briefing: tasks.length ? briefing(tasks) : null, recommendationId: rec?.id ?? null })
}

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), customerId: z.string().max(64), force: z.boolean().optional() }),
  z.object({ action: z.literal('approve'), customerId: z.string().max(64), taskId: z.string().max(64), dealerIndex: z.number().int().min(0).max(5).optional(), when: z.string().max(80).optional() }),
  z.object({ action: z.literal('dismiss'), customerId: z.string().max(64), taskId: z.string().max(64) }),
])

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 })
  const b = p.data
  store() // load overlays
  if (!getCustomer(b.customerId)) return Response.json({ error: 'Unknown customer' }, { status: 404 })
  try {
    if (b.action === 'approve') return Response.json(await approveTask(b.customerId, b.taskId, { dealerIndex: b.dealerIndex, when: b.when }))
    if (b.action === 'dismiss') return Response.json(dismissTask(b.customerId, b.taskId))
  } catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }) }

  // run: stream each task update as Michi works through the plan
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      try {
        const r = await runPlan(b.customerId, { force: b.force, onTask: t => send({ type: 'task', task: t }) })
        send({ type: 'done', tasks: r.tasks, briefing: r.briefing })
      } catch (e) { send({ type: 'error', error: (e as Error).message }) }
      ctrl.close()
    },
  }), { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
}
