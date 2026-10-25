import { z } from 'zod'
import { AgentSpecSchema, CONNECTORS, MODELS, TEMPLATES, connectorReady, deleteAgent, getAgent, listAgents, metrics, recentRuns, runAgent, saveAgent, saveRun } from '@/lib/platform.ts'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const runsFor = new URL(req.url).searchParams.get('runs')
  return Response.json({
    agents: listAgents(), metrics: metrics(), models: MODELS,
    connectors: Object.values(CONNECTORS).map(c => ({ name: c.name, label: c.label, description: c.description, ready: connectorReady(c), requires: c.requires ?? null })),
    runs: runsFor ? recentRuns(runsFor) : [],
  })
}

const Body = z.discriminatedUnion('op', [
  z.object({ op: z.literal('save'), spec: AgentSpecSchema }),
  z.object({ op: z.literal('delete'), id: z.string().max(40) }),
  z.object({ op: z.literal('run'), agentId: z.string().max(40), input: z.string().min(1).max(2000), customerId: z.string().max(64).optional() }),
])

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 })
  const b = p.data
  if (b.op === 'save') return Response.json({ agent: saveAgent(b.spec) })
  if (b.op === 'delete') {
    deleteAgent(b.id)
    return Response.json({ ok: true, revertedToTemplate: TEMPLATES.some(t => t.id === b.id) })
  }
  const spec = getAgent(b.agentId)
  if (!spec) return Response.json({ error: 'Unknown agent' }, { status: 404 })
  const run = await runAgent(spec, b.input, { customerId: b.customerId })
  saveRun(run, b.input)
  return Response.json({ run })
}
