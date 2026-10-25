import { z } from 'zod'
import { store } from '@/lib/db.ts'
import { actionsFor, askContext, deterministicAnswer, HOW, parseWhatIf, simplestPath, whatIfAnswer, type Answer } from '@/lib/ask.ts'
import { getCustomer } from '@/lib/data.ts'
import type { Task } from '@/lib/action-agent.ts'
import { llmAnswer, llmConfigured } from '@/lib/llm.ts'

export const dynamic = 'force-dynamic'

const Body = z.object({
  customerId: z.string().max(64), question: z.string().min(1).max(600),
  history: z.array(z.object({ role: z.enum(['user', 'next']), text: z.string().max(1200) })).max(12).default([]),
})

export async function POST(req: Request) {
  const p = Body.safeParse(await req.json().catch(() => null))
  if (!p.success) return Response.json({ error: z.prettifyError(p.error) }, { status: 400 })
  const { customerId, question, history } = p.data
  const db = store()
  const rec = db.listRecommendations(customerId, 1)[0]
  if (!rec) return Response.json({ error: 'Run the decision workflow first.' }, { status: 409 })

  const c = getCustomer(customerId)!
  const scen = db.getScenarios([rec.scenarioId])[0]
  const ctx = askContext(c, rec, scen, db.listTasks<Task>(customerId, rec.id))
  // "But how?" after a how-answer is still a how-question: look at the last few user turns too.
  const recentUser = [...history.filter(h => h.role === 'user').slice(-1).map(h => h.text), question].join(' ').toLowerCase()
  const isHow = HOW.test(question.toLowerCase()) || (/^(but )?(how|ok|okay|and|then)\b/.test(question.toLowerCase().trim()) && HOW.test(recentUser))

  let answer: Answer
  const whatIf = parseWhatIf(question)
  if (whatIf) answer = { ...(await whatIfAnswer(customerId, rec.inputs, whatIf, rec)), actions: [{ id: 'twin', label: 'Try it in NEXT Twin' }] }
  else if (isHow && !/(how much|how many)/.test(question.toLowerCase()))
    answer = history.filter(h => h.role === 'next').at(-1)?.text.startsWith('Here’s how') ? simplestPath(ctx) : deterministicAnswer('how', rec, ctx) // steps first; asked again → offer to do it
  else {
    answer = deterministicAnswer(question, rec, ctx)
    if (llmConfigured()) {
      const facts = { recommendedAction: rec.recommendedAction, headline: rec.headline, reasons: rec.reasons, tradeoffs: rec.tradeoffs, qualifications: rec.qualifications, alternatives: rec.alternatives, nextAction: rec.nextAction, account: ctx }
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000)
      try { answer = { ...answer, text: await llmAnswer(question, facts, ctl.signal, history), source: 'llm', actions: actionsFor(answer.intent, ctx) } }
      catch { /* deterministic answer stands */ }
      finally { clearTimeout(t) }
    }
  }
  db.logToLatest(customerId, {
    stage: 'decision', label: whatIf ? 'What-if simulation' : 'Answer question', toolName: whatIf ? 'runWorkflow (hypothetical)' : `ask.${answer.source}`,
    status: 'completed', inputSummary: `"${question.slice(0, 120)}"`, outputSummary: `${answer.intent} via ${answer.source}${answer.ran ? ': ' + answer.ran.headline : ''}`,
  })
  return Response.json({ answer })
}
