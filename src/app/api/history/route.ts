import { store } from '@/lib/db.ts'
import { whatChanged } from '@/lib/history.ts'

export const dynamic = 'force-dynamic'

// ?customerId=… lists versions; add &from=<recId>&to=<recId> to compare two of them.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const customerId = q.get('customerId') ?? ''
  const db = store()
  const from = q.get('from'), to = q.get('to')
  if (from && to) {
    const a = db.getRecommendation(from), b = db.getRecommendation(to)
    if (!a || !b || a.customerId !== customerId || b.customerId !== customerId) return Response.json({ error: 'Unknown recommendation' }, { status: 404 })
    const sa = db.getScenarios(a.scenarioIds), sb = db.getScenarios(b.scenarioIds)
    return Response.json({ whatChanged: await whatChanged(a, b, sa, sb), scenarios: { from: sa, to: sb } })
  }
  return Response.json({ recommendations: db.listRecommendations(customerId) })
}
