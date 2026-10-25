'use client'
// Small shared visuals. Values always come from engine output; these only draw them.
import { Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { seriesColor, usd } from './ui'

/** ⓘ with the detail on hover/focus, so screens stay short without hiding how numbers are made. */
export function Info({ text }: { text: string }) {
  return <span tabIndex={0} title={text} aria-label={text} className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[9px] text-mute hover:text-ink focus:text-ink">i</span>
}

/** Payment track: today's payment, the next-move payment and the target on one scale, with a legend below. */
export function PaymentTrack({ current, target, next }: { current: number; target: number; next: number | null }) {
  const max = Math.max(current, target, next ?? 0) * 1.15 || 1
  const pos = (v: number) => `${(v / max) * 100}%`
  const marks = [{ v: current, label: 'Today', color: '#9199A5' }, ...(next != null ? [{ v: next, label: 'Next move', color: '#EB0A1E' }] : [])]
  return (
    <div className="py-4" role="img" aria-label={`Payment today ${usd(current)}, target ${usd(target)}${next != null ? `, next move ${usd(next)}` : ''}`}>
      <div className="relative h-2.5 rounded-full bg-line">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[#76d6a033]" style={{ width: pos(target) }} />
        <div className="absolute -bottom-1.5 -top-1.5 w-0.5 bg-good" style={{ left: pos(target) }} />
        {marks.map(m => <div key={m.label} className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg transition-all duration-500" style={{ left: pos(m.v), background: m.color }} />)}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        {marks.map(m => <span key={m.label}><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: m.color }} /><span className="text-mute">{m.label}</span> <span className="num text-ink">{usd(m.v)}</span></span>)}
        <span><span className="mr-1.5 inline-block h-3 w-0.5 bg-good align-middle" /><span className="text-mute">Target</span> <span className="num text-good">{usd(target)}</span></span>
      </div>
    </div>
  )
}

export interface OptionRow { key: string; label: string; value: number; chosen?: boolean; fits?: boolean }

/** One bar per option, colored by option (fixed per entity), with an optional target line. */
export function OptionBars({ rows, target, targetLabel = 'Target', format = (v: number) => usd(v), height }: { rows: OptionRow[]; target?: number | null; targetLabel?: string; format?: (v: number) => string; height?: number }) {
  const data = rows.map(r => ({ ...r, name: (r.chosen ? '★ ' : '') + r.label }))
  return (
    <div style={{ height: height ?? Math.max(120, rows.length * 46 + 20) }} role="img" aria-label={rows.map(r => `${r.label} ${format(r.value)}`).join(', ')}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 14, right: 64, left: 4, bottom: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, (max: number) => Math.max(max, target ?? 0) * 1.08]} />
          <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#F5F6F7' }} />
          <Tooltip cursor={{ fill: '#ffffff08' }} contentStyle={{ background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }} formatter={v => [format(v as number), '']} separator="" />
          {target != null && <ReferenceLine x={target} stroke="#76D6A0" strokeDasharray="4 4" label={{ value: `${targetLabel} ${format(target)}`, position: 'top', fill: '#76D6A0', fontSize: 11 }} />}
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive animationDuration={500}>
            {data.map(r => <Cell key={r.key} fill={seriesColor(r.key)} fillOpacity={r.chosen || rows.every(x => !x.chosen) ? 1 : 0.45} />)}
            <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: '#F5F6F7', fontSize: 12 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** 100% split bar with labeled parts (e.g. self-service vs specialist). */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div role="img" aria-label={parts.map(p => `${p.label} ${p.value}`).join(', ')}>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">{parts.map(p => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} className="transition-all duration-500" />)}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">{parts.map(p => <span key={p.label}><span className="mr-1.5 inline-block h-2 w-2 rounded-sm align-middle" style={{ background: p.color }} /><span className="num text-ink">{p.value}</span> <span className="text-mute">{p.label}</span></span>)}</div>
    </div>
  )
}

/** Descending funnel as bars with counts and % of the first step. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = steps[0]?.value || 1
  return (
    <ol className="space-y-2.5">
      {steps.map(s => (
        <li key={s.label}>
          <div className="flex justify-between text-[12.5px]"><span>{s.label}</span><span className="num">{s.value} <span className="text-mute">· {Math.round((s.value / top) * 100)}%</span></span></div>
          <div className="mt-1 h-2.5 rounded-full bg-line"><div className="h-2.5 rounded-full bg-red transition-all duration-500" style={{ width: `${(s.value / top) * 100}%` }} /></div>
        </li>
      ))}
    </ol>
  )
}

/** Big number with a one-line caption: the default tile for headline metrics. */
export function BigStat({ label, value, caption, tone = 'ink', info }: { label: string; value: string; caption?: string; tone?: 'ink' | 'good' | 'red' | 'warn'; info?: string }) {
  const c = { ink: 'text-ink', good: 'text-good', red: 'text-[#ff6b77]', warn: 'text-warn' }[tone]
  return (
    <div className="panel p-5">
      <div className="label flex items-center">{label}{info && <Info text={info} />}</div>
      <div className={`num mt-2 text-3xl font-medium ${c}`}>{value}</div>
      {caption && <div className="mt-1 text-[12px] text-mute">{caption}</div>}
    </div>
  )
}
