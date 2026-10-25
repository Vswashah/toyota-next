import { getCustomer } from '@/lib/data.ts'
import { lookupMarketValue, serpConfigured } from '@/lib/market.ts'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  if (!serpConfigured()) return Response.json({ error: 'SERPAPI_KEY is not set' }, { status: 503 })
  const c = getCustomer(new URL(req.url).searchParams.get('customerId') ?? '')
  if (!c) return Response.json({ error: 'Unknown customer' }, { status: 404 })
  try {
    return Response.json(await lookupMarketValue(c.vehicle, AbortSignal.timeout(20000)))
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 })
  }
}
