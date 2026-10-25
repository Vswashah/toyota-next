'use client'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { NextState } from './use-next'
import type { Assumptions } from '@/lib/scenarios.ts'
import type { MarketLookup } from '@/lib/market.ts'
import { Badge, Empty, Kind, Panel, seriesColor, usd } from './ui'
import { GOAL_OPTIONS } from './labels'
import { Info, OptionBars } from './charts'

type Metric = 'cumulativePaid' | 'balance' | 'equity' | 'value'
const METRICS: { id: Metric; label: string }[] = [
  { id: 'cumulativePaid', label: 'Cumulative payments' }, { id: 'balance', label: 'Remaining balance' },
  { id: 'equity', label: 'Estimated equity' }, { id: 'value', label: 'Estimated vehicle value' },
]

export const STRESS: { id: string; label: string; apply: (a: Assumptions) => Partial<Assumptions> }[] = [
  { id: 'budget', label: 'Budget drops $100', apply: a => ({ monthlyBudget: Math.max(0, a.monthlyBudget - 100), paymentTarget: Math.max(0, a.paymentTarget - 100) }) },
  { id: 'value', label: 'Vehicle value −10%', apply: a => ({ vehicleValue: Math.round(a.vehicleValue * 0.9) }) },
  { id: 'keep5', label: 'Keep it five years', apply: () => ({ horizonMonths: 60, keepVehicle: true }) },
  { id: 'replace12', label: 'Replace within 12 months', apply: () => ({ goal: 'replace_vehicle', horizonMonths: 12 }) },
  { id: 'mincost', label: 'Minimize total cost', apply: () => ({ goal: 'minimize_cost' }) },
  { id: 'down', label: 'Larger down payment (+$3,000)', apply: a => ({ downPayment: a.downPayment + 3000 }) },
]

function Slider({ label, value, min, max, step, onChange, fmt, kind }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string; kind: string }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between text-[12.5px]"><span className="flex items-center gap-1.5 text-mute">{label}<Kind kind={kind} /></span><span className="num text-ink">{fmt(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  )
}

function Unknowable({ label, value, onChange, max }: { label: string; value: number | null; onChange: (v: number | null) => void; max: number }) {
  return (
    <div className="text-[12.5px]">
      <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-mute">{label}<Kind kind={value == null ? 'missing' : 'illustrative'} /></span>
        <button className="text-[11px] text-mute underline decoration-dotted hover:text-ink" onClick={() => onChange(value == null ? 0 : null)}>{value == null ? 'I know this' : 'Mark unknown'}</button></div>
      {value == null ? <div className="mt-1 text-[11px] text-mute">Not supplied: modeled as $0 and flagged.</div>
        : <div className="flex items-center gap-2"><input type="range" min={0} max={max} step={50} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} /><span className="num w-16 text-right">{usd(value)}</span></div>}
    </div>
  )
}

function MarketCheck({ customerId, onUse }: { customerId: string; onUse: (v: number) => void }) {
  const [m, setM] = useState<MarketLookup | { error: string } | 'loading' | null>(null)
  useEffect(() => setM(null), [customerId])
  const run = () => { setM('loading'); fetch(`/api/market-value?customerId=${encodeURIComponent(customerId)}`).then(r => r.json()).then(setM, e => setM({ error: String(e) })) }
  if (!m) return <button className="text-[11px] text-mute underline decoration-dotted hover:text-ink" onClick={run}>Check live market listings</button>
  if (m === 'loading') return <div className="text-[11px] text-mute">Searching listings…</div>
  if ('error' in m) return <div className="text-[11px] text-warn">Market lookup unavailable: {m.error}</div>
  return (
    <div className="space-y-1 rounded-lg border border-line p-2 text-[11px] text-mute">
      {m.median == null ? <div>Only {m.count} usable price{m.count === 1 ? '' : 's'} found; not enough for an estimate.</div> : <>
        <div className="flex items-center justify-between"><span>Listings median <span className="num text-ink">{usd(m.median)}</span> ({m.count} prices, {usd(m.low)}–{usd(m.high)})</span>
          <button className="text-ink underline decoration-dotted" onClick={() => onUse(m.median!)}>Use</button></div>
        <div>Asking prices from web search{m.via === 'gemini' ? ', filtered by Gemini' : ''}. Not an appraisal or trade-in offer.</div>
      </>}
      {m.sources.map(s => <a key={s.link} href={s.link} target="_blank" rel="noopener noreferrer" className="block truncate hover:text-ink">{usd(s.price)} · {s.title}</a>)}
    </div>
  )
}

export function Twin({ st, focus }: { st: NextState; focus?: string }) {
  const r = st.result, c = st.customer
  const [draft, setDraft] = useState<Assumptions | null>(r?.assumptions ?? null)
  const [metric, setMetric] = useState<Metric>('cumulativePaid')
  const [cmp, setCmp] = useState<'payment' | 'total'>('payment')
  const [table, setTable] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [stress, setStress] = useState<{ id: string; label: string; base: Assumptions; before: NonNullable<typeof r> } | null>(null)
  const [stressDiff, setStressDiff] = useState<NextState['whatChanged']>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (!pending.current && r?.assumptions) setDraft(r.assumptions) }, [r?.executionId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Stress drivers always compare against the pre-stress recommendation, not the previous preset.
  const beforeId = stress?.before.recommendation?.id, afterId = r?.recommendation?.id
  useEffect(() => {
    if (!beforeId || !afterId || beforeId === afterId || st.running) { setStressDiff(null); return }
    st.compare(beforeId, afterId).then(d => setStressDiff(d.whatChanged)).catch(() => setStressDiff(null))
  }, [beforeId, afterId, st.running]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [focus])

  const set = (patch: Partial<Assumptions>) => {
    if (!draft || !c) return
    const next = { ...draft, ...patch }
    setDraft(next)
    if (pending.current) clearTimeout(pending.current)
    pending.current = setTimeout(() => { pending.current = null; st.run(c.id, { overrides: next, trigger: `twin:${Object.keys(patch).join(',')}`, pace: 25 }) }, 450)
  }

  const series = useMemo(() => (r?.scenarios ?? []).filter(s => s.computed && !s.sensitivityOf), [r])
  const data = useMemo(() => {
    const h = r?.assumptions?.horizonMonths ?? 36
    return Array.from({ length: h + 1 }, (_, m) => Object.fromEntries([['month', m], ...series.map(s => [s.key, s.timeline[m]?.[metric] ?? null])]))
  }, [series, metric, r])

  if (!c) return null
  if (!r?.assumptions || !draft) return <Empty>Run the workflow to build your NEXT Twin.</Empty>
  const isLease = c.financing.financingType === 'lease'
  const rec = r.recommendation
  const payoffMonth = !isLease && c.financing.remainingMonths != null && c.financing.remainingMonths <= draft.horizonMonths ? c.financing.remainingMonths : null
  const wc = st.whatChanged

  const runStress = (p: typeof STRESS[number]) => {
    const base = stress?.base ?? r.assumptions!
    setStress({ id: p.id, label: p.label, base, before: stress?.before ?? r })
    st.run(c.id, { overrides: { ...base, ...p.apply(base) }, trigger: `stress:${p.id}` })
  }
  const resetStress = () => { if (stress) { st.run(c.id, { overrides: stress.base, trigger: 'stress:reset' }); setStress(null) } }

  return (
    <div className="grid gap-5 2xl:grid-cols-[340px_1fr]">
      <Panel title="Your situation · adjustable" className="h-fit 2xl:sticky 2xl:top-0" id="assumptions" right={st.running ? <span className="text-xs text-red pulse-dot">recalculating</span> : <span className="text-xs text-good">in sync</span>}>
        <div className="space-y-4">
          <label className="block text-[12.5px]"><span className="text-mute">Goal</span>
            <select value={draft.goal} onChange={e => set({ goal: e.target.value as Assumptions['goal'] })} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 text-[13px]">
              {GOAL_OPTIONS.filter(g => isLease || g.id !== 'lease_end').map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select></label>
          <div>
            <div className="mb-1 text-[12.5px] text-mute">Evaluation horizon</div>
            <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Evaluation horizon">
              {([12, 24, 36, 48] as const).map(h => <button key={h} role="radio" aria-checked={draft.horizonMonths === h} onClick={() => set({ horizonMonths: h })} className={`num rounded-md border py-1.5 text-[12px] ${draft.horizonMonths === h ? 'border-red bg-[#eb0a1e18] text-ink' : 'border-line text-mute hover:text-ink'}`}>{h} mo</button>)}
            </div>
            {draft.horizonMonths === 60 && <div className="mt-1 text-[11px] text-warn">60-month horizon set by stress test</div>}
          </div>
          <div id="target" className="space-y-4">
            <Slider label="Payment target" kind="supplied" value={draft.paymentTarget} min={150} max={1200} step={10} fmt={v => usd(v)} onChange={v => set({ paymentTarget: v })} />
            <Slider label="Monthly budget (hard limit)" kind="supplied" value={draft.monthlyBudget} min={150} max={1500} step={10} fmt={v => usd(v)} onChange={v => set({ monthlyBudget: v })} />
          </div>
          <Slider label="Estimated vehicle value" kind={draft.vehicleValue === c.vehicle.estimatedMarketValue ? 'synthetic' : 'illustrative'} value={draft.vehicleValue} min={Math.round(c.vehicle.estimatedMarketValue * 0.6)} max={Math.round(c.vehicle.estimatedMarketValue * 1.3)} step={100} fmt={v => usd(v)} onChange={v => set({ vehicleValue: v })} />
          <MarketCheck customerId={c.id} onUse={v => set({ vehicleValue: Math.min(Math.max(v, Math.round(c.vehicle.estimatedMarketValue * 0.6)), Math.round(c.vehicle.estimatedMarketValue * 1.3)) })} />
          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] text-mute hover:text-ink">More assumptions · rates, replacement, fees</summary>
            <div className="mt-3 space-y-4">
          <Slider label="Annual depreciation" kind="illustrative" value={draft.depreciationRatePct} min={0} max={30} step={1} fmt={v => `${v}%`} onChange={v => set({ depreciationRatePct: v })} />
          {!isLease && <>
            <div className="label pt-2">Refinancing (illustrative)</div>
            <Slider label="Refinance APR" kind="illustrative" value={draft.refiAprPct} min={0} max={20} step={0.1} fmt={v => `${v.toFixed(1)}%`} onChange={v => set({ refiAprPct: Math.round(v * 10) / 10 })} />
            <Slider label="Preferred refinance term" kind="illustrative" value={draft.refiTermMonths} min={24} max={84} step={12} fmt={v => `${v} mo`} onChange={v => set({ refiTermMonths: v })} />
            <Unknowable label="Refinance fees" value={draft.refiFees} max={2000} onChange={v => set({ refiFees: v })} />
          </>}
          <div className="label pt-2">{isLease ? 'After lease end / replacement' : 'Trade-in & replacement'}</div>
          <Slider label="Replacement vehicle price" kind="illustrative" value={draft.replacementPrice} min={15000} max={80000} step={500} fmt={v => usd(v)} onChange={v => set({ replacementPrice: v })} />
          <Slider label="Replacement APR" kind="illustrative" value={draft.replacementAprPct} min={0} max={20} step={0.1} fmt={v => `${v.toFixed(1)}%`} onChange={v => set({ replacementAprPct: Math.round(v * 10) / 10 })} />
          <Slider label="Replacement term" kind="illustrative" value={draft.replacementTermMonths} min={24} max={84} step={12} fmt={v => `${v} mo`} onChange={v => set({ replacementTermMonths: v })} />
          <Slider label="Down payment" kind="supplied" value={draft.downPayment} min={0} max={20000} step={250} fmt={v => usd(v)} onChange={v => set({ downPayment: v })} />
          <Unknowable label="Trade-in transaction costs" value={draft.tradeCosts} max={3000} onChange={v => set({ tradeCosts: v })} />
            </div>
          </details>
          <label className="flex items-center justify-between text-[12.5px]"><span className="text-mute">I’d prefer to keep my {c.vehicle.model}</span><input type="checkbox" checked={draft.keepVehicle} onChange={e => set({ keepVehicle: e.target.checked })} className="h-4 w-4 accent-[#EB0A1E]" /></label>
          <button className="btn w-full justify-center" onClick={() => { setStress(null); set(c.defaults) }}>Reset to my profile</button>
        </div>
      </Panel>

      <div className="space-y-5 min-w-0">
        {rec && (
          <section className="panel flex flex-wrap items-center justify-between gap-3 p-4">
            <div><div className="label">Current next move</div><div className="mt-1 font-display text-lg">{rec.recommendedAction}</div><div className="num text-sm text-mute">{rec.headline}</div></div>
            {wc && <div className="max-w-md text-[12.5px]">
              <div className="label mb-1">What changed?</div>
              {wc.inputChanges.length ? <div>{wc.inputChanges.map(i => `${i.label}: ${i.from} → ${i.to}`).join(' · ')}</div> : <div className="text-mute">No inputs changed since the previous run.</div>}
              <div className={wc.recommendationChanged ? 'text-red' : 'text-mute'}>{wc.attributionSummary}</div>
            </div>}
          </section>
        )}

        <Panel title="Compare ownership options" id="compare" right={
          <div className="flex gap-1" role="tablist">{([['payment', 'Monthly payment'], ['total', 'Total you pay']] as const).map(([id, l]) => <button key={id} role="tab" aria-selected={cmp === id} onClick={() => setCmp(id)} className={`rounded-md px-2 py-1 text-[11.5px] ${cmp === id ? 'bg-elev text-ink' : 'text-mute hover:text-ink'}`}>{l}</button>)}</div>}>
          <OptionBars target={cmp === 'payment' ? draft.paymentTarget : null} rows={r.comparison.filter(x => (cmp === 'payment' ? x.monthlyPayment : x.lifetimeCost) != null).map(x => ({ key: r.scenarios.find(s => s.id === x.scenarioId)!.key, label: x.label, value: (cmp === 'payment' ? x.monthlyPayment : x.lifetimeCost)!, chosen: x.scenarioId === rec?.scenarioId }))} />
          <details className="mt-3"><summary className="cursor-pointer text-[12px] text-mute hover:text-ink">Show detailed table</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead className="text-left text-mute"><tr className="[&>th]:pb-2 [&>th]:font-normal"><th>Scenario</th><th className="text-right">Payment</th><th className="text-right">Δ vs baseline</th><th className="text-right">Net over {draft.horizonMonths} mo</th><th className="text-right">Total remaining</th><th className="text-right">Equity at end</th><th className="pl-3">Status</th><th /></tr></thead>
              <tbody>
                {r.comparison.map(row => {
                  const s = r.scenarios.find(x => x.id === row.scenarioId)!, rk = r.ranking.find(x => x.scenarioId === row.scenarioId)
                  const sens = r.scenarios.find(x => x.sensitivityOf === row.scenarioId)
                  return (
                    <Fragment key={row.scenarioId}>
                      <tr className={`border-t border-line num ${rec?.scenarioId === row.scenarioId ? 'bg-[#eb0a1e0c]' : ''}`}>
                        <td className="py-2.5 font-sans"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: s.computed ? seriesColor(s.key) : '#3a414c' }} />{row.label}{rec?.scenarioId === row.scenarioId && <span className="ml-2 text-red">★</span>}</td>
                        <td className="text-right">{usd(row.monthlyPayment)}</td>
                        <td className={`text-right ${row.paymentDelta && row.paymentDelta < 0 ? 'text-good' : ''}`}>{row.paymentDelta == null ? '—' : row.paymentDelta === 0 ? 'baseline' : (row.paymentDelta > 0 ? '+' : '−') + usd(Math.abs(row.paymentDelta)).replace('−', '')}</td>
                        <td className="text-right">{usd(row.netCostOverHorizon)}</td>
                        <td className="text-right">{usd(row.lifetimeCost)}</td>
                        <td className={`text-right ${s.equityAtHorizon != null && s.equityAtHorizon < 0 ? 'text-red' : ''}`}>{usd(s.equityAtHorizon)}</td>
                        <td className="pl-3 font-sans">{!s.computed ? <Badge tone="mute">Specialist</Badge> : rk?.eligible ? <Badge tone="good">Eligible</Badge> : <span className="text-[11px] text-mute">{rk?.violations[0]}</span>}</td>
                        <td className="text-right font-sans"><button className="text-[11px] text-mute underline decoration-dotted hover:text-ink" onClick={() => setOpen(o => o === s.id ? null : s.id)} aria-expanded={open === s.id}>{open === s.id ? 'Hide' : 'Inspect'}</button></td>
                      </tr>
                      {open === s.id && (
                        <tr><td colSpan={8} className="pb-4">
                          <div className="grid gap-4 rounded-lg bg-bg p-3 md:grid-cols-3">
                            <div><div className="label mb-1.5">Inputs & assumptions</div><ul className="space-y-1">{s.assumptions.map(a => <li key={a.label} className="flex items-center justify-between gap-2"><span className="text-mute">{a.label}</span><span className="flex items-center gap-1.5">{a.value}<Kind kind={a.kind} /></span></li>)}</ul></div>
                            <div><div className="label mb-1.5">Missing information</div>{s.missing.length ? <ul className="space-y-1">{s.missing.map(m => <li key={m}><Kind kind="missing" /> {m}</li>)}</ul> : <span className="text-mute">None</span>}
                              <div className="label mb-1.5 mt-3">Limitations</div><ul className="space-y-1 text-mute">{s.limitations.map(m => <li key={m}>{m}</li>)}</ul></div>
                            <div><div className="label mb-1.5">Calculated</div><ul className="num space-y-1"><li>Amount financed {usd(s.amountFinanced)}</li><li>Balance at month {s.horizonMonths}: {usd(s.balanceAtHorizon)}</li><li>APR {s.aprUsed ?? '—'}% <Kind kind={s.aprKind ?? 'missing'} /></li><li>Payments over horizon {usd(s.paymentsOverHorizon)}</li><li>Upfront cash {usd(s.upfrontCash)}</li></ul>
                              {sens && <div className="mt-3 rounded-md border border-[#5a4520] p-2 text-[12px]"><span className="text-warn">Challenger sensitivity:</span> at {sens.aprUsed}% → {usd(sens.monthlyPayment)}/mo</div>}
                              <div className="mt-2 font-mono text-[10px] text-mute">{s.id}</div></div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-mute">Net over horizon = everything paid + debt still owed − estimated car value at the end. Rates are illustrative, never offers.</p>
          </details>
        </Panel>

        <Panel title={`Financial timeline · ${draft.horizonMonths} months`} id="timeline" right={
          <div className="flex flex-wrap items-center gap-1">
            {METRICS.map(m => <button key={m.id} onClick={() => setMetric(m.id)} className={`rounded-md px-2 py-1 text-[11.5px] ${metric === m.id ? 'bg-elev text-ink' : 'text-mute hover:text-ink'}`}>{m.label}</button>)}
            <button onClick={() => setTable(t => !t)} className="ml-1 rounded-md border border-line px-2 py-1 text-[11.5px] text-mute hover:text-ink">{table ? 'Chart' : 'Table'}</button>
          </div>}>
          {table ? (
            <div className="max-h-80 overflow-auto"><table className="w-full text-right text-[12px]"><thead className="sticky top-0 bg-surface text-mute"><tr><th className="py-1 text-left">Month</th>{series.map(s => <th key={s.key} className="py-1">{s.label}</th>)}</tr></thead>
              <tbody className="num">{data.filter(d => (d.month as number) % 6 === 0 || d.month === draft.horizonMonths).map(d => <tr key={d.month as number} className="border-t border-line/50"><td className="py-1 text-left">{d.month as number}</td>{series.map(s => <td key={s.key}>{usd(d[s.key] as number | null)}</td>)}</tr>)}</tbody></table></div>
          ) : (
            <div className="h-80" role="img" aria-label={`${METRICS.find(m => m.id === metric)!.label} by scenario over ${draft.horizonMonths} months`}>
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="#272D36" strokeDasharray="0" vertical={false} />
                  <XAxis dataKey="month" stroke="#9199A5" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#272D36' }} label={{ value: 'month', position: 'insideBottomRight', offset: -2, fill: '#9199A5', fontSize: 10 }} />
                  <YAxis stroke="#9199A5" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={v => usd(v)} />
                  <Tooltip contentStyle={{ background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }} labelStyle={{ color: '#9199A5' }} labelFormatter={m => `Month ${m}`} formatter={(v, n) => [usd(v as number), series.find(s => s.key === n)?.label ?? n]} cursor={{ stroke: '#9199A5', strokeDasharray: '3 3' }} />
                  <Legend formatter={k => <span style={{ color: '#F5F6F7', fontSize: 12 }}>{series.find(s => s.key === k)?.label}{rec?.scenarioKey === k ? ' ★' : ''}</span>} />
                  {metric === 'equity' && <ReferenceLine y={0} stroke="#9199A5" strokeDasharray="4 4" />}
                  {payoffMonth != null && <ReferenceLine x={payoffMonth} stroke="#76D6A0" strokeDasharray="4 4" label={{ value: 'current loan paid off', fill: '#76D6A0', fontSize: 10, position: 'insideTopLeft' }} />}
                  {isLease && c.lease && <ReferenceLine x={c.lease.monthsLeft} stroke="#EB0A1E" strokeDasharray="4 4" label={{ value: 'lease end', fill: '#EB0A1E', fontSize: 10, position: 'insideTopLeft' }} />}
                  {series.map(s => <Line key={s.key} dataKey={s.key} type="monotone" stroke={seriesColor(s.key)} strokeWidth={rec?.scenarioKey === s.key ? 3 : 2} dot={false} activeDot={{ r: 5, stroke: '#11151B', strokeWidth: 2 }} connectNulls isAnimationActive={!st.running} animationDuration={500} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[11px] text-mute">★ = your next move. Car values use an illustrative {draft.depreciationRatePct}%/yr depreciation, not a forecast.</p>
        </Panel>

        <Panel title="NEXT stress test" id="stress" right={stress && <button className="btn" onClick={resetStress} disabled={st.running}>Reset scenario</button>}>
          <p className="mb-3 text-[13px] text-mute">What if life changes? Pick one; Michi re-checks everything.</p>
          <div className="flex flex-wrap gap-2">{STRESS.map(p => <button key={p.id} className={`btn ${stress?.id === p.id ? 'border-red' : ''}`} disabled={st.running} onClick={() => runStress(p)}>{p.label}</button>)}</div>
          {stress && r.recommendation && stress.before.recommendation && (
            <div className="rise mt-4 grid gap-4 md:grid-cols-2">
              {[['Before', stress.before], [`After: ${stress.label}`, r]].map(([lbl, x]) => {
                const res = x as typeof r
                return (
                  <div key={lbl as string} className="panel-elev p-4">
                    <div className="label">{lbl as string}</div>
                    <div className="mt-1 font-display">{res.recommendation!.recommendedAction}</div>
                    <div className="num text-sm text-mute">{res.recommendation!.headline}</div>
                    <div className="mt-2"><OptionBars height={Math.max(110, res.comparison.filter(c2 => c2.monthlyPayment != null).length * 34 + 20)} target={res.assumptions?.paymentTarget} rows={res.comparison.filter(c2 => c2.monthlyPayment != null).map(c2 => ({ key: res.scenarios.find(x => x.id === c2.scenarioId)!.key, label: c2.label, value: c2.monthlyPayment!, chosen: c2.scenarioId === res.recommendation?.scenarioId }))} /></div>
                  </div>
                )
              })}
              {stressDiff && <div className="md:col-span-2 text-[12.5px]"><span className="label mr-2">What drove it</span>{stressDiff.inputChanges.map(i => `${i.label}: ${i.from} → ${i.to}`).join(' · ') || 'none'} · <span className={stressDiff.recommendationChanged ? 'text-red' : 'text-mute'}>{stressDiff.recommendationChanged ? 'next move changed' : 'next move unchanged'}</span>{stressDiff.attribution.some(a => a.established) && <Info text={stressDiff.attributionSummary} />}</div>}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
