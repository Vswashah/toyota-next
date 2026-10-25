'use client'
import type { ReactNode } from 'react'
import type { StepStatus } from '@/lib/engine.ts'

export { usd } from '@/lib/finance.ts'

export const SERIES: Record<string, string> = {
  keep: '#3987e5', 'refinance:60': '#d95926', 'refinance:72': '#199e70', 'refinance:84': '#c98500', trade_in: '#d55181',
  lease_return: '#3987e5', lease_buyout: '#d95926',
}
export const seriesColor = (key: string) => SERIES[key] ?? (key.startsWith('refinance') ? '#c98500' : '#9199A5')

const KIND: Record<string, string> = {
  supplied: 'text-ink border-line', synthetic: 'text-[#8fb8ee] border-[#2a3f5c]', illustrative: 'text-warn border-[#5a4520]',
  derived: 'text-[#6fd0ae] border-[#1f4a3c]', missing: 'text-[#ff6b77] border-[#5a1f26]', 'customer-adjusted': 'text-[#8fb8ee] border-[#2a3f5c]',
  'synthetic estimate': 'text-[#8fb8ee] border-[#2a3f5c]',
}
export function Kind({ kind }: { kind: string }) {
  return <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] uppercase tracking-wider ${KIND[kind] ?? 'text-mute border-line'}`}>{kind}</span>
}

const STATUS: Record<StepStatus, { c: string; t: string }> = {
  pending: { c: 'bg-[#3a414c]', t: 'Pending' }, running: { c: 'bg-red pulse-dot', t: 'Running' }, completed: { c: 'bg-good', t: 'Completed' },
  needs_attention: { c: 'bg-warn', t: 'Needs attention' }, failed: { c: 'bg-red', t: 'Failed' },
}
export function Status({ s, label = false }: { s: StepStatus; label?: boolean }) {
  const v = STATUS[s] ?? STATUS.pending
  return <span className="relative inline-flex items-center gap-1.5"><span aria-hidden className={`h-1.5 w-1.5 rounded-full ${v.c}`} />{label ? <span className="text-[11px] text-mute">{v.t}</span> : <span className="sr-only">{v.t}</span>}</span>
}

export function Stat({ label, value, sub, kind, big = false }: { label: string; value: ReactNode; sub?: ReactNode; kind?: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label flex items-center gap-2">{label}{kind && <Kind kind={kind} />}</div>
      <div className={`num mt-1 ${big ? 'text-3xl' : 'text-xl'} font-medium`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-mute">{sub}</div>}
    </div>
  )
}

export function Panel({ title, right, children, className = '', id }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`panel p-5 ${className}`}>
      {(title || right) && <header className="mb-4 flex items-center justify-between gap-3"><h2 className="label">{title}</h2>{right}</header>}
      {children}
    </section>
  )
}

export function Badge({ tone = 'mute', children }: { tone?: 'good' | 'warn' | 'red' | 'mute' | 'blue'; children: ReactNode }) {
  const t = { good: 'text-good border-[#2b4a3a] bg-[#76d6a00d]', warn: 'text-warn border-[#5a4520] bg-[#e8b04b0d]', red: 'text-[#ff6b77] border-[#5a1f26] bg-[#eb0a1e12]', mute: 'text-mute border-line', blue: 'text-[#8fb8ee] border-[#2a3f5c]' }[tone]
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${t}`}>{children}</span>
}

export const statusTone = (s: string) => (s === 'approved' ? 'good' : s === 'qualified' ? 'warn' : s === 'blocked' || s === 'revise' ? 'red' : 'mute') as 'good' | 'warn' | 'red' | 'mute'

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-mute">{children}</div>
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/toyota-logo.png" alt="Toyota" width={700} height={503} className={small ? 'h-9 w-auto' : 'h-11 w-auto'} />
      <span className="h-8 w-px bg-line" aria-hidden />
      <div className="leading-none">
        <div className={`font-display font-semibold tracking-[.2em] ${small ? 'text-[13px]' : 'text-[15px]'}`}>NEXT</div>
        <div className="mt-1 font-display text-[9px] tracking-[.28em] text-mute">INTELLIGENCE</div>
      </div>
    </div>
  )
}
