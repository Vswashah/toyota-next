'use client'
// Agent Studio: pick a template or start blank, configure in one form, run against the live connectors, watch the trace and metrics.
import { useEffect, useState } from 'react'
import type { NextState } from './use-next'
import type { AgentSpec, RunResult, TraceStep } from '@/lib/platform.ts'
import { Badge, Panel } from './ui'

type Agent = AgentSpec & { template: boolean; saved: boolean }
interface Conn { name: string; label: string; description: string; ready: boolean; requires: string | null }
interface Metric { agentId: string; runs: number; ok: number; blocked: number; errors: number; avgMs: number; tokens: number }
type PastRun = Omit<RunResult, 'agentId'> & { input: string }
interface Data { agents: Agent[]; connectors: Conn[]; metrics: Metric[]; models: string[]; runs: PastRun[] }

const blank = (): Agent => ({
  id: `agent-${Math.random().toString(36).slice(2, 7)}`, name: 'New agent', description: '', template: false, saved: false, model: 'gemini-3.5-flash-lite',
  instructions: '', tools: [],
  guardrails: { groundNumbers: true, maxSteps: 5, timeoutMs: 30000 },
})
const tone = (s: string) => (s === 'ok' ? 'good' : s === 'blocked' ? 'warn' : 'red') as 'good' | 'warn' | 'red'
const field = 'w-full rounded-lg border border-line bg-bg px-2 py-2 text-[13px]'

function Trace({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-2 text-[12px]">
          <span className="w-16 shrink-0 font-mono text-[10px] uppercase text-mute">{s.kind}</span>
          <span className="min-w-0 flex-1"><b className="font-medium">{s.name}</b> <span className="text-mute">{s.detail}</span></span>
          <span className="shrink-0"><Badge tone={tone(s.status)}>{s.status}</Badge></span>
          <span className="num w-14 shrink-0 text-right text-mute">{s.ms} ms</span>
        </li>
      ))}
    </ol>
  )
}

export function Studio({ st }: { st: NextState }) {
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<Agent | null>(null)
  const [dirty, setDirty] = useState(false)
  const [input, setInput] = useState('')
  const [run, setRun] = useState<RunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async (select?: string) => {
    const d: Data = await (await fetch(`/api/agents${select ? `?runs=${select}` : ''}`)).json()
    setData(d)
    if (!draft || select) setDraft(d.agents.find(a => a.id === (select ?? draft?.id)) ?? d.agents[0])
  }
  useEffect(() => { load().catch(e => setErr(String(e))) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // A new draft isn't on the server yet: reloading by its id would fall back to the first agent, so don't.
  const pick = (a: Agent, fresh = false) => {
    setDraft(a); setDirty(fresh); setRun(null); setErr(null)
    if (fresh) setData(d => d && { ...d, runs: [] })
    else load(a.id).catch(e => setErr(String(e)))
  }
  const edit = (p: Partial<Agent>) => { setDraft(d => d && { ...d, ...p }); setDirty(true) }
  const post = async (body: object) => {
    const r = await fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error ?? r.statusText)
    return j
  }
  const save = async () => { const { template: _t, saved: _s, ...spec } = draft!; await post({ op: 'save', spec }); setDirty(false); await load(draft!.id) }
  const go = async () => {
    setBusy(true); setErr(null); setRun(null)
    try {
      if (dirty || !data?.agents.some(a => a.id === draft!.id)) await save()
      setRun((await post({ op: 'run', agentId: draft!.id, input, customerId: st.customerId ?? undefined })).run)
      await load(draft!.id)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!data || !draft) return <p className="text-sm text-mute">{err ?? 'Loading agents…'}</p>
  const m = (id: string) => data.metrics.find(x => x.agentId === id)
  const saved = data.agents.find(a => a.id === draft.id)?.saved
  const problem = draft.name.trim().length < 2 ? 'Give the agent a short name.' : draft.instructions.trim().length < 10 ? 'Write the instructions: what should this agent accomplish?' : null

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-mute">Describe what the agent should do and grant it connectors. The platform supplies the model loop, tool validation and permissions, number-grounding guardrail, timeouts, tracing and metrics.</p>
      <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          <button className="btn btn-red w-full justify-center" onClick={() => pick(blank(), true)}>+ New agent</button>
          {data.agents.map(a => {
            const k = m(a.id)
            return (
              <button key={a.id} onClick={() => pick(a)} className={`panel-elev w-full p-3 text-left transition hover:border-red ${draft.id === a.id ? 'border-red' : ''}`}>
                <div className="flex items-center justify-between gap-2"><span className="font-display">{a.name}</span>{a.template && <Badge tone="blue">template</Badge>}</div>
                <div className="mt-0.5 text-[12px] text-mute">{a.description}</div>
                <div className="num mt-2 text-[11px] text-mute">{k ? `${k.runs} runs · ${Math.round((k.ok / k.runs) * 100)}% ok · ${(k.avgMs / 1000).toFixed(1)}s avg${k.blocked ? ` · ${k.blocked} blocked` : ''}` : 'no runs yet'}</div>
              </button>
            )
          })}
        </div>

        <div className="grid gap-4 2xl:grid-cols-2">
          <Panel title="Configure" right={<div className="flex gap-2">
            {saved && <button className="text-[11px] text-mute underline decoration-dotted hover:text-ink" onClick={async () => { await post({ op: 'delete', id: draft.id }); setDirty(false); await load(draft.id) }}>{draft.template ? 'Reset to template' : 'Delete'}</button>}
            <button className="btn" disabled={!dirty || !!problem} onClick={() => save().catch(e => setErr(e.message))}>{dirty ? 'Save' : 'Saved'}</button>
          </div>}>
            <div className="space-y-3">
              <label className="block text-[12.5px]"><span className="text-mute">Name</span><input className={field} maxLength={60} placeholder="Short name, e.g. Lease-end Coach" value={draft.name} onChange={e => edit({ name: e.target.value })} /></label>
              <label className="block text-[12.5px]"><span className="text-mute">Description</span><input className={field} value={draft.description} onChange={e => edit({ description: e.target.value })} /></label>
              <label className="block text-[12.5px]"><span className="text-mute">Instructions: what should this agent accomplish?</span><textarea rows={6} className={field} maxLength={4000} placeholder="e.g. Help customers whose lease is ending decide whether to return or buy out. Look up the profile, run the decision engine and check market value. Answer in at most 100 words." value={draft.instructions} onChange={e => edit({ instructions: e.target.value })} /></label>
              {problem && <p className="text-[12px] text-warn">{problem}</p>}
              <label className="block text-[12.5px]"><span className="text-mute">Model</span>
                <select className={field} value={draft.model} onChange={e => edit({ model: e.target.value as Agent['model'] })}>{data.models.map(x => <option key={x}>{x}</option>)}</select></label>
              <fieldset><legend className="label mb-1">Connectors</legend>
                {data.connectors.map(c => (
                  <label key={c.name} className="flex items-start gap-2 py-1 text-[12.5px]">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#EB0A1E]" checked={draft.tools.includes(c.name)} onChange={e => edit({ tools: e.target.checked ? [...draft.tools, c.name] : draft.tools.filter(t => t !== c.name) })} />
                    <span><span className="text-ink">{c.label}</span>{!c.ready && <span className="ml-2 text-warn">needs {c.requires}</span>}<br /><span className="text-mute">{c.description}</span></span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="grid grid-cols-3 gap-3 text-[12.5px]"><legend className="label mb-1">Guardrails</legend>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-[#EB0A1E]" checked={draft.guardrails.groundNumbers} onChange={e => edit({ guardrails: { ...draft.guardrails, groundNumbers: e.target.checked } })} />Ground numbers</label>
                <label><span className="text-mute">Max model steps</span><input type="number" min={1} max={8} className={field} value={draft.guardrails.maxSteps} onChange={e => edit({ guardrails: { ...draft.guardrails, maxSteps: Number(e.target.value) } })} /></label>
                <label><span className="text-mute">Timeout (s)</span><input type="number" min={5} max={60} className={field} value={draft.guardrails.timeoutMs / 1000} onChange={e => edit({ guardrails: { ...draft.guardrails, timeoutMs: Number(e.target.value) * 1000 } })} /></label>
              </fieldset>
            </div>
          </Panel>

          <Panel title="Run & monitor">
            <div className="space-y-3">
              <textarea rows={3} className={field} placeholder={`Ask ${draft.name} something${st.customer ? ` about ${st.customer.displayName}` : ''}…`} value={input} onChange={e => setInput(e.target.value)} />
              <button className="btn btn-red" disabled={busy || !input.trim() || !!problem} onClick={go}>{busy ? 'Running…' : dirty ? 'Save & run' : 'Run'}</button>
              {err && <p className="text-[12px] text-red">{err}</p>}
              {run && (
                <div className="space-y-3 rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-mute"><Badge tone={tone(run.status)}>{run.status}</Badge><span className="num">{(run.ms / 1000).toFixed(1)}s · {run.tokens} tokens · {run.model}</span></div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{run.answer}</p>
                  <div className="label">Trace</div><Trace steps={run.steps} />
                </div>
              )}
              {data.runs.length > 0 && <div>
                <div className="label mb-1">Recent runs</div>
                <ul className="space-y-1 text-[12px]">{data.runs.map(r => <li key={r.id} className="flex items-center gap-2"><Badge tone={tone(r.status)}>{r.status}</Badge><span className="min-w-0 flex-1 truncate text-mute">{r.input}</span><span className="num text-mute">{(r.ms / 1000).toFixed(1)}s</span></li>)}</ul>
              </div>}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

