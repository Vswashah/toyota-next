'use client'
import { useEffect, useState } from 'react'
import type { NextState } from './use-next'
import { plainSummary } from '@/lib/plain.ts'
import { usd } from './ui'

export const MICHI = { name: 'Michi', meaning: '道 · “the way”', tagline: 'Your road ahead, made clear.' }

/** Michi's mark: a road curving toward a red destination point. */
export function MichiMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <circle cx="16" cy="16" r="15" fill="#171C23" stroke="#272D36" />
      <path d="M8 26 C 10 18, 20 18, 21 9" fill="none" stroke="#F5F6F7" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12.5 26 C 14 20.5, 21.5 20, 23.5 12" fill="none" stroke="#9199A5" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.5 2.2" />
      <circle cx="22" cy="8.5" r="3" fill="#EB0A1E" />
    </svg>
  )
}

/** The recommendation in plain words: big text, one picture, the catch, and three clear buttons. */
export function MichiCard({ st, nav }: { st: NextState; nav: (v: string) => void }) {
  const c = st.customer!, r = st.result, rec = r?.recommendation
  const [speaking, setSpeaking] = useState(false)
  const [asked, setAsked] = useState(false)
  useEffect(() => () => { try { window.speechSynthesis?.cancel() } catch {} }, [])
  if (!rec) return <section className="panel p-8 text-lg text-mute"><span className="pulse-dot">●</span> Michi is looking at your situation…</section>

  const chosen = r!.scenarios.find(s => s.id === rec.scenarioId)
  const row = r!.comparison.find(x => x.scenarioId === rec.scenarioId)
  const target = r!.assumptions?.paymentTarget ?? c.monthlyBudget
  const s = plainSummary({
    type: chosen?.type ?? 'support', termMonths: (chosen?.inputSnapshot as { termMonths?: number } | undefined)?.termMonths ?? null,
    model: c.vehicle.model, replacement: c.replacement.label.split(' (')[0].replace(/^\d{4} /, ''),
    currentPayment: c.financing.monthlyPayment, newPayment: chosen?.computed ? chosen.monthlyPayment : null, lifetimeDelta: row?.lifetimeDelta ?? null, target,
  })
  const newPay = chosen?.computed ? chosen.monthlyPayment : null
  const max = Math.max(c.financing.monthlyPayment, newPay ?? 0, target) || 1
  const handoffOpen = asked || st.actions.some(a => a.actionType === 'human_handoff' && a.status === 'open')
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

  const speak = () => {
    const synth = window.speechSynthesis
    if (speaking) { synth.cancel(); setSpeaking(false); return }
    const u = new SpeechSynthesisUtterance(s.speech); u.rate = 0.92
    u.onend = u.onerror = () => setSpeaking(false)
    synth.cancel(); synth.speak(u); setSpeaking(true)
  }
  const talk = async () => {
    setAsked(true)
    try { await st.createAction({ actionType: 'human_handoff', title: 'Talk with a Toyota specialist', details: [s.speech, 'Requested by the customer from Michi’s suggestion.'] }) } catch { setAsked(false) }
  }
  const tone = { good: 'text-good', warn: 'text-warn' }

  return (
    <section className="panel rise relative overflow-hidden p-6 md:p-8" aria-live="polite">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[radial-gradient(closest-side,rgba(235,10,30,.16),transparent)]" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><MichiMark size={36} /><div><div className="font-display text-lg leading-none">Michi suggests</div><div className="mt-1 text-[12px] text-mute">{MICHI.tagline}</div></div></div>
        {canSpeak && <button className="btn" onClick={speak} aria-pressed={speaking}>{speaking ? '■ Stop' : '🔊 Read aloud'}</button>}
      </div>

      <h1 className="relative mt-6 font-display text-3xl font-medium leading-tight md:text-[40px]">{s.title}</h1>
      {s.aka && <p className="mt-1 text-[15px] text-mute">{s.aka}</p>}

      {newPay != null && (
        <div className="mt-7 space-y-4" role="img" aria-label={`Monthly payment now ${usd(c.financing.monthlyPayment)}, with Michi’s plan ${usd(newPay)}`}>
          {[{ label: 'Now', v: c.financing.monthlyPayment, color: '#5b6472' }, { label: 'With this plan', v: newPay, color: '#EB0A1E' }].map(b => (
            <div key={b.label} className="grid items-center gap-1.5 md:grid-cols-[150px_1fr] md:gap-4">
              <div className="text-[15px] text-mute">{b.label}</div>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1"><div className="h-9 rounded-lg transition-all duration-700" style={{ width: `${(b.v / max) * 100}%`, background: b.color }} /></div>
                <span className="num w-[7.5rem] shrink-0 whitespace-nowrap text-2xl">{usd(b.v)}<span className="text-base text-mute">/mo</span></span>
              </div>
            </div>
          ))}
        </div>
      )}

      <ul className="mt-7 space-y-3 text-lg md:text-xl">
        {s.monthly && <li className="flex gap-3"><span aria-hidden className="text-good">●</span><span>{s.monthly}</span></li>}
        {s.total && <li className={`flex gap-3 ${tone[s.totalTone!]}`}><span aria-hidden>{s.totalTone === 'warn' ? '▲' : '●'}</span><span>{s.total}</span></li>}
        <li className={`flex gap-3 ${s.fits ? 'text-good' : 'text-warn'}`}><span aria-hidden>{s.fits ? '✓' : '!'}</span><span>{s.fit}</span></li>
      </ul>

      <div className="mt-8 flex flex-wrap gap-3">
        <button className="btn btn-red px-6 py-3 text-base" onClick={() => nav('steps')}>Show me how</button>
        <button className="btn px-6 py-3 text-base" disabled={handoffOpen} onClick={talk}>{handoffOpen ? '✓ A specialist will contact you' : 'Talk to a person'}</button>
        <button className="btn px-6 py-3 text-base" onClick={() => nav('twin')}>See all options</button>
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer text-[13px] text-mute hover:text-ink">Why Michi chose this</summary>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink/90">{rec.explanation}</p>
        <ul className="mt-3 space-y-1.5 text-[14px]">
          {rec.reasons.map(x => <li key={x} className="flex gap-2"><span className="text-good">✓</span>{x}</li>)}
          {rec.qualifications.map(x => <li key={x} className="flex gap-2 text-mute"><span className="text-warn">!</span>{x}</li>)}
        </ul>
      </details>
    </section>
  )
}
