'use client'
import { useEffect, useState } from 'react'
import type { NextState } from './use-next'
import type { Vehicle } from '@/lib/data.ts'
import type { DecodedVin } from '@/lib/profile.ts'
import { Panel, usd } from './ui'

interface View { customer: { vehicle: Vehicle; zip: string | null; monthlyBudget: number; contactPreference: string | null }; original: { vehicle: Vehicle; zip: string | null; monthlyBudget: number }; settings: Record<string, unknown> }
type Form = Record<'vin' | 'year' | 'model' | 'trim' | 'color' | 'odometer' | 'annualMiles' | 'estimatedMarketValue' | 'zip' | 'monthlyBudget' | 'contactPreference', string>

const NUM = ['year', 'odometer', 'annualMiles', 'estimatedMarketValue', 'monthlyBudget'] as const
const input = 'mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px] focus:border-red focus:outline-none'

function toForm(v: View): Form {
  const c = v.customer, s = v.settings
  return {
    vin: c.vehicle.vin ?? '', year: String(c.vehicle.year), model: c.vehicle.model, trim: c.vehicle.trim, color: c.vehicle.color,
    odometer: String(c.vehicle.odometer), annualMiles: String(c.vehicle.annualMiles),
    estimatedMarketValue: s.estimatedMarketValue != null ? String(s.estimatedMarketValue) : '',
    zip: c.zip ?? '', monthlyBudget: String(c.monthlyBudget), contactPreference: c.contactPreference ?? '',
  }
}

/** Only fields that differ from the original synthetic profile are saved, so provenance stays honest. */
function toSettings(f: Form, o: View['original']) {
  const out: Record<string, unknown> = {}
  const orig: Record<string, unknown> = { year: o.vehicle.year, model: o.vehicle.model, trim: o.vehicle.trim, color: o.vehicle.color, odometer: o.vehicle.odometer, annualMiles: o.vehicle.annualMiles, zip: o.zip ?? '', monthlyBudget: o.monthlyBudget }
  for (const [k, raw] of Object.entries(f)) {
    const v = raw.trim()
    if (!v) continue
    const val = (NUM as readonly string[]).includes(k) ? Number(v.replace(/[^\d.]/g, '')) : k === 'vin' ? v.toUpperCase() : v
    if (k === 'vin' || k === 'estimatedMarketValue' || k === 'contactPreference' || val !== orig[k]) out[k] = val
  }
  return out
}

export function Settings({ st, onSaved }: { st: NextState; onSaved: (patch: { vehicleValue?: number; monthlyBudget?: number }) => void }) {
  const c = st.customer!
  const [view, setView] = useState<View | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [vin, setVin] = useState<DecodedVin | null>(null)
  const [state, setState] = useState<{ busy?: boolean; msg?: string; err?: string }>({})

  useEffect(() => { fetch(`/api/profile?customerId=${c.id}`).then(r => r.json()).then((v: View) => { setView(v); setForm(toForm(v)) }) }, [c.id])
  if (!view || !form) return <div className="text-sm text-mute"><span className="pulse-dot">●</span> Loading your details…</div>

  const set = (k: keyof Form, v: string) => { setForm({ ...form, [k]: v }); setState({}) }
  const was = (k: keyof Form, orig: unknown) => form[k] !== '' && String(orig) !== form[k] && <span className="ml-2 text-[12px] text-mute">was {String(orig)}</span>

  const lookup = async () => {
    setState({ busy: true }); setVin(null)
    const r = await fetch('/api/profile', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'decode-vin', vin: form.vin }) })
    const d = await r.json()
    if (!r.ok) setState({ err: d.error }); else { setVin(d); setState({}) }
  }
  const save = async (clear = false) => {
    setState({ busy: true })
    const settings = clear ? {} : toSettings(form, view.original)
    const r = await fetch('/api/profile', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customerId: c.id, settings }) })
    const d = await r.json()
    if (!r.ok) { setState({ err: d.error }); return }
    setView(d); setForm(toForm(d)); setVin(null)
    setState({ msg: clear ? 'Your changes were undone. Michi is re-checking.' : 'Saved. Michi is re-checking your options with these details.' })
    onSaved({ vehicleValue: d.customer.vehicle.estimatedMarketValue, monthlyBudget: d.customer.monthlyBudget })
  }

  const o = view.original
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <p className="text-[15px] text-mute">Keep your details up to date so Michi’s suggestions fit your real situation. Anything you change is marked as coming from you.</p>

      <Panel title="Your car">
        <label className="block text-[14px]"><span className="text-mute">VIN (on your registration or the driver’s side dashboard)</span>
          <div className="mt-1 flex gap-2">
            <input className={input + ' mt-0 font-mono uppercase'} maxLength={17} value={form.vin} onChange={e => set('vin', e.target.value)} placeholder="e.g. JTMW1RFV0ND123456" aria-label="VIN" />
            <button className="btn shrink-0" disabled={state.busy || form.vin.trim().length !== 17} onClick={lookup}>Look up</button>
          </div></label>
        {vin && (
          <div className={`mt-3 rounded-lg border p-3 text-[14px] ${vin.ok ? 'border-[#2b4a3a] bg-[#76d6a00d]' : 'border-[#5a4520]'}`}>
            <div>{vin.ok ? '✓' : '!'} NHTSA says: <b>{vin.year} {vin.make} {vin.model} {vin.trim}</b></div>
            {!vin.ok && <div className="mt-1 text-[12px] text-mute">{vin.message}</div>}
            {vin.year && vin.model && <button className="btn mt-2" onClick={() => setForm({ ...form, year: String(vin.year), model: vin.model.toLowerCase() === form.model.toLowerCase() ? form.model : vin.model, trim: vin.trim || form.trim })}>Use these details</button>}
          </div>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-[14px]"><span className="text-mute">Year</span>{was('year', o.vehicle.year)}<input className={input} inputMode="numeric" value={form.year} onChange={e => set('year', e.target.value)} /></label>
          <label className="text-[14px]"><span className="text-mute">Model</span>{was('model', o.vehicle.model)}<input className={input} value={form.model} onChange={e => set('model', e.target.value)} /></label>
          <label className="text-[14px]"><span className="text-mute">Trim</span>{was('trim', o.vehicle.trim)}<input className={input} value={form.trim} onChange={e => set('trim', e.target.value)} /></label>
          <label className="text-[14px]"><span className="text-mute">Color</span><input className={input} value={form.color} onChange={e => set('color', e.target.value)} /></label>
          <label className="text-[14px]"><span className="text-mute">Mileage now</span>{was('odometer', o.vehicle.odometer)}<input className={input} inputMode="numeric" value={form.odometer} onChange={e => set('odometer', e.target.value)} /></label>
          <label className="text-[14px]"><span className="text-mute">Miles per year</span>{was('annualMiles', o.vehicle.annualMiles)}<input className={input} inputMode="numeric" value={form.annualMiles} onChange={e => set('annualMiles', e.target.value)} /></label>
        </div>
        <label className="mt-4 block text-[14px]"><span className="text-mute">What you think it’s worth (optional)</span>
          <div className="mt-1 flex items-center rounded-lg border border-line bg-bg px-3 focus-within:border-red"><span className="text-mute">$</span><input className="w-full bg-transparent px-2 py-2.5 text-[15px] focus:outline-none" inputMode="numeric" value={form.estimatedMarketValue} onChange={e => set('estimatedMarketValue', e.target.value)} placeholder={`Leave blank to use our estimate (${usd(o.vehicle.estimatedMarketValue)})`} aria-label="Your estimate of the car’s value" /></div></label>
      </Panel>

      <div className="grid gap-5 sm:grid-cols-2">
        <Panel title="Where you are">
          <label className="text-[14px]"><span className="text-mute">ZIP code</span><input className={input} inputMode="numeric" maxLength={5} value={form.zip} onChange={e => set('zip', e.target.value)} /></label>
          <p className="mt-2 text-[12px] text-mute">Used only to find Toyota dealers near you.</p>
        </Panel>
        <Panel title="Your budget">
          <label className="text-[14px]"><span className="text-mute">Most you want to pay each month</span>{was('monthlyBudget', o.monthlyBudget)}
            <div className="mt-1 flex items-center rounded-lg border border-line bg-bg px-3 focus-within:border-red"><span className="text-mute">$</span><input className="w-full bg-transparent px-2 py-2.5 text-[15px] focus:outline-none" inputMode="numeric" value={form.monthlyBudget} onChange={e => set('monthlyBudget', e.target.value)} aria-label="Monthly budget" /></div></label>
        </Panel>
      </div>

      <Panel title="How should we reach you?">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Contact preference">
          {[['phone', '📞 Phone call'], ['text', '💬 Text message'], ['email', '✉️ Email']].map(([k, l]) => (
            <button key={k} role="radio" aria-checked={form.contactPreference === k} onClick={() => set('contactPreference', k)} className={`rounded-xl border px-4 py-3 text-[15px] ${form.contactPreference === k ? 'border-red bg-[#eb0a1e14]' : 'border-line hover:border-[#3a424e]'}`}>{l}</button>
          ))}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-red px-6 py-3 text-base" disabled={state.busy} onClick={() => save()}>{state.busy ? 'Saving…' : 'Save my details'}</button>
        {Object.keys(view.settings).length > 0 && <button className="btn px-5 py-3" disabled={state.busy} onClick={() => save(true)}>Undo my changes</button>}
        {state.msg && <span className="text-[14px] text-good" role="status">✓ {state.msg}</span>}
        {state.err && <span className="text-[14px] text-red" role="alert">{state.err}</span>}
      </div>
    </div>
  )
}
