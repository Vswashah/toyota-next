'use client'
import { useState } from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { NextState } from './use-next'
import { Badge, Empty, Kind, Panel, Stat, seriesColor, statusTone, usd } from './ui'
import { VehicleViz, type Callout } from './vehicle'
import { goalLabelClient } from './labels'
import { Info, OptionBars, PaymentTrack } from './charts'
import { MichiCard } from './michi'

export type Nav = (view: string, anchor?: string) => void

function callouts(st: NextState): Callout[] {
  const c = st.customer, a = st.result?.assumptions
  if (!c || !a) return []
  const f = c.financing
  const payoff = f.financingType === 'lease' ? f.purchaseOptionPrice : f.currentBalance
  const eq = payoff == null ? null : a.vehicleValue - payoff
  return [
    { label: f.financingType === 'lease' ? 'Lease ends' : 'Balance', value: f.financingType === 'lease' ? `${c.lease?.monthsLeft} mo` : usd(f.currentBalance), tone: 'ink' },
    { label: 'Est. value', value: usd(a.vehicleValue), tone: 'ink' },
    { label: 'Est. equity', value: usd(eq), tone: eq != null && eq < 0 ? 'red' : 'good' },
  ]
}

/** Customer-facing trend: what you owe vs what the car is worth under the recommended move (engine timeline, no new math). */
function Trend({ st }: { st: NextState }) {
  const r = st.result, s = r?.scenarios.find(x => x.id === r.recommendation?.scenarioId)
  const pts = s?.timeline.filter(p => p.value != null) ?? []
  if (pts.length < 2) return null
  const end = pts.at(-1)!
  return (
    <section className="panel rise p-6">
      <div className="label mb-1">Your car over the next {end.month} months</div>
      <p className="text-[14px] text-mute">You’d owe <span className="num text-ink">{usd(end.balance)}</span> on a car worth about <span className="num text-ink">{usd(end.value)}</span>{end.equity != null && <>: <span className={end.equity >= 0 ? 'text-good' : 'text-red'}>{usd(Math.abs(end.equity))} {end.equity >= 0 ? 'of it is yours' : 'more than it is worth'}</span></>}.</p>
      <div className="mt-4 h-56" role="img" aria-label="Loan balance and estimated car value by month">
        <ResponsiveContainer>
          <LineChart data={pts} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <XAxis dataKey="month" stroke="#9199A5" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#272D36' }} tickFormatter={m => (m ? `${m} mo` : 'Today')} />
            <YAxis stroke="#9199A5" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={64} tickFormatter={v => usd(v)} />
            <Tooltip contentStyle={{ background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }} labelStyle={{ color: '#9199A5' }} labelFormatter={m => (m ? `Month ${m}` : 'Today')} formatter={(v, n) => [usd(v as number), n === 'balance' ? 'You owe' : 'Car worth']} />
            <Line dataKey="value" type="monotone" stroke="#76D6A0" strokeWidth={2.5} dot={false} />
            <Line dataKey="balance" type="monotone" stroke="#EB0A1E" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-2 flex gap-5 text-[12px] text-mute"><span><span className="mr-1.5 inline-block h-0.5 w-4 bg-[#76D6A0] align-middle" />Car worth (estimate)</span><span><span className="mr-1.5 inline-block h-0.5 w-4 bg-red align-middle" />You owe</span></div>
    </section>
  )
}

export function Overview({ st, nav }: { st: NextState; nav: Nav }) {
  const c = st.customer, r = st.result, rec = r?.recommendation
  if (!c) return null
  const f = c.financing
  const target = r?.assumptions?.paymentTarget ?? c.monthlyBudget
  const scen = (id: string) => r?.scenarios.find(s => s.id === id)
  const chosen = rec ? scen(rec.scenarioId) : undefined
  const row = r?.comparison.find(x => x.scenarioId === rec?.scenarioId)
  const priced = (r?.comparison ?? []).filter(x => x.monthlyPayment != null)
  const bars = (pick: (x: typeof priced[number]) => number | null) => priced.filter(x => pick(x) != null).map(x => ({
    key: scen(x.scenarioId)!.key, label: x.label, value: pick(x)!, chosen: x.scenarioId === rec?.scenarioId,
  }))
  const lowest = priced.length ? Math.min(...priced.map(x => x.monthlyPayment!)) : null
  const support = rec?.scenarioKey === 'support'
  const catchLine = rec?.tradeoffs[0] ?? rec?.qualifications[0]

  const chips: { label: string; value: string; tone: 'good' | 'warn' | 'red' | 'ink' }[] = !rec ? [] : support ? [
    { label: 'Lowest option found', value: lowest == null ? '—' : `${usd(lowest)}/mo`, tone: 'ink' },
    { label: 'Your target', value: `${usd(target)}/mo`, tone: 'ink' },
    { label: 'Best path', value: 'Talk to a specialist', tone: 'warn' },
  ] : [
    { label: 'Monthly payment', value: `${usd(f.monthlyPayment)} → ${usd(chosen?.monthlyPayment)}`, tone: (chosen?.monthlyPayment ?? 0) <= f.monthlyPayment ? 'good' : 'warn' },
    { label: 'Total you pay overall', value: row?.lifetimeDelta == null || row.lifetimeDelta === 0 ? 'No change' : `${row.lifetimeDelta > 0 ? '+' : '−'}${usd(Math.abs(row.lifetimeDelta))}`, tone: (row?.lifetimeDelta ?? 0) > 0 ? 'warn' : 'good' },
    { label: 'Fits your target', value: (chosen?.monthlyPayment ?? Infinity) <= target + 0.5 ? 'Yes ✓' : 'No', tone: (chosen?.monthlyPayment ?? Infinity) <= target + 0.5 ? 'good' : 'red' },
  ]
  const tone = { good: 'text-good', warn: 'text-warn', red: 'text-[#ff6b77]', ink: 'text-ink' }

  return (
    <div className="space-y-5">
      {st.whatChanged?.recommendationChanged && (
        <button onClick={() => nav('history')} className="rise flex w-full items-center justify-between rounded-xl border border-[#5a1f26] bg-[#eb0a1e0f] px-4 py-3 text-left text-sm">
          <span><span className="label mr-2 text-red">Next move changed</span>{st.whatChanged.previous.recommendedAction} → <b>{st.whatChanged.current.recommendedAction}</b></span>
          <span className="text-mute">Why →</span>
        </button>
      )}

      <MichiCard st={st} nav={nav} />

      <section className="panel relative overflow-hidden">
        <div className="grid-bg absolute inset-0 opacity-60" aria-hidden />
        <div className="relative grid items-center gap-4 p-5 xl:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="label">{c.vehicle.year} Toyota {c.vehicle.model} {c.vehicle.trim}</div>
            <VehicleViz callouts={callouts(st)} name={`${c.vehicle.year} ${c.vehicle.model}`} />
          </div>
          <div>
            <div className="label">Your monthly payment</div>
            <PaymentTrack current={f.monthlyPayment} target={target} next={support ? null : chosen?.monthlyPayment ?? null} />
            <div className="text-[13px] text-mute">Goal: <span className="text-ink">{r?.assumptions ? goalLabelClient(r.assumptions.goal) : '—'}</span></div>
          </div>
        </div>
      </section>


      {priced.length > 0 && (
        <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
          <Panel title="Monthly payment by option"><OptionBars rows={bars(x => x.monthlyPayment)} target={target} /></Panel>
          <Panel title={<span className="flex items-center">Total you’d pay from today<Info text="Every remaining payment until the loan is paid off, plus any money down. Lower is better." /></span>}><OptionBars rows={bars(x => x.lifetimeCost)} /></Panel>
        </div>
      )}

      <Trend st={st} />
    </div>
  )
}

export function MyVehicle({ st, nav }: { st: NextState; nav?: Nav }) {
  const c = st.customer, b = st.result?.brief
  if (!c) return null
  const f = c.financing, v = c.vehicle
  const row = (k: string, val: React.ReactNode, kind: string) => <div className="flex items-center justify-between border-b border-line/60 py-2 text-[13px] last:border-0"><span className="text-mute">{k}</span><span className="flex items-center gap-2"><span className="num">{val}</span><Kind kind={kind} /></span></div>
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Panel title="Vehicle">
        <VehicleViz name={v.model} />
        {row('Vehicle', `${v.year} Toyota ${v.model} ${v.trim}`, 'synthetic')}
        {row('Color', v.color, 'synthetic')}
        {row('Odometer', `${v.odometer.toLocaleString()} mi`, 'synthetic')}
        {row('Annual miles', `${v.annualMiles.toLocaleString()} mi`, 'synthetic')}
        {row('Estimated market value', usd(v.estimatedMarketValue), 'synthetic')}
        <p className="mt-2 text-xs text-mute">Valuation source: {v.valuationSource}, {v.valuationTimestamp}. Not a guaranteed price; future values in NEXT are illustrative depreciation assumptions.</p>
      </Panel>
      <Panel title={`Financing · ${f.financingType}`}>
        {row('Account', f.id, 'synthetic')}
        {row('Monthly payment', usd(f.monthlyPayment, true), 'supplied')}
        {f.financingType === 'loan' ? <>
          {row('Current balance', usd(f.currentBalance), 'supplied')}
          {row('Remaining term', `${f.remainingMonths} months`, 'supplied')}
          {row('Interest rate', c.apr ? `${c.apr.apr}%` : 'unknown', f.interestRate != null ? 'supplied' : c.apr ? 'derived' : 'missing')}
        </> : <>
          {row('Lease end', f.leaseEndDate, 'supplied')}
          {row('Mileage allowance', `${f.mileageAllowanceTotal?.toLocaleString()} mi`, 'supplied')}
          {row('Excess-mileage rate', f.excessMileageRate != null ? `$${f.excessMileageRate}/mi` : 'not on file', f.excessMileageRate != null ? 'supplied' : 'missing')}
          {row('Disposition fee', f.dispositionFee != null ? usd(f.dispositionFee) : 'not on file', f.dispositionFee != null ? 'supplied' : 'missing')}
          {row('Purchase option price', usd(f.purchaseOptionPrice), 'supplied')}
          {row('Projected miles at lease end', c.lease?.projectedMiles.toLocaleString(), 'derived')}
          {row('Projected mileage charge', c.lease?.mileageCharge != null ? usd(c.lease.mileageCharge) : 'unknown', c.lease?.mileageCharge != null ? 'derived' : 'missing')}
        </>}
        <p className="mt-3 text-xs text-mute">All accounts are synthetic demo data. This app has no access to real Toyota Financial Services systems.</p>
      </Panel>
      <Panel title="What Michi knows" className="xl:col-span-2" id="brief" right={nav && <button className="btn" onClick={() => nav('settings')}>✎ Edit my car details</button>}>
        {!b ? <Empty>Michi is still reading your account.</Empty> : (<>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {b.known.map(k => {
              const src = ({ supplied: ['✓', 'From your account', 'text-good'], 'synthetic estimate': ['≈', 'Our estimate', 'text-[#8fb8ee]'], 'your estimate': ['✎', 'From you', 'text-warn'], 'customer-adjusted': ['✎', 'You adjusted this', 'text-warn'] } as Record<string, string[]>)[k.provenance] ?? ['•', k.provenance, 'text-mute']
              return <div key={k.field} className="panel-elev p-4"><div className="text-[13px] text-mute">{k.field}</div><div className="num mt-1 text-2xl">{k.value}</div><div className={`mt-1 text-[12px] ${src[2]}`}>{src[0]} {src[1]}</div></div>
            })}
          </div>
          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div><div className="label mb-1.5">What you want</div><p className="text-[17px]">{goalLabelClient(b.goal)}</p></div>
            <div><div className="label mb-1.5">Rules Michi follows</div><ul className="space-y-1 text-[15px]"><li>✓ {b.hardConstraints[0].replace('Payment ≤ monthly budget', 'Stay at or under your')} a month</li><li>✓ Never makes up offers, rates or approvals</li></ul></div>
          </div>
          {b.missing.length > 0
            ? <p className="mt-5 rounded-lg border border-[#5a4520] bg-[#e8b04b0d] p-3 text-[15px] text-warn">Not on file: {b.missing.join(', ')}. Michi worked around it and says so in its suggestion.</p>
            : <p className="mt-5 text-[15px] text-good">✓ Michi has everything it needs.</p>}
          <details className="mt-4"><summary className="cursor-pointer text-[13px] text-mute hover:text-ink">Show details</summary>
            <div className="mt-3 grid gap-5 text-[13px] md:grid-cols-2">
              <div><div className="label mb-1">The question Michi answered</div><p>{b.decisionProblem}</p><div className="label mb-1 mt-3">Preferences</div><ul className="space-y-0.5 text-mute">{b.preferences.map(x => <li key={x}>· {x}</li>)}</ul></div>
              {st.result?.recommendation && <div><div className="label mb-1">Assumptions behind the suggestion</div><ul className="space-y-0.5 text-mute">{st.result.recommendation.assumptions.map(x => <li key={x}>· {x}</li>)}</ul></div>}
            </div>
          </details>
        </>)}
      </Panel>
    </div>
  )
}

export function Signals({ st, nav }: { st: NextState; nav: Nav }) {
  const sig = st.result?.signals ?? []
  const tone = { act: 'red', watch: 'warn', info: 'blue' } as const
  const target = (id: string) => id === 'human-support' || id === 'no-scenario-meets-target' ? 'steps' : id === 'missing-info' ? 'twin' : id.includes('equity') || id.includes('lease') || id.includes('mileage') ? 'twin' : 'twin'
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-mute">Signals come from transparent rules over your (synthetic) profile and the latest calculated scenarios. They are not account notifications and do not imply eligibility for any product.</p>
      {!sig.length && <Empty>No signals for the current scenario.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {sig.map((s, i) => (
          <article key={s.id} className="panel rise p-5" style={{ animationDelay: `${i * 60}ms` }}>
            <div className="flex items-start justify-between gap-3"><h3 className="font-display text-lg">{s.title}</h3><Badge tone={tone[s.urgency]}>{s.urgency}</Badge></div>
            <p className="mt-2 text-[14px]">{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted hover:text-red">{s.description}</a> : s.description}</p>
            {Object.keys(s.data).length > 0 && <dl className="mt-3 flex flex-wrap gap-4">{Object.entries(s.data).map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="num">{v}</dd></div>)}</dl>}
            <div className="mt-3 text-[13px] text-mute"><b className="text-ink">Why it matters:</b> {s.whyItMatters}</div>
            <div className="mt-3 rounded-md bg-bg px-3 py-2 font-mono text-[11px] text-mute">evidence: {s.evidence}</div>
            {s.id === 'recall-news' ? <a className="btn mt-3" href="https://www.nhtsa.gov/recalls" target="_blank" rel="noopener noreferrer">{s.nextAction}</a> : <button className="btn mt-3" onClick={() => nav(target(s.id))}>{s.nextAction}</button>}
          </article>
        ))}
      </div>
    </div>
  )
}

const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '')
