'use client'
import { useEffect, useState } from 'react'
import type { NextState } from './use-next'
import type { WhatChanged } from '@/lib/history.ts'
import type { ScenarioResult } from '@/lib/scenarios.ts'
import { Badge, Empty, Panel, seriesColor, statusTone, usd } from './ui'
import { goalLabelClient } from './labels'
import type { GoalId } from '@/lib/data.ts'

function ScenarioList({ title, list, chosen }: { title: string; list: ScenarioResult[]; chosen: string }) {
  return (
    <div className="panel-elev p-4">
      <div className="label mb-2">{title}</div>
      <table className="w-full text-[12px]"><tbody className="num">
        {list.filter(s => !s.sensitivityOf).map(s => (
          <tr key={s.id} className={`border-t border-line/60 ${s.id === chosen ? 'text-ink' : 'text-mute'}`}>
            <td className="py-1.5 font-sans"><span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: s.computed ? seriesColor(s.key) : '#3a414c' }} />{s.label}{s.id === chosen && <span className="ml-1 text-red">★</span>}</td>
            <td className="text-right">{usd(s.monthlyPayment)}/mo</td><td className="text-right">{usd(s.netCostOverHorizon)}</td><td className="text-right">{s.horizonMonths} mo</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  )
}

export function History({ st }: { st: NextState }) {
  const h = st.history
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [diff, setDiff] = useState<{ whatChanged: WhatChanged; scenarios: { from: ScenarioResult[]; to: ScenarioResult[] } } | null>(null)
  const [loading, setLoading] = useState(false)
  const [showScen, setShowScen] = useState(false)

  useEffect(() => { if (h.length >= 2) { setTo(h[0].id); setFrom(h[1].id) } }, [h])
  useEffect(() => {
    if (!from || !to || from === to) { setDiff(null); return }
    setLoading(true)
    st.compare(from, to).then(setDiff).catch(() => setDiff(null)).finally(() => setLoading(false))
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!h.length) return <Empty>No recommendations recorded yet.</Empty>
  const w = diff?.whatChanged
  return (
    <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <Panel title="Recommendation versions" className="h-fit">
        <p className="mb-3 text-[12px] text-mute">Pick two versions to compare. ◀ = previous, ▶ = current.</p>
        <ol className="space-y-2">
          {h.map(r => (
            <li key={r.id} className={`panel-elev p-3 ${r.id === to ? 'border-red' : r.id === from ? 'border-[#3a424e]' : ''}`}>
              <div className="flex items-center justify-between"><span className="num text-sm">v{r.version}</span><Badge tone={statusTone(r.status)}>{r.status}</Badge></div>
              <div className="mt-1 text-[13px]">{r.recommendedAction}</div>
              <div className="mt-0.5 text-[11px] text-mute">{goalLabelClient(r.inputs.goal as GoalId)} · {new Date(r.createdAt).toLocaleTimeString()}</div>
              <div className="mt-2 flex gap-1.5">
                <button className={`rounded border px-2 py-0.5 text-[11px] ${r.id === from ? 'border-ink text-ink' : 'border-line text-mute'}`} onClick={() => setFrom(r.id)} aria-pressed={r.id === from}>◀ previous</button>
                <button className={`rounded border px-2 py-0.5 text-[11px] ${r.id === to ? 'border-red text-ink' : 'border-line text-mute'}`} onClick={() => setTo(r.id)} aria-pressed={r.id === to}>▶ current</button>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <div className="space-y-5 min-w-0">
        {h.length < 2 && <Empty>Change a goal or assumption in NEXT Twin to create a second version.</Empty>}
        {loading && <div className="text-sm text-mute"><span className="pulse-dot">●</span> Re-running counterfactuals…</div>}
        {w && !loading && <>
          <div className="grid gap-4 md:grid-cols-2">
            {[['Previous next move', w.previous], ['Current next move', w.current]].map(([t, s]) => {
              const snap = s as WhatChanged['previous']
              return (
                <section key={t as string} className={`panel p-5 ${t === 'Current next move' ? 'glow-red' : ''}`}>
                  <div className="flex items-center justify-between"><span className="label">{t as string} · v{snap.version}</span><Badge tone={statusTone(snap.status)}>{snap.status}</Badge></div>
                  <div className="mt-2 font-display text-lg leading-snug">{snap.recommendedAction}</div>
                  <div className="num text-sm text-mute">{snap.headline}</div>
                  <div className="mt-2 text-[12px] text-mute">Goal: {goalLabelClient(snap.goal as GoalId)}</div>
                  <ol className="mt-3 space-y-1 text-[12px]">{snap.ranking.map((x, i) => <li key={x.label} className={`flex justify-between ${x.eligible ? '' : 'text-mute'}`}><span>{i + 1}. {x.label}</span><span className="num">{x.eligible ? usd(x.score) : 'ineligible'}</span></li>)}</ol>
                </section>
              )
            })}
          </div>

          <Panel title="Why it changed">
            <div className={`mb-4 rounded-lg border p-3 text-[14px] ${w.recommendationChanged ? 'border-[#5a1f26] bg-[#eb0a1e0d]' : 'border-line'}`}>{w.attributionSummary}</div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="label mb-2">Inputs that changed</div>
                {w.inputChanges.length ? <table className="w-full text-[12.5px]"><tbody>{w.inputChanges.map(i => <tr key={i.key} className="border-t border-line/60"><td className="py-1.5 text-mute">{i.label}</td><td className="num text-right">{i.from}</td><td className="px-2 text-mute">→</td><td className="num">{i.to}</td></tr>)}</tbody></table> : <p className="text-[13px] text-mute">No recorded inputs changed.</p>}
                {w.attribution.length > 0 && <><div className="label mb-2 mt-4">Counterfactual tests</div>
                  <ul className="space-y-2 text-[12.5px]">{w.attribution.map(a => <li key={a.key}><Badge tone={a.established ? 'good' : 'mute'}>{a.established ? 'established' : 'not established'}</Badge> <b>{a.label}</b>: {a.result}<div className="text-[11px] text-mute">{a.test}</div></li>)}</ul></>}
              </div>
              <div>
                <div className="label mb-2">Calculations that changed</div>
                {w.calculationChanges.length ? <table className="w-full text-[12.5px]"><tbody className="num">{w.calculationChanges.slice(0, 14).map((c, i) => <tr key={i} className="border-t border-line/60"><td className="py-1.5 font-sans text-mute">{c.scenario} · {c.metric}</td><td className="text-right">{c.from}</td><td className="px-2 text-mute">→</td><td>{c.to}</td><td className={`text-right ${c.delta > 0 ? 'text-warn' : 'text-good'}`}>{c.delta > 0 ? '+' : '−'}{usd(Math.abs(c.delta))}</td></tr>)}</tbody></table> : <p className="text-[13px] text-mute">No calculated values changed.</p>}
                {w.rankingChanges.length > 0 && <><div className="label mb-2 mt-4">Ranking changes</div><ul className="text-[12.5px]">{w.rankingChanges.map(r => <li key={r.label}>{r.label}: #{r.from ?? '—'} → #{r.to ?? '—'}</li>)}</ul></>}
                {(w.qualifications.added.length > 0 || w.qualifications.removed.length > 0) && <><div className="label mb-2 mt-4">Validation findings</div><ul className="space-y-1 text-[12.5px]">{w.qualifications.added.map(q => <li key={q}><span className="text-warn">+</span> {q}</li>)}{w.qualifications.removed.map(q => <li key={q} className="text-mute line-through">{q}</li>)}</ul></>}
                {(w.missing.added.length > 0 || w.missing.removed.length > 0) && <><div className="label mb-2 mt-4">Missing information</div><ul className="space-y-1 text-[12.5px]">{w.missing.added.map(q => <li key={q}><span className="text-warn">+</span> {q}</li>)}{w.missing.removed.map(q => <li key={q} className="text-good">resolved: {q}</li>)}</ul></>}
              </div>
            </div>
            <button className="btn mt-5" onClick={() => setShowScen(s => !s)} aria-expanded={showScen}>{showScen ? 'Hide' : 'Open'} previous scenario vs current</button>
            {showScen && diff && <div className="rise mt-4 grid gap-4 md:grid-cols-2"><ScenarioList title={`Previous · v${w.previous.version}`} list={diff.scenarios.from} chosen={w.previous.scenarioId} /><ScenarioList title={`Current · v${w.current.version}`} list={diff.scenarios.to} chosen={w.current.scenarioId} /></div>}
          </Panel>
        </>}
      </div>
    </div>
  )
}
