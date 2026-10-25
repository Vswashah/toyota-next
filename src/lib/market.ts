// Live used-listing prices via SerpAPI (Google results). Context for the vehicle-value assumption only;
// nothing here feeds the engine unless the customer applies it in NEXT Twin.
import type { Vehicle } from './data.ts'
import { gemini } from './llm.ts'

export const serpConfigured = () => !!process.env.SERPAPI_KEY

export interface MarketSource { title: string; link: string; price: number; context?: string }
export interface MarketLookup { via: 'gemini' | 'regex'; query: string; median: number | null; low: number | null; high: number | null; count: number; sources: MarketSource[]; fetchedAt: string }

interface SerpResult { title?: string; link?: string; product_link?: string; snippet?: string; extracted_price?: number; price?: string; rich_snippet?: unknown }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2) }

/** Prices from shopping results and organic snippets, kept only if plausible for this vehicle. */
export function extractPrices(json: { shopping_results?: SerpResult[]; organic_results?: SerpResult[] }, estimate: number): MarketSource[] {
  // ponytail: band around the synthetic estimate drops "$500 down"-style noise; swap for a listings API if precision matters
  const ok = (p: number) => p >= estimate * 0.5 && p <= estimate * 1.6
  const out: MarketSource[] = []
  for (const r of json.shopping_results ?? []) {
    const p = r.extracted_price ?? Number(r.price?.replace(/[^\d.]/g, ''))
    if (p && ok(p)) out.push({ title: r.title ?? '', link: r.product_link ?? r.link ?? '', price: Math.round(p), context: r.title })
  }
  for (const r of json.organic_results ?? []) {
    // Listing sites often put the asking price only in Google's structured rich snippet.
    const rich = r.rich_snippet ? JSON.stringify(r.rich_snippet) : ''
    for (const m of `${r.title ?? ''} ${r.snippet ?? ''} ${rich}`.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{4,6})/g)) {
      const p = Number(m[1].replace(/,/g, ''))
      if (ok(p)) out.push({ title: r.title ?? '', link: r.link ?? '', price: p, context: `${r.title ?? ''} — ${r.snippet ?? ''}` })
    }
  }
  return out
}

export function summarize(query: string, prices: MarketSource[], via: MarketLookup['via'] = 'regex'): MarketLookup {
  const ps = prices.map(p => p.price), enough = ps.length >= 3
  return {
    via, query, count: ps.length, fetchedAt: new Date().toISOString(),
    median: enough ? median(ps) : null, low: enough ? Math.min(...ps) : null, high: enough ? Math.max(...ps) : null,
    sources: prices.map(({ context: _, ...p }) => p).filter((p, i, a) => p.link && a.findIndex(q => q.link === p.link) === i).slice(0, 5),
  }
}

/** SERPAPI_KEY=mock: SerpAPI-shaped sample results around the synthetic value, for demos without a key. */
const mockResults = (v: Vehicle) => {
  const name = `${v.year} ${v.make} ${v.model} ${v.trim}`, p = (f: number) => Math.round(v.estimatedMarketValue * f / 10) * 10
  return {
    shopping_results: [{ title: `${name} (sample)`, product_link: 'https://example.com/listing-1', extracted_price: p(1.04) }],
    organic_results: [
      { title: `Used ${name} for sale (sample)`, link: 'https://example.com/listing-2', snippet: `Prices from $${p(0.95).toLocaleString()} to $${p(1.08).toLocaleString()}.` },
      { title: `${name} price guide (sample)`, link: 'https://example.com/listing-3', snippet: `Typical asking price $${p(1.01).toLocaleString()}. Only $500 down.` },
    ],
  }
}

export async function lookupMarketValue(v: Vehicle, signal?: AbortSignal): Promise<MarketLookup> {
  // "used … for sale price" returns generic Toyota brand pages; this phrasing returns listings and price guides.
  const query = `${v.year} ${v.make} ${v.model} ${v.trim} used price`
  if (process.env.SERPAPI_KEY === 'mock') return judge(query, v, extractPrices(mockResults(v), v.estimatedMarketValue), signal)
  const url = `https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google', q: query, gl: 'us', hl: 'en', api_key: process.env.SERPAPI_KEY! })}`
  const res = await fetch(url, { signal, cache: 'no-store' })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error ?? `SerpAPI ${res.status}`)
  return judge(query, v, extractPrices(json, v.estimatedMarketValue), signal)
}

/** Gemini picks which regex candidates are real asking prices for this vehicle. It only returns indices, never numbers. */
async function judge(query: string, v: Vehicle, cands: MarketSource[], signal?: AbortSignal): Promise<MarketLookup> {
  if (!process.env.GEMINI_API_KEY || !cands.length) return summarize(query, cands)
  try {
    const out = await gemini(
      'You filter web search snippets for a car valuation tool. Reply with JSON only.',
      `Vehicle: used ${v.year} ${v.make} ${v.model} ${v.trim}, ${v.odometer} miles.
Return the indices of candidates whose price is an asking/listing price or typical market price for a used ${v.year} ${v.model} (any trim is fine).
Exclude the ends of price ranges ("from $X to $Y"), down payments, monthly payments, new-car MSRP, price drops/savings, other model years, and prices for a different model.
${cands.map((c, i) => `${i}. $${c.price} | ${c.context}`).join('\n')}`,
      signal ?? AbortSignal.timeout(15000),
      { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'INTEGER' } } },
    )
    const keep = new Set((JSON.parse(out) as number[]).filter(i => Number.isInteger(i) && i >= 0 && i < cands.length))
    return summarize(query, cands.filter((_, i) => keep.has(i)), 'gemini')
  } catch {
    return summarize(query, cands) // ponytail: silent fallback; `via` tells the UI which path ran
  }
}
