import { store } from '@/lib/db.ts'

export const dynamic = 'force-dynamic'

export function GET(req: Request) {
  const q = new URL(req.url).searchParams
  return Response.json({ executions: store().listExecutions(q.get('customerId') ?? '', Math.min(Number(q.get('limit') ?? 10), 50)) })
}
