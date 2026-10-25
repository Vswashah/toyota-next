// Recall Watch agent: Google News via SerpAPI, Gemini picks headlines about this year/model.
// The signal quotes the headline and links the source; it never claims the customer's VIN is affected.
import type { Vehicle } from './data.ts'
import type { Signal } from './decision.ts'
import { gemini } from './llm.ts'

export interface NewsItem { title: string; link: string; source?: { name?: string }; date?: string }

/** Keyword pre-filter: mentions a recall and the model. */
export const recallCandidates = (news: NewsItem[], v: Vehicle) =>
  news.filter(n => /recall/i.test(n.title) && n.title.toLowerCase().includes(v.model.toLowerCase())).slice(0, 10)

// ponytail: in-memory per-vehicle cache so slider re-runs don't burn SerpAPI quota; lost on restart
const cache = new Map<string, { at: number; sig: Signal | null }>()

export async function recallWatch(v: Vehicle, signal: AbortSignal): Promise<Signal | null> {
  const key = `${v.year}-${v.model}`, hit = cache.get(key)
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.sig
  if (process.env.SERPAPI_KEY === 'mock') return null
  const res = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ engine: 'google_news', q: `Toyota ${v.model} ${v.year} recall`, gl: 'us', hl: 'en', api_key: process.env.SERPAPI_KEY! })}`, { signal, cache: 'no-store' })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error ?? `SerpAPI ${res.status}`)
  let cands = recallCandidates(json.news_results ?? [], v)
  if (cands.length && process.env.GEMINI_API_KEY) {
    const out = await gemini('You screen news headlines for a vehicle owner. Reply with JSON only.',
      `Return the indices of headlines that report a safety recall that could include a ${v.year} Toyota ${v.model} (model-year ranges count).\n${cands.map((n, i) => `${i}. ${n.title}`).join('\n')}`,
      signal, { responseMimeType: 'application/json', responseSchema: { type: 'ARRAY', items: { type: 'INTEGER' } } })
    const keep = new Set(JSON.parse(out) as number[])
    cands = cands.filter((_, i) => keep.has(i))
  }
  const n = cands[0]
  const sig: Signal | null = n ? {
    id: 'recall-news', title: `Possible recall for ${v.year} ${v.model}`, description: n.title, url: n.link,
    data: { Source: n.source?.name ?? 'news', ...(n.date ? { Date: n.date.split(',')[0] } : {}), ...(cands.length > 1 ? { 'Related stories': String(cands.length - 1) } : {}) },
    whyItMatters: 'Recall repairs are free at Toyota dealers. A headline does not mean your specific vehicle is affected.',
    nextAction: 'Check your VIN on NHTSA', urgency: 'watch', evidence: `Google News via SerpAPI${process.env.GEMINI_API_KEY ? ', screened by Gemini' : ''}`,
  } : null
  cache.set(key, { at: Date.now(), sig })
  return sig
}
