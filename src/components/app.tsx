'use client'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNext, type NextState } from './use-next'
import { AgentPanel } from './agent-panel'
import { Overview, MyVehicle, Signals } from './views'
import { NextSteps } from './next-steps'
import { Settings } from './settings'
import { Twin } from './twin'
import { History } from './history'
import { ImpactLab } from './impact'
import { Studio } from './studio'
import { Payments } from './payments'
import { MICHI, MichiMark } from './michi'
import { VehicleViz } from './vehicle'
import { Badge, Logo, usd } from './ui'

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'M3 12l9-8 9 8M5 10v10h14V10' },
  { id: 'vehicle', label: 'My Vehicle', icon: 'M3 16l2-6h14l2 6M5 16h14v3H5zM7 19v1M17 19v1' },
  { id: 'payments', label: 'Payments', icon: 'M3 7h18v10H3zM3 11h18M7 15h3' },
  { id: 'twin', label: 'NEXT Twin', icon: 'M4 18l5-6 4 4 7-9M4 6v12h16' },
  { id: 'signals', label: 'Signals', icon: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-3 0a3 3 0 106 0 3 3 0 10-6 0' },
  { id: 'steps', label: 'Next Steps', icon: 'M5 12l4 4L19 6' },
  { id: 'history', label: 'Decision History', icon: 'M12 7v5l3 2M12 3a9 9 0 110 18 9 9 0 010-18z' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z' },
  { id: 'impact', label: 'Impact Lab', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
  { id: 'studio', label: 'Agent Studio', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5' },
] as const
type View = typeof NAV[number]['id']

const Icon = ({ d }: { d: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>

function Welcome({ onInit, onDemo, ready }: { onInit: () => void; onDemo: () => void; ready: boolean }) {
  return (
    <main className="grid-bg relative flex min-h-full flex-col overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(235,10,30,.18),transparent)]" />
      <header className="relative flex items-center justify-between px-6 py-5 md:px-10"><Logo /><span className="flex items-center gap-4"><span className="label hidden sm:block">Prototype · synthetic data</span><a href="/admin" className="btn">TFS team console</a></span></header>
      <section className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 pb-10 text-center">
        <div className="label rise text-red">Personal mobility intelligence system</div>
        <h1 className="rise mt-4 max-w-4xl font-display text-4xl font-medium leading-[1.05] tracking-tight md:text-6xl" style={{ animationDelay: '80ms' }}>Your life moves forward.<br /><span className="text-mute">Your next move should too.</span></h1>
        <div className="rise mt-6 w-full max-w-3xl" style={{ animationDelay: '160ms' }}><VehicleViz intro name="Toyota crossover" /></div>
        <div className="rise mt-6 flex items-center gap-3 rounded-full border border-line bg-surface/80 py-1.5 pl-1.5 pr-4" style={{ animationDelay: '200ms' }}><MichiMark size={30} /><span className="text-[13px]"><b className="font-display">Meet Michi</b> <span className="text-mute">道 · “the way”. {MICHI.tagline}</span></span></div>
        <div className="rise mt-6 flex flex-col gap-3 sm:flex-row" style={{ animationDelay: '240ms' }}>
          <button className="btn btn-red glow-red px-6 py-3 font-display tracking-[.14em]" onClick={onInit} disabled={!ready}>INITIALIZE MY NEXT MOVE</button>
          <button className="btn px-6 py-3 font-display tracking-[.14em]" onClick={onDemo} disabled={!ready}>EXPLORE DEMO PROFILE</button>
        </div>
        <p className="rise mt-6 max-w-xl text-[13px] text-mute" style={{ animationDelay: '320ms' }}>See the possibilities. Find your next move. Michi, your guide in NEXT, investigates your situation, calculates alternatives with deterministic tools, challenges its own recommendation, and helps you act.</p>
      </section>
    </main>
  )
}

function ProfilePicker({ st, onPick, onClose }: { st: NextState; onPick: (id: string) => void; onClose?: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal aria-label="Select a customer profile" onClick={onClose}>
      <div className="panel rise w-full max-w-3xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between"><div><div className="label">Select a synthetic customer</div><h2 className="mt-1 font-display text-xl">Whose next move are we planning?</h2></div>{onClose && <button className="btn" onClick={onClose}>Close</button>}</div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {st.customers.map(c => (
            <button key={c.id} onClick={() => onPick(c.id)} className="panel-elev p-4 text-left transition hover:border-red">
              <div className="flex items-center justify-between"><span className="font-display text-lg">{c.displayName}</span><Badge tone={c.profileType === 'lease' ? 'blue' : 'mute'}>{c.profileType}</Badge></div>
              <div className="mt-0.5 text-[13px] text-mute">{c.persona}</div>
              <div className="num mt-3 text-[13px]">{c.vehicle.year} {c.vehicle.model} {c.vehicle.trim} · {usd(c.financing.monthlyPayment)}/mo</div>
              <div className="mt-2 text-[12px] italic text-mute">“{c.goalText}”</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

interface Cmd { id: string; label: string; hint: string; run: () => void }

function Palette({ cmds, onClose }: { cmds: Cmd[]; onClose: () => void }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0)
  const list = cmds.filter(c => (c.label + ' ' + c.hint).toLowerCase().includes(q.toLowerCase()))
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => { setI(0) }, [q])
  const go = (c?: Cmd) => { if (c) { onClose(); c.run() } }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[14vh] backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal aria-label="Command palette">
      <div className="panel rise w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command…" aria-label="Command"
          onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(x + 1, list.length - 1)) } else if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(x - 1, 0)) } else if (e.key === 'Enter') go(list[i]); else if (e.key === 'Escape') onClose() }}
          className="w-full border-b border-line bg-transparent px-5 py-4 text-[15px] placeholder:text-mute focus:outline-none" />
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
          {list.map((c, k) => (
            <li key={c.id} role="option" aria-selected={k === i}>
              <button onMouseEnter={() => setI(k)} onClick={() => go(c)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[14px] ${k === i ? 'bg-elev' : ''}`}>
                <span>{c.label}</span><span className="text-[11px] text-mute">{c.hint}</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-4 text-sm text-mute">No matching command.</li>}
        </ul>
      </div>
    </div>
  )
}

export default function App() {
  const st = useNext()
  const [view, setView] = useState<View>('overview')
  const [picker, setPicker] = useState(false)
  const [palette, setPalette] = useState(false)
  const [large, setLarge] = useState(false)
  useEffect(() => { try { setLarge(localStorage.getItem('next-large-text') === '1') } catch {} }, [])
  const toggleLarge = () => setLarge(v => { try { localStorage.setItem('next-large-text', v ? '0' : '1') } catch {} return !v })
  const [mac, setMac] = useState(true)

  const nav = useCallback((v: string, anchor?: string) => {
    setView(v as View)
    setTimeout(() => { anchor ? document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) : document.getElementById('center')?.scrollTo({ top: 0 }) }, 60)
  }, [])

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform))
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(p => !p) } }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [])

  // Deep link (e.g. returning from Stripe Checkout): ?customer=cust-maya&view=payments
  useEffect(() => {
    if (!st.customers.length || st.customer) return
    const q = new URLSearchParams(window.location.search), id = q.get('customer')
    if (!id || !st.customers.some(x => x.id === id)) return
    st.selectCustomer(id)
    const v = q.get('view'); if (v && NAV.some(n => n.id === v)) setView(v as View)
  }, [st.customers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => { setPicker(false); setView('overview'); st.selectCustomer(id) }

  const cmds = useMemo<Cmd[]>(() => !st.customer ? st.customers.map(c => ({ id: c.id, label: `Switch to ${c.displayName}`, hint: c.persona, run: () => pick(c.id) })) : [
    { id: 'compare', label: 'Compare ownership options', hint: 'NEXT Twin', run: () => nav('twin', 'compare') },
    { id: 'target', label: 'Change payment target', hint: 'NEXT Twin', run: () => nav('twin', 'target') },
    { id: 'stress', label: 'Run a stress test', hint: 'NEXT Twin', run: () => nav('twin', 'stress') },
    { id: 'assumptions', label: 'Inspect assumptions', hint: 'Decision brief', run: () => nav('vehicle', 'brief') },
    { id: 'explain', label: 'Explain the recommendation', hint: 'Ask Michi', run: () => st.ask('Why this recommendation?') },
    { id: 'history', label: 'View decision history', hint: 'What changed?', run: () => nav('history') },
    { id: 'steps', label: 'Open next steps', hint: 'Action plan', run: () => nav('steps') },
    { id: 'signals', label: 'Open signals', hint: 'Signals', run: () => nav('signals') },
    { id: 'rerun', label: 'Re-run the decision workflow', hint: 'Agents', run: () => st.customer && st.run(st.customer.id, { overrides: st.result?.assumptions ?? undefined, trigger: 'command' }) },
    { id: 'impact', label: 'Open Impact Lab', hint: 'Business view', run: () => nav('impact') },
    { id: 'studio', label: 'Build or run an agent', hint: 'Agent Studio', run: () => nav('studio') },
    { id: 'pay', label: 'Make a payment', hint: 'Payments', run: () => nav('payments') },
    { id: 'settings', label: 'Edit my car details', hint: 'Settings', run: () => nav('settings') },
    ...st.customers.map(c => ({ id: 'switch-' + c.id, label: `Switch customer profile: ${c.displayName}`, hint: c.persona, run: () => pick(c.id) })),
  ], [st, nav]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!st.customer) return <>
    <Welcome ready={st.customers.length > 0} onInit={() => setPicker(true)} onDemo={() => pick('cust-maya')} />
    {picker && <ProfilePicker st={st} onPick={pick} onClose={() => setPicker(false)} />}
    {palette && <Palette cmds={cmds} onClose={() => setPalette(false)} />}
    {st.error && <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-[#5a1f26] bg-surface px-4 py-2 text-sm text-red">{st.error}</div>}
  </>

  const c = st.customer
  // After the customer changes facts (settings, an approved value update), refresh them and have Michi re-check.
  const recheck = (patch: Record<string, number>, trigger: string) => {
    st.reloadCustomers()
    if (c) st.run(c.id, { overrides: st.result?.assumptions ? { ...st.result.assumptions, ...patch } : undefined, trigger })
  }
  const title = NAV.find(n => n.id === view)!.label
  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <aside className="flex shrink-0 flex-col gap-4 border-line bg-side p-4 lg:w-[232px] lg:border-r">
        <div className="flex items-center justify-between"><Logo small /><button className="text-[11px] text-mute lg:hidden" onClick={() => setPalette(true)}>⌘K</button></div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto lg:flex-col">
          {NAV.map(n => (<Fragment key={n.id}>
            {n.id === 'impact' && <div className="label mt-4 hidden px-3 pb-1 lg:block">For Toyota teams</div>}
            <button onClick={() => nav(n.id)} aria-current={view === n.id ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition ${view === n.id ? 'bg-elev text-ink shadow-[inset_2px_0_0_#EB0A1E]' : 'text-mute hover:bg-elev/60 hover:text-ink'}`}>
              <Icon d={n.icon} />{n.label}
              {n.id === 'signals' && (st.result?.signals.filter(s => s.urgency === 'act').length ?? 0) > 0 && <span className="ml-auto rounded-full bg-red px-1.5 text-[10px] text-white">{st.result!.signals.filter(s => s.urgency === 'act').length}</span>}
            </button>
          </Fragment>))}
        </nav>
        <div className="panel mt-auto hidden p-3 lg:block">
          <div className="label">Customer</div>
          <div className="mt-1 font-display">{c.displayName}</div>
          <div className="text-[12px] text-mute">{c.persona}</div>
          <div className="num mt-2 text-[12px]">{c.vehicle.year} {c.vehicle.model} · {c.financing.financingType}</div>
          <div className="mt-3 flex flex-col gap-1.5">
            <button className="btn justify-center" onClick={() => setPicker(true)}>Switch profile</button>
            <button className="text-[11px] text-mute underline decoration-dotted hover:text-ink" onClick={() => { if (confirm('Clear this profile’s stored workflows, history and actions?')) st.resetDemo() }}>Reset demo data</button>
          </div>
        </div>
      </aside>

      <main id="center" className="grid-bg min-w-0 flex-1 lg:overflow-y-auto">
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur">
          <div className="min-w-0"><div className="label">{c.displayName} · {c.vehicle.year} {c.vehicle.model}</div><h1 className="truncate font-display text-lg">{title}</h1></div>
          <div className="flex items-center gap-2">
            {st.running && <span className="hidden text-[12px] text-red sm:inline"><span className="pulse-dot">●</span> updating your plan</span>}
            <button className="btn lg:hidden" onClick={() => setPicker(true)}>Switch</button>
            <button className="btn" onClick={toggleLarge} aria-pressed={large} title="Make text larger">{large ? 'A−' : 'A+'}<span className="hidden sm:inline">{large ? 'Normal text' : 'Larger text'}</span></button>
            <button className="btn" onClick={() => setPalette(true)} aria-label="Open command palette"><span className="hidden text-mute sm:inline">Commands</span><kbd className="whitespace-nowrap rounded border border-line px-1.5 font-mono text-[10px] text-mute">{mac ? '⌘' : 'Ctrl'} K</kbd></button>
          </div>
        </div>
        {st.error && <div className="mx-5 mt-4 flex items-center justify-between rounded-lg border border-[#5a1f26] bg-[#eb0a1e10] px-4 py-2 text-sm"><span className="text-red">{st.error}</span><button className="text-mute" onClick={() => st.setError(null)}>Dismiss</button></div>}
        <div key={view} className="rise p-5" style={large ? { zoom: 1.18 } : undefined}>
          {view === 'overview' && <Overview st={st} nav={nav} />}
          {view === 'vehicle' && <MyVehicle st={st} nav={nav} />}
          {view === 'twin' && <Twin st={st} />}
          {view === 'signals' && <Signals st={st} nav={nav} />}
          {view === 'steps' && <NextSteps st={st} nav={nav} onRecheck={v => recheck(v != null ? { vehicleValue: v } : {}, 'action-plan')} />}
          {view === 'settings' && <Settings st={st} onSaved={p => recheck({ ...(p.vehicleValue != null ? { vehicleValue: p.vehicleValue } : {}), ...(p.monthlyBudget != null ? { monthlyBudget: p.monthlyBudget, paymentTarget: Math.min(st.result?.assumptions?.paymentTarget ?? p.monthlyBudget, p.monthlyBudget) } : {}) }, 'settings')} />}
          {view === 'history' && <History st={st} />}
          {view === 'impact' && <ImpactLab />}
          {view === 'studio' && <Studio st={st} />}
          {view === 'payments' && <Payments st={st} onDone={() => { st.reloadCustomers(); st.run(c.id, { overrides: st.result?.assumptions ?? undefined, trigger: 'payment' }) }} />}
        </div>
        <footer className="px-5 pb-6 text-[11px] text-mute">Hackathon prototype on synthetic data. Not affiliated with live Toyota Financial Services systems. No offers, approvals or eligibility; payments are simulated on synthetic accounts. All figures come from deterministic calculations.</footer>
      </main>

      {view !== 'studio' && <div className="shrink-0 border-line bg-side lg:w-[360px] lg:border-l"><AgentPanel st={st} onNavigate={nav} /></div>}

      {picker && <ProfilePicker st={st} onPick={pick} onClose={() => setPicker(false)} />}
      {palette && <Palette cmds={cmds} onClose={() => setPalette(false)} />}
    </div>
  )
}
