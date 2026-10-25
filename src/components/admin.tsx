'use client'
import { useCallback, useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { adminOverview, cohortPipeline } from '@/lib/admin.ts'
import { Badge, Logo, Panel, Status, statusTone, usd } from './ui'
import type { StepStatus } from '@/lib/engine.ts'
import { BigStat, Funnel, Info } from './charts'

type Data = ReturnType<typeof adminOverview> & { cohort: Awaited<ReturnType<typeof cohortPipeline>>; gated: boolean }
type Cust = Data['customers'][number]

const OPP_TONE: Record<string, 'good' | 'blue' | 'warn' | 'red' | 'mute'> = {
  new_vehicle_financing: 'good', lease_buyout_financing: 'good', account_restructure: 'blue', retained: 'mute', retention_risk: 'red', none: 'mute',
}
const STAGES = [['identified', 'Identified'], ['engaged', 'Engaged'], ['action_selected', 'Action selected'], ['completed', 'Completed']] as const
const stageRank = (s: string) => ['not_started', 'identified', 'engaged', 'action_selected', 'completed'].indexOf(s)
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

function Outreach({ c, pass, onDone }: { c: Cust; pass: string; onDone: () => void }) {
  const [kind, setKind] = useState<'follow_up' | 'specialist' | null>(null)
  const [msg, setMsg] = useState('')
  const [state, setState] = useState<string | null>(null)
  const open = (k: 'follow_up' | 'specialist') => {
    setKind(k); setState(null)
    setMsg(k === 'specialist'
      ? `Hi ${c.name.split(' ')[0]}, a Toyota Financial Services specialist will reach out to review options for your ${c.vehicle} that NEXT cannot evaluate on its own.`
      : `Hi ${c.name.split(' ')[0]}, we saw you explored "${c.recommendation?.action ?? 'your options'}". Want help getting actual terms and next steps?`)
  }
  const send = async () => {
    setState('sending')
    const r = await fetch('/api/admin', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-passcode': pass }, body: JSON.stringify({ customerId: c.customerId, kind, message: msg }) })
    const d = await r.json()
    if (!r.ok) { setState(d.error ?? 'Failed'); return }
    setState('sent'); setKind(null); onDone()
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button className="btn !px-2.5 !py-1.5 text-[12px]" onClick={() => open('follow_up')} disabled={!c.recommendation}>Follow up</button>
        <button className="btn !px-2.5 !py-1.5 text-[12px]" onClick={() => open('specialist')}>Assign specialist</button>
      </div>
      {state === 'sent' && <div className="mt-1 text-[11px] text-good">Added to the customer’s Next Steps</div>}
      {kind && (
        <div className="mt-2 space-y-2">
          <textarea rows={3} maxLength={500} value={msg} onChange={e => setMsg(e.target.value)} aria-label="Message to customer" className="w-full rounded-lg border border-line bg-bg p-2 text-[12px] focus:border-red focus:outline-none" />
          <div className="flex gap-1.5"><button className="btn btn-red !px-2.5 !py-1.5 text-[12px]" disabled={!msg.trim() || state === 'sending'} onClick={send}>{state === 'sending' ? 'Sending…' : kind === 'specialist' ? 'Assign' : 'Send follow-up'}</button><button className="btn !px-2.5 !py-1.5 text-[12px]" onClick={() => setKind(null)}>Cancel</button></div>
          {state && state !== 'sending' && <div className="text-[11px] text-red">{state}</div>}
        </div>
      )}
    </div>
  )
}

export default function AdminConsole() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [margin, setMargin] = useState(2)
  const [pass, setPass] = useState('')
  const [needPass, setNeedPass] = useState(false)
  const [updated, setUpdated] = useState<Date | null>(null)

  useEffect(() => { try { setPass(sessionStorage.getItem('next-admin-pass') ?? '') } catch {} }, [])
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin?margin=${margin}`, { headers: { 'x-admin-passcode': pass }, cache: 'no-store' })
      if (r.status === 401) { setNeedPass(true); return }
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? `Failed (${r.status})`)
      setData(d); setErr(null); setNeedPass(false); setUpdated(new Date())
    } catch (e) { setErr((e as Error).message) }
  }, [margin, pass])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])

  if (needPass) return (
    <main className="grid-bg flex min-h-full items-center justify-center p-4">
      <form className="panel w-full max-w-sm space-y-3 p-6" onSubmit={e => { e.preventDefault(); try { sessionStorage.setItem('next-admin-pass', pass) } catch {} load() }}>
        <Logo /><div className="label pt-2">TFS team console</div>
        <input type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder="Admin passcode" aria-label="Admin passcode" className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm focus:border-red focus:outline-none" />
        <button className="btn btn-red w-full justify-center">Enter</button>
      </form>
    </main>
  )

  const k = data?.kpis
  const OPP_COLOR: Record<string, string> = { new_vehicle_financing: '#199e70', lease_buyout_financing: '#3987e5', account_restructure: '#c98500', retention_risk: '#d55181', retained: '#5b6472', none: '#5b6472' }
  const byOpp = data ? Object.values(data.customers.reduce<Record<string, { name: string; key: string; value: number }>>((acc, c) => {
    if (c.opportunity.volume > 0) (acc[c.opportunity.type] ??= { name: c.opportunity.label, key: c.opportunity.type, value: 0 }).value += c.opportunity.volume
    return acc
  }, {})).sort((a, b) => b.value - a.value) : []
  const cohortVolume = data ? data.cohort.mix.filter(m => m.type !== 'retention_risk').reduce((s, m) => s + m.volume, 0) : 0
  const cohortIncome = data ? data.cohort.mix.reduce((s, m) => s + m.income, 0) : 0

  return (
    <main className="grid-bg min-h-full">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg/90 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-4"><Logo small /><span className="hidden h-6 w-px bg-line sm:block" /><div><div className="label text-red">Toyota Financial Services</div><div className="font-display text-[15px]">TFS Team Console</div></div></div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-mute"><span className="h-1.5 w-1.5 rounded-full bg-good pulse-dot" />live · {updated ? updated.toLocaleTimeString() : '…'}</span>
          <a className="btn" href="/">Open customer app</a>
        </div>
      </header>

      <div className="space-y-5 p-5">
        {err && <div className="rounded-lg border border-[#5a1f26] p-3 text-sm text-red">{err}</div>}
        {!data ? <div className="text-sm text-mute"><span className="pulse-dot">●</span> Loading pipeline…</div> : <>

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BigStat label="Financing pipeline" value={usd(k!.pipelineVolume)} caption={`${k!.vehicleLeads} vehicle sale lead · ~${usd(k!.estIncome)} income (hypothetical)`} tone="good" info={data.formulas.volume + ' ' + data.formulas.income} />
            <BigStat label="Solved on their own" value={k!.evaluated ? `${Math.round((k!.selfService / k!.evaluated) * 100)}%` : '—'} caption={`${k!.selfService} self-service · ${k!.specialist} need a specialist`} />
            <BigStat label="Balance at risk" value={usd(k!.balanceAtRisk)} caption="Flagged early for specialist outreach" tone={k!.balanceAtRisk ? 'red' : 'ink'} />
            <BigStat label="Payments collected" value={usd(k!.paymentsTotal)} caption={`${k!.paymentsCount} payment(s) · ${k!.autopayEnrolled} on autopay · simulated`} />
          </section>

          <section className="flex flex-wrap gap-2 text-[12.5px]" aria-label="Challenge goals">
            {[
              ['Personalize', `${k!.evaluated}/${k!.customers} customers profiled`],
              ['Simplify', `${Math.round(data.trust.qualifiedShare * 100)}% show their trade-offs`],
              ['Guide', `${k!.actionSelected} chose a step · ${k!.completed} completed`],
              ['Value', `${usd(k!.pipelineVolume)} pipeline`],
            ].map(([t, v]) => <span key={t} className="rounded-full border border-line bg-surface px-3 py-1.5"><span className="mr-1.5 text-red">✓ {t}</span>{v}</span>)}
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Panel title="Pipeline by opportunity">
              {byOpp.length ? (
                <div style={{ height: byOpp.length * 52 + 20 }} role="img" aria-label="Financing volume by opportunity type">
                  <ResponsiveContainer>
                    <BarChart data={byOpp} layout="vertical" margin={{ top: 0, right: 72, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 12, fill: '#F5F6F7' }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }} cursor={{ fill: '#ffffff08' }} formatter={v => [usd(v as number), 'Volume']} />
                      <Bar dataKey="value" isAnimationActive={false} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#F5F6F7', fontSize: 12, formatter: (v: unknown) => usd(Number(v)) }}>
                        {byOpp.map(o => <Cell key={o.key} fill={OPP_COLOR[o.key]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="text-sm text-mute">No opportunities yet.</p>}
            </Panel>
            <Panel title="Customer journey">
              <Funnel steps={STAGES.map(([id, label]) => ({ label, value: data.customers.filter(c => stageRank(c.stage) >= stageRank(id)).length }))} />
            </Panel>
          </div>

          <Panel title="Customers" right={<label className="flex items-center gap-2 text-[12px] text-mute">Margin<Info text="Assumed annual net finance margin used for the hypothetical income estimate." /><input type="range" min={0} max={5} step={0.25} value={margin} onChange={e => setMargin(Number(e.target.value))} className="!w-24" aria-label="Assumed net margin" /><span className="num w-10 text-ink">{margin}%</span></label>}>
            <div className="grid gap-3 lg:grid-cols-2">
              {data.customers.map(c => (
                <article key={c.customerId} className="panel-elev p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full font-display text-[13px] text-white" style={{ background: OPP_COLOR[c.opportunity.type] }}>{c.name.split(' ').map(w => w[0]).join('')}</span>
                      <div><div className="font-display text-[15px]">{c.name}</div><div className="text-[11.5px] text-mute">{c.vehicle} · {c.financingType}</div></div>
                    </div>
                    <div className="text-right"><div className={`num text-xl ${c.opportunity.type === 'retention_risk' ? 'text-[#ff6b77]' : ''}`}>{usd(c.opportunity.volume)}</div><div className="text-[11px] text-mute">{c.opportunity.type === 'retention_risk' ? 'at risk' : 'financing'}</div></div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge tone={OPP_TONE[c.opportunity.type]}>{c.opportunity.label}</Badge><Info text={c.opportunity.meaning} />
                    <Badge tone={c.route === 'specialist' ? 'warn' : 'good'}>{c.route}</Badge>
                    {c.recommendation && <Badge tone={statusTone(c.recommendation.status)}>{c.recommendation.status}</Badge>}
                  </div>
                  <div className="mt-2 truncate text-[13px]" title={c.recommendation?.headline}>{c.recommendation?.action ?? 'Not evaluated yet'}</div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2" aria-label={`Stage: ${c.stage.replace('_', ' ')}`}>
                      <div className="flex gap-0.5">{STAGES.map(([id]) => <span key={id} className={`h-1.5 w-5 rounded-full ${stageRank(c.stage) >= stageRank(id) ? 'bg-red' : 'bg-line'}`} />)}</div>
                      <span className="text-[11px] capitalize text-mute">{c.stage.replace('_', ' ')} · {ago(c.lastActivity)}</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-line pt-3"><Outreach c={c} pass={pass} onDone={load} /></div>
                </article>
              ))}
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
            <Panel title={`At scale · ${data.cohort.size} synthetic customers`}>
              <div className="mb-3 flex flex-wrap gap-6">
                <div><div className="label">Pipeline</div><div className="num text-2xl text-good">{usd(cohortVolume)}</div></div>
                <div><div className="label flex items-center">Est. income<Info text={data.formulas.income} /></div><div className="num text-2xl">{usd(cohortIncome)}</div></div>
              </div>
              <div style={{ height: data.cohort.mix.length * 40 + 10 }} role="img" aria-label="Opportunity mix across the synthetic cohort">
                <ResponsiveContainer>
                  <BarChart data={data.cohort.mix} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={170} tick={{ fontSize: 12, fill: '#F5F6F7' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: '#171C23', border: '1px solid #272D36', borderRadius: 10, fontSize: 12 }} cursor={{ fill: '#ffffff08' }} />
                    <Bar dataKey="count" name="Customers" isAnimationActive={false} radius={[0, 4, 4, 0]} label={{ position: 'right', fill: '#F5F6F7', fontSize: 12 }}>
                      {data.cohort.mix.map(o => <Cell key={o.type} fill={OPP_COLOR[o.type]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <Panel title="Trust & guardrails">
              <div className="grid grid-cols-2 gap-4">
                <div><div className="label">Challenger revised</div><div className="num mt-1 text-2xl">{data.trust.workflows ? Math.round((data.trust.challengerRevised / data.trust.workflows) * 100) : 0}%</div><div className="text-[11px] text-mute">of first picks</div></div>
                <div><div className="label">Show trade-offs</div><div className="num mt-1 text-2xl">{Math.round(data.trust.qualifiedShare * 100)}%</div><div className="text-[11px] text-mute">of recommendations</div></div>
                <div><div className="label">Tool failures</div><div className={`num mt-1 text-2xl ${data.trust.toolFailures ? 'text-warn' : 'text-good'}`}>{data.trust.toolFailures}</div></div>
                <div><div className="label">AI fallbacks</div><div className="num mt-1 text-2xl">{data.trust.llmFallbacks}</div></div>
              </div>
              <p className="mt-4 text-[11px] text-mute">No offers or approvals are generated. All figures come from deterministic tools.</p>
            </Panel>
          </div>

          <Panel title="Live activity">
            <ol className="space-y-1.5">
              {data.activity.slice(0, 8).map(a => (
                <li key={a.id} className="flex items-center gap-3 text-[12.5px]">
                  <Status s={a.status as StepStatus} />
                  <span className="min-w-0 flex-1 truncate"><b>{a.customer}</b> <span className="text-mute">· {a.label}</span></span>
                  <span className="shrink-0 text-[11px] text-mute">{ago(a.at)}</span>
                </li>
              ))}
              {!data.activity.length && <li className="text-sm text-mute">No activity yet.</li>}
            </ol>
          </Panel>

          <details className="text-[12px] text-mute">
            <summary className="cursor-pointer hover:text-ink">How we calculate</summary>
            <ul className="mt-2 space-y-1"><li>{data.formulas.volume}</li><li>{data.formulas.income}</li><li>{data.formulas.stage}</li><li>Outreach creates a tracked step in the customer’s Next Steps; nothing is sent externally.</li></ul>
          </details>
        </>}
      </div>
    </main>
  )
}
