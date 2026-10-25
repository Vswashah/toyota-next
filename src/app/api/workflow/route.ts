import { z } from 'zod'
import { getCustomer } from '@/lib/data.ts'
import { AssumptionsSchema } from '@/lib/scenarios.ts'
import { runWorkflow } from '@/lib/engine.ts'
import { store } from '@/lib/db.ts'
import { whatChanged } from '@/lib/history.ts'
import { llmConfigured, llmExplainer } from '@/lib/llm.ts'
import { serpConfigured } from '@/lib/market.ts'
import { recallWatch } from '@/lib/recalls.ts'

export const dynamic = 'force-dynamic'

const Body = z.object({
  customerId: z.string().max(64),
  request: z.string().max(500).optional(),
  overrides: AssumptionsSchema.partial().optional(),
  trigger: z.string().max(60).default('manual'),
})

// Streams real workflow events as NDJSON, then the persisted result.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 })
  const { customerId, request, overrides, trigger } = parsed.data
  if (!getCustomer(customerId)) return Response.json({ error: 'Unknown customer' }, { status: 404 })

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      try {
        const db = store()
        const prev = db.listRecommendations(customerId, 1)[0] ?? null
        const result = await runWorkflow({ customerId, request, overrides, explainer: llmConfigured() ? llmExplainer : null, recallWatch: serpConfigured() ? recallWatch : null, onEvent: send })
        const stored = db.saveWorkflow(result, trigger)
        const changed = prev && stored ? await whatChanged(prev, stored, db.getScenarios(prev.scenarioIds), result.scenarios) : null
        send({ type: 'result', result: { ...result, recommendation: stored ?? result.recommendation }, whatChanged: changed })
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : String(e) })
      }
      ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' } })
}
