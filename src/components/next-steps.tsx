'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NextState } from './use-next'
import type { Dealer, Link, Recall, Task } from '@/lib/action-agent.ts'
import type { MarketLookup } from '@/lib/market.ts'
import { Badge, Empty, Panel, usd } from './ui'
import { MichiMark } from './michi'

const ICON: Record<Task['kind'], string> = {
  check_recalls: '🛡️', market_value: '🏷️', find_dealers: '📍', official_help: '🔗', payoff_estimate: '🧾', set_reminder: '📅',
  specialist_summary: '🧑‍💼', book_appointment: '🗓️', update_value: '✏️',
}
const STATUS: Record<Task['status'], { label: string; tone: 'mute' | 'red' | 'good' | 'warn' | 'blue' }> = {
  pending: { label: 'Up next', tone: 'mute' }, running: { label: 'Working…', tone: 'red' }, done: { label: 'Done', tone: 'good' },
  needs_you: { label: 'Needs your OK', tone: 'warn' }, failed: { label: 'Couldn’t finish', tone: 'red' }, skipped: { label: 'Skipped', tone: 'mute' },
}
const TIMES = ['Next weekday morning', 'Next weekday afternoon', 'This Saturday']

function downloadIcs(date: string, title: string, details: string) {
  const d = date.replace(/-/g, ''), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const esc = (s: string) => s.replace(/[,;\\]/g, m => '\\' + m).replace(/\n/g, '\\n')
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TOYOTA NEXT//Michi//EN', 'BEGIN:VEVENT', `UID:${crypto.randomUUID()}@toyota-next`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(details)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'michi-reminder.ics'; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function Result({ t, tasks, onApprove, onDismiss, nav, busy }: { t: Task; tasks: Task[]; onApprove: (t: Task, c?: { dealerIndex?: number; when?: string }) => void; onDismiss: (t: Task) => void; nav: (v: string) => void; busy: boolean }) {
  const [dealer, setDealer] = useState(0), [when, setWhen] = useState(TIMES[0])
  const r = t.result as unknown
  if (t.status === 'needs_you') {
    if (t.kind === 'find_dealers') return <button className="btn btn-red mt-3" onClick={() => nav('settings')}>Add my ZIP code</button>
    const dealers = (tasks.find(x => x.kind === 'find_dealers' && x.status === 'done')?.result as Dealer[] | undefined) ?? []
    return (
      <div className="mt-3 space-y-3">
        {t.kind === 'book_appointment' && (dealers.length ? <>
          <fieldset className="space-y-1.5"><legend className="label mb-1">Which dealer?</legend>
            {dealers.map((d, i) => <label key={d.name} className="flex cursor-pointer items-center gap-2 text-[14px]"><input type="radio" name={`d-${t.id}`} checked={dealer === i} onChange={() => setDealer(i)} className="accent-[#EB0A1E]" />{d.name}{d.rating && <span className="text-mute">★ {d.rating}</span>}</label>)}
          </fieldset>
          <label className="block text-[13px]"><span className="label">When works?</span>
            <select value={when} onChange={e => setWhen(e.target.value)} className="mt-1 block rounded-lg border border-line bg-bg px-2 py-2 text-[14px]">{TIMES.map(x => <option key={x}>{x}</option>)}</select></label>
        </> : <p className="text-[13px] text-mute">Michi needs to find dealers first.</p>)}
        {t.kind === 'specialist_summary' && <p className="text-[14px] text-mute">Michi will write up your situation, its suggestion and your open questions, so a specialist can help without you explaining twice.</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-red px-5 py-2.5 text-[15px]" disabled={busy || (t.kind === 'book_appointment' && !dealers.length)} onClick={() => onApprove(t, { dealerIndex: dealer, when })}>
            {t.kind === 'book_appointment' ? 'Prepare my request' : t.kind === 'update_value' ? 'Yes, update it' : 'Yes, send it'}
          </button>
          <button className="btn px-5 py-2.5 text-[15px]" disabled={busy} onClick={() => onDismiss(t)}>Not now</button>
        </div>
      </div>
    )
  }
  if (t.status !== 'done') return null
  switch (t.kind) {
    case 'check_recalls': {
      const rs = r as Recall[]
      return rs.length ? (
        <div className="mt-3 space-y-2">{rs.map(x => <div key={x.campaign} className="rounded-lg border border-[#5a4520] bg-[#e8b04b0d] p-3 text-[13.5px]"><b>{x.component}</b> <span className="font-mono text-[11px] text-mute">#{x.campaign}</span><div className="mt-1 text-mute">{x.summary}</div>{x.remedy && <div className="mt-1"><span className="text-good">Fix:</span> {x.remedy}</div>}</div>)}
          <a className="text-[13px] text-[#8fb8ee] underline" href="https://www.nhtsa.gov/recalls" target="_blank" rel="noreferrer">Check your exact VIN at nhtsa.gov/recalls ↗</a></div>
      ) : <p className="mt-2 text-[14px] text-good">✓ No recalls listed for your model year.</p>
    }
    case 'market_value': {
      const m = r as MarketLookup
      if (!m.median || m.low == null || m.high == null) return null
      const span = m.high - m.low || 1, pos = (v: number) => `${Math.min(100, Math.max(0, ((v - m.low!) / span) * 100))}%`
      return (
        <div className="mt-4">
          <div className="relative h-2.5 rounded-full bg-gradient-to-r from-[#3987e555] via-[#3987e5] to-[#3987e555]">
            <div className="absolute top-1/2 h-5 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-white" style={{ left: pos(m.median) }} title="Typical" />
          </div>
          <div className="mt-2 flex justify-between text-[12.5px] text-mute"><span>{usd(m.low)}</span><span className="text-ink">Typical {usd(m.median)}</span><span>{usd(m.high)}</span></div>
          <div className="mt-2 flex flex-wrap gap-x-3 text-[12px]">{m.sources.slice(0, 3).map(s => <a key={s.link} href={s.link} target="_blank" rel="noreferrer" className="text-[#8fb8ee] underline">{new URL(s.link).hostname.replace('www.', '')} ↗</a>)}</div>
        </div>
      )
    }
    case 'find_dealers':
      return <div className="mt-3 grid gap-2 md:grid-cols-3">{(r as Dealer[]).map(d => (
        <div key={d.name} className="rounded-lg border border-line bg-bg p-3 text-[13px]">
          <div className="font-display text-[14px]">{d.name}</div>
          {d.rating && <div className="text-warn">{'★'.repeat(Math.round(d.rating))}<span className="ml-1 text-mute">{d.rating}{d.reviews ? ` (${d.reviews.toLocaleString()})` : ''}</span></div>}
          <div className="mt-1 text-mute">{d.address}</div>
          <div className="mt-2 flex flex-wrap gap-3">{d.phone && <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`} className="text-[#8fb8ee] underline">📞 {d.phone}</a>}<a href={d.mapsUrl} target="_blank" rel="noreferrer" className="text-[#8fb8ee] underline">Map ↗</a>{d.website && <a href={d.website} target="_blank" rel="noreferrer" className="text-[#8fb8ee] underline">Website ↗</a>}</div>
        </div>))}</div>
    case 'official_help':
      return <ul className="mt-2 space-y-1 text-[13.5px]">{(r as Link[]).map(l => <li key={l.link}><a href={l.link} target="_blank" rel="noreferrer" className="text-[#8fb8ee] underline">{l.title} ↗</a></li>)}</ul>
    case 'payoff_estimate':
      return <div className="num mt-2 text-2xl">{usd((r as { amount: number }).amount, true)}</div>
    case 'set_reminder': {
      const x = r as { date: string; title: string }
      return <button className="btn mt-3" onClick={() => downloadIcs(x.date, x.title, 'Reminder from Michi (TOYOTA NEXT).')}>📅 Add to my calendar</button>
    }
    default: return null
  }
}

export function NextSteps({ st, nav, onRecheck }: { st: NextState; nav: (v: string) => void; onRecheck: (vehicleValue?: number) => void }) {
  const c = st.customer!, rec = st.result?.recommendation
  const [tasks, setTasks] = useState<Task[]>([])
  const [brief, setBrief] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false), [running, setRunning] = useState(false), [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const autoRan = useRef<string | null>(null)

  const upsert = (t: Task) => setTasks(ts => { const i = ts.findIndex(x => x.id === t.id); if (i < 0) return [...ts, t].sort((a, b) => a.seq - b.seq); const n = [...ts]; n[i] = t; return n })
  const run = useCallback(async (force = false) => {
    setRunning(true); setErr(null); if (force) setTasks([])
    try {
      const res = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'run', customerId: c.id, force }) })
      if (!res.body) throw new Error('No response')
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = ''
      for (;;) {
        const { value, done } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true }); const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const l of lines) {
          if (!l.trim()) continue
          const ev = JSON.parse(l)
          if (ev.type === 'task') upsert(ev.task)
          else if (ev.type === 'done') { setTasks(ev.tasks); setBrief(ev.briefing) }
          else if (ev.type === 'error') setErr(ev.error)
        }
      }
      st.refreshAll()
    } catch (e) { setErr((e as Error).message) } finally { setRunning(false) }
  }, [c.id, st])

  useEffect(() => {
    if (!rec) return
    setLoaded(false)
    fetch(`/api/plan?customerId=${c.id}`).then(r => r.json()).then(d => { setTasks(d.tasks ?? []); setBrief(d.briefing); setLoaded(true) })
  }, [c.id, rec?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // first visit for this recommendation: Michi starts working on its own
    if (loaded && rec && !tasks.length && !running && autoRan.current !== rec.id) { autoRan.current = rec.id; run() }
  }, [loaded, rec, tasks.length, running, run])

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: c.id, ...body }) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error)
      setTasks(d.tasks); setBrief(d.briefing); st.refreshAll()
      if (d.rerun) { const v = d.tasks.find((t: Task) => t.id === body.taskId)?.result?.value; onRecheck(v) }
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  if (!rec) return <Empty>Michi needs a suggestion first. Open Overview.</Empty>
  const done = tasks.filter(t => ['done', 'skipped'].includes(t.status)).length, total = tasks.length || 1
  const you = tasks.filter(t => t.status === 'needs_you').length

  return (
    <div className="space-y-5">
      <section className="panel relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(235,10,30,.14),transparent)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3"><MichiMark size={40} /><div><h2 className="font-display text-2xl">Michi’s action plan</h2><p className="text-[14px] text-mute">For: {rec.recommendedAction}</p></div></div>
          <button className="btn" disabled={running} onClick={() => run(true)}>{running ? 'Michi is working…' : '↻ Start over'}</button>
        </div>
        <div className="relative mt-5">
          <div className="flex justify-between text-[13px]"><span>{running ? 'Michi is working through your steps…' : `${done} of ${tasks.length} steps done`}</span>{you > 0 && <span className="text-warn">{you} need{you === 1 ? 's' : ''} your OK</span>}</div>
          <div className="mt-2 h-2.5 rounded-full bg-line"><div className="h-2.5 rounded-full bg-red transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} /></div>
          {brief && !running && <p className="mt-3 text-[15px] leading-relaxed">{brief}</p>}
          <p className="mt-2 text-[12px] text-mute">Michi uses live tools (NHTSA recalls, web listings, Google Maps, official Toyota pages) and always asks before doing anything on your behalf.</p>
        </div>
      </section>
      {err && <div className="rounded-lg border border-[#5a1f26] p-3 text-[14px] text-red">{err}</div>}

      <ol className="space-y-3">
        {tasks.map(t => (
          <li key={t.id} className={`panel rise p-5 ${t.status === 'needs_you' ? 'border-[#5a4520]' : ''} ${t.status === 'skipped' ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-4">
              <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-elev text-xl ${t.status === 'running' ? 'pulse-dot' : ''}`}>{ICON[t.kind]}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-[17px]">{t.title}</h3><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>{t.addedBy === 'adapted' && <Badge tone="blue">Added by Michi</Badge>}</div>
                <p className="mt-0.5 text-[14px] text-mute">{t.why}</p>
                {t.summary && t.status !== 'pending' && <p className="mt-2 text-[15px]">{t.summary}</p>}
                <Result t={t} tasks={tasks} busy={busy} nav={nav} onApprove={(x, ch) => act({ action: 'approve', taskId: x.id, ...ch })} onDismiss={x => act({ action: 'dismiss', taskId: x.id })} />
                {t.status === 'failed' && <button className="btn mt-3" disabled={running} onClick={() => run()}>Try again</button>}
                <div className="mt-2 font-mono text-[10px] text-mute/70">tool: {t.tool}</div>
              </div>
            </div>
          </li>
        ))}
        {!tasks.length && <Empty>{running ? 'Michi is making your plan…' : 'No steps yet.'}</Empty>}
      </ol>

      <Panel title="My tracked steps">
        {!st.actions.length ? <p className="text-[14px] text-mute">Requests and reminders you approve appear here.</p> : (
          <ul className="space-y-2">{st.actions.map(a => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0"><div className={`text-[15px] ${a.status === 'completed' ? 'line-through text-mute' : ''}`}>{a.title}</div><div className="text-[12px] text-mute">{a.details[0]}</div></div>
              <div className="flex gap-2">{a.status === 'open' ? <button className="btn" onClick={() => st.updateAction(a.id, 'completed')}>✓ Mark done</button> : <Badge tone={a.status === 'completed' ? 'good' : 'mute'}>{a.status}</Badge>}</div>
            </li>))}</ul>
        )}
      </Panel>
    </div>
  )
}
