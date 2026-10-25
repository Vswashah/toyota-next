'use client'
import { useEffect, useRef, useState } from 'react'
import type { NextState } from './use-next'
import { MichiMark } from './michi'

const SUGGESTIONS = ['How do I do this?', 'What’s the catch?', 'What if my budget was $450?']

export function AgentPanel({ st, onNavigate }: { st: NextState; onNavigate?: (v: string) => void }) {
  const [q, setQ] = useState('')
  const [requested, setRequested] = useState(false)
  const doAction = async (id: string) => {
    if (id === 'specialist') {
      setRequested(true)
      try { await st.createAction({ actionType: 'human_handoff', title: 'Specialist call requested from Ask Michi', details: [st.result?.recommendation?.headline ?? '', 'Requested by the customer in chat.'] }) } catch { setRequested(false) }
      return
    }
    onNavigate?.(({ open_plan: 'steps', payments: 'payments', twin: 'twin', settings: 'settings' } as Record<string, string>)[id] ?? 'overview')
  }
  const chatEnd = useRef<HTMLDivElement>(null)
  const rec = st.result?.recommendation
  useEffect(() => { if (st.chat.length) chatEnd.current?.scrollIntoView({ block: 'nearest' }) }, [st.chat.length])

  const send = (text: string) => { if (text.trim() && !st.asking) { st.ask(text.trim()); setQ('') } }

  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto p-4" aria-label="Ask Michi">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><MichiMark size={26} /><span className="font-display text-sm tracking-[.18em]">Ask Michi</span><span className={`h-2 w-2 rounded-full ${st.running ? 'bg-red pulse-dot' : 'bg-good'}`} /></div>
      </div>

      <section className="panel flex min-h-[220px] flex-1 flex-col p-4">
        <div className="flex-1 space-y-2 overflow-y-auto text-[13px]">
          {st.chat.length === 0 && <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map(s => <button key={s} className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-mute hover:text-ink" onClick={() => send(s)} disabled={!rec}>{s}</button>)}</div>}
          {st.chat.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'ml-6 rounded-lg bg-elev px-3 py-2' : 'mr-2 rounded-lg border border-line px-3 py-2'}>
              <div>{m.text}</div>
              {m.steps && <ol className="mt-1.5 list-decimal space-y-1 pl-5">{m.steps.map(s => <li key={s}>{s}</li>)}</ol>}
              {m.links?.map(l => <a key={l.link} href={l.link} target="_blank" rel="noreferrer" className="mt-1.5 block text-[12.5px] text-[#8fb8ee] underline">{l.title} ↗</a>)}
              {m.actions && i === st.chat.length - 1 && <div className="mt-2 flex flex-wrap gap-1.5">{m.actions.map(a => (
                <button key={a.id} className="rounded-full border border-line px-3 py-1 text-[12px] hover:border-red" disabled={a.id === 'specialist' && requested} onClick={() => doAction(a.id)}>{a.id === 'specialist' && requested ? '✓ A specialist will call you' : a.label}</button>
              ))}</div>}
            </div>
          ))}
          {st.asking && <div className="text-[12px] text-mute"><span className="pulse-dot">●</span> Michi is thinking…</div>}
          <div ref={chatEnd} />
        </div>
        <form className="mt-2 flex gap-2" onSubmit={e => { e.preventDefault(); send(q) }}>
          <input value={q} onChange={e => setQ(e.target.value)} maxLength={600} placeholder={rec ? 'Ask about your recommendation…' : 'Run the workflow first'} disabled={!rec} aria-label="Ask Michi a question"
            className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-[13px] placeholder:text-mute/70 focus:border-red focus:outline-none" />
          <button className="btn btn-red" disabled={!rec || !q.trim() || st.asking}>Ask</button>
        </form>
        <p className="mt-1.5 text-[10.5px] text-mute">Estimates, not offers.</p>
      </section>
    </aside>
  )
}
