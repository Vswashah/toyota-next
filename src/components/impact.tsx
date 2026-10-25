'use client'
import { useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { computeImpact, ImpactConfig } from '@/lib/impact.ts'
import { Badge, Panel, usd } from './ui'
import { BigStat, Funnel, Info, SplitBar } from './charts'

type Impact = Awaited<ReturnType<typeof computeImpact>>
const DEFAULT: ImpactConfig = {
  cohortSize: 200, seed: 7,
  conventional: { findsRelevantOptionRate: 0.35, actionRate: 0.15, contactRate: 0.42 },
  next: { exploreRate: 0.65, selectActionRate: 0.5, completionRate: 0.7, residualContactRate: 0.12 },
  minutesPerContact: 11,
  retention: { baselineRate: 0.55, hypotheticalUpliftPts: 2, valuePerRetainedCustomer: 1800 },
}
const tip = { contentStyle: { background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }, labelStyle: { color: '#9199A5' }, cursor: { fill: '#ffffff08' } }
const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 0}%`

function Rate({ label, value, onChange, max = 1, step = 0.01, fmt = (v: number) => `${Math.round(v * 100)}%` }: { label: string; value: number; onChange: (v: number) => void; max?: number; step?: number; fmt?: (v: number) => string }) {
  return <label className="block text-[12px]"><span className="flex justify-between text-mute"><span>{label}</span><span className="num text-ink">{fmt(value)}</span></span><input type="range" min={0} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} /></label>
}

export function ImpactLab() {
  const [cfg, setCfg] = useState<ImpactConfig>(DEFAULT)
  const [data, setData] = useState<Impact | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const t = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (t.current) clearTimeout(t.current)
    t.current = setTimeout(() => {
      setLoading(true)
      fetch('/api/impact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) })
        .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); setErr(null) })
        .catch(e => setErr(e.message)).finally(() => setLoading(false))
    }, 300)
  }, [cfg])

  const upd = <K extends 'conventional' | 'next' | 'retention'>(k: K, patch: Partial<ImpactConfig[K]>) => setCfg(c => ({ ...c, [k]: { ...c[k], ...patch } }))
  if (!data) return <div className="text-sm text-mute">{err ?? <><span className="pulse-dot">●</span> Running NEXT on the synthetic cohort…</>}</div>
  const m = Object.fromEntries(data.metrics.map(x => [x.id, x])), n = data.cohortSize
  const conv = data.comparison.conventional, nx = data.comparison.next
  const minutesSaved = 1 - nx.minutes / Math.max(1, conv.minutes)
  const cmp = [
    { name: 'Found an option', Conventional: conv.foundOption, NEXT: nx.foundOption },
    { name: 'Took action', Conventional: conv.acted, NEXT: nx.acted },
    { name: 'Called support', Conventional: conv.contacts, NEXT: nx.contacts },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-mute">Michi run on <b className="text-ink">{n} synthetic customers</b>. <Badge tone="good">engine</Badge> = measured from the run · <Badge tone="warn">assumed</Badge> = your rates · <Badge tone="red">hypothetical</Badge> = illustration.</p>
        {loading && <span className="text-xs text-red pulse-dot">updating…</span>}
      </div>
      {err && <div className="rounded-lg border border-[#5a1f26] p-3 text-sm text-red">{err}</div>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <BigStat label="Got a clear next move" value={pct(m.evaluated.value, n)} caption={`${m.evaluated.value} of ${n} customers · engine`} tone="good" info={m.evaluated.formula} />
        <BigStat label="Solved it themselves" value={pct(m.self.value, n)} caption={`${m.human.value} needed a specialist · engine`} info={m.self.formula} />
        <BigStat label="Fewer support minutes" value={`${Math.round(minutesSaved * 100)}%`} caption={`${nx.minutes.toLocaleString()} vs ${conv.minutes.toLocaleString()} min · assumed`} tone={minutesSaved > 0 ? 'good' : 'warn'} info={`${data.comparison.formulas.next}. Conventional: ${data.comparison.formulas.conventional}`} />
        <BigStat label="Retention value" value={usd(data.hypothetical.value)} caption="hypothetical · not observed" tone="warn" info={data.hypothetical.formula} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title={<span className="flex items-center">The Michi journey<Info text="First two steps measured by the engine; the rest apply your assumed rates." /></span>}>
          <Funnel steps={[
            { label: 'Got a recommendation', value: m.evaluated.value },
            { label: 'Had an option that fits', value: m.options.value },
            { label: 'Explored scenarios', value: m.explored.value },
            { label: 'Chose a next step', value: m.selected.value },
            { label: 'Completed it', value: m.completed.value },
          ]} />
        </Panel>
        <Panel title="Today’s experience vs NEXT">
          <div className="h-60" role="img" aria-label="Grouped bars: conventional experience versus NEXT">
            <ResponsiveContainer>
              <BarChart data={cmp} margin={{ top: 4, right: 8, left: 0, bottom: 4 }} barGap={2}>
                <CartesianGrid stroke="#272D36" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9199A5' }} tickLine={false} axisLine={{ stroke: '#272D36' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9199A5' }} tickLine={false} axisLine={false} width={32} />
                <Tooltip {...tip} />
                <Legend formatter={v => <span style={{ color: '#F5F6F7', fontSize: 12 }}>{v}</span>} />
                <Bar dataKey="Conventional" fill="#3987e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="NEXT" fill="#199e70" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Who needs a person?">
          <SplitBar parts={[{ label: 'self-service', value: m.self.value, color: '#199e70' }, { label: 'specialist', value: m.human.value, color: '#c98500' }]} />
          <div className="mt-5 label">The Challenger at work</div>
          <SplitBar parts={[{ label: 'first pick revised', value: m.revised.value, color: '#d55181' }, { label: 'first pick held', value: n - m.revised.value, color: '#3987e5' }]} />
        </Panel>
        <Panel title="What Michi recommended">
          <div className="h-56" role="img" aria-label="Recommendation mix">
            <ResponsiveContainer>
              <BarChart data={data.distributions.recommendation} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: '#F5F6F7' }} tickLine={false} axisLine={false} />
                <Tooltip {...tip} />
                <Bar dataKey="value" name="Customers" fill="#3987e5" radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#F5F6F7', fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <Panel title="Prove it with a real experiment">
        <div className="grid gap-4 md:grid-cols-3">
          <div><div className="label">Test</div><div className="mt-1 text-[14px]">50/50 split: today’s experience vs NEXT</div></div>
          <div><div className="label">Measure</div><div className="mt-1 text-[14px]">{data.experiment.primaryMetric}</div></div>
          <div><div className="label">Customers needed</div><div className="num mt-1 text-2xl">{data.experiment.samplePerArm?.toLocaleString() ?? 'n/a'} <span className="text-sm text-mute">per group</span><Info text={`Detect ${Math.round(data.experiment.baselineRate * 100)}% → ${Math.round(data.experiment.expectedRate * 100)}% at α 0.05, power 0.8. ${data.experiment.sampleFormula}`} /></div></div>
        </div>
      </Panel>

      <details className="panel p-5">
        <summary className="label cursor-pointer hover:text-ink">Adjust assumptions</summary>
        <div className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
          <Rate label="Cohort size" value={cfg.cohortSize} max={400} step={20} fmt={v => String(v)} onChange={v => setCfg(c => ({ ...c, cohortSize: Math.max(20, v) }))} />
          <Rate label="Today: finds an option" value={cfg.conventional.findsRelevantOptionRate} onChange={v => upd('conventional', { findsRelevantOptionRate: v })} />
          <Rate label="Today: takes action" value={cfg.conventional.actionRate} onChange={v => upd('conventional', { actionRate: v })} />
          <Rate label="Today: calls support" value={cfg.conventional.contactRate} onChange={v => upd('conventional', { contactRate: v })} />
          <Rate label="NEXT: explores scenarios" value={cfg.next.exploreRate} onChange={v => upd('next', { exploreRate: v })} />
          <Rate label="NEXT: chooses a step" value={cfg.next.selectActionRate} onChange={v => upd('next', { selectActionRate: v })} />
          <Rate label="NEXT: completes it" value={cfg.next.completionRate} onChange={v => upd('next', { completionRate: v })} />
          <Rate label="NEXT: still calls support" value={cfg.next.residualContactRate} onChange={v => upd('next', { residualContactRate: v })} />
          <Rate label="Minutes per support call" value={cfg.minutesPerContact} max={40} step={1} fmt={v => `${v} min`} onChange={v => setCfg(c => ({ ...c, minutesPerContact: Math.max(1, v) }))} />
          <Rate label="Assumed retention uplift" value={cfg.retention.hypotheticalUpliftPts} max={10} step={0.5} fmt={v => `${v} pts`} onChange={v => upd('retention', { hypotheticalUpliftPts: v })} />
          <Rate label="Value per retained customer" value={cfg.retention.valuePerRetainedCustomer} max={6000} step={100} fmt={v => usd(v)} onChange={v => upd('retention', { valuePerRetainedCustomer: v })} />
        </div>
        <button className="btn mt-4" onClick={() => setCfg(DEFAULT)}>Reset assumptions</button>
      </details>
    </div>
  )
}
