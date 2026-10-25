'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NextState } from './use-next'
import type { FinancingAccount } from '@/lib/data.ts'
import type { PaymentKind, PaymentPreview, PaymentRecord } from '@/lib/payments.ts'
import { Badge, Empty, Panel, Stat, usd } from './ui'

interface Account {
  financing: FinancingAccount; apr: { apr: number; provenance: string } | null; payments: PaymentRecord[]
  autopay: { enabled: boolean; method: string | null }; fundingSources: { id: string; label: string }[]; nextDue: string | null; paidInFull: boolean; stripe: 'off' | 'test' | 'live' | 'live-blocked'
}
interface Quote { quoteId: string; preview: PaymentPreview; method: string; expiresAt: string }

const KIND_LABEL: Record<PaymentKind, string> = { monthly: 'Monthly payment', extra_principal: 'Extra toward principal', payoff: 'Pay off loan' }
const fmtDate = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00Z' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

async function call<T>(body?: unknown, customerId?: string): Promise<T> {
  const r = body ? await fetch('/api/payments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) : await fetch(`/api/payments?customerId=${customerId}`, { cache: 'no-store' })
  const d = await r.json()
  if (!r.ok) throw new Error(d.error ?? `Request failed (${r.status})`)
  return d as T
}

export function Payments({ st, onDone }: { st: NextState; onDone: () => void }) {
  const c = st.customer!
  const [acct, setAcct] = useState<Account | null>(null)
  const [kind, setKind] = useState<PaymentKind>('monthly')
  const [amount, setAmount] = useState('500')
  const [method, setMethod] = useState('demo-checking')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [receipt, setReceipt] = useState<PaymentRecord | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => call<Account>(undefined, c.id).then(setAcct).catch(e => setErr(e.message)), [c.id])
  useEffect(() => { load() }, [load])

  // Back from Stripe Checkout: verify with Stripe, then post (idempotent server-side).
  const returned = useRef(false)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const paid = q.get('paid'), canceled = q.get('canceled')
    if ((!paid && !canceled) || returned.current) return
    returned.current = true
    window.history.replaceState(null, '', window.location.pathname)
    if (canceled) { setErr('Card payment canceled. Nothing was charged.'); return }
    act(async () => {
      const d = await call<{ receipt: PaymentRecord; account: Account }>({ action: 'stripe-confirm', customerId: c.id, sessionId: paid })
      setReceipt(d.receipt); setAcct(d.account); onDone()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const review = () => act(async () => { setReceipt(null); setQuote(await call<Quote>({ action: 'quote', customerId: c.id, kind, method, ...(kind === 'extra_principal' ? { amount: Number(amount) } : {}) })) })
  const payByCard = () => act(async () => {
    const d = await call<{ url: string }>({ action: 'checkout', customerId: c.id, quoteId: quote!.quoteId })
    window.location.href = d.url // Stripe’s hosted, secure payment page
  })
  const confirm = () => act(async () => {
    const d = await call<{ receipt: PaymentRecord; account: Account }>({ action: 'confirm', customerId: c.id, quoteId: quote!.quoteId })
    setReceipt(d.receipt); setAcct(d.account); setQuote(null)
    onDone() // refresh balances and re-run NEXT on the new account
  })
  const autopay = (enabled: boolean) => act(async () => setAcct((await call<{ account: Account }>({ action: 'autopay', customerId: c.id, enabled, method })).account))

  if (!acct) return err ? <Empty>{err}</Empty> : <div className="text-sm text-mute"><span className="pulse-dot">●</span> Loading account…</div>
  const f = acct.financing, isLease = f.financingType === 'lease'
  const kinds: PaymentKind[] = isLease ? ['monthly'] : ['monthly', 'extra_principal', 'payoff']

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#2a3f5c] bg-[#3987e50d] px-4 py-2.5 text-[12.5px] text-[#8fb8ee]">{acct.stripe === 'test' ? 'Card payments go through Stripe (test mode). Card details are entered on Stripe’s secure page, never here.' : 'Payments update this demo account. Demo funding only; no real money moves.'}</div>

      <div className="grid gap-5 xl:grid-cols-[380px_1fr] [&>*]:min-w-0">
        <Panel title={`Account ${f.id}`} className="h-fit" right={acct.paidInFull ? <Badge tone="good">Paid in full</Badge> : <Badge tone="mute">{f.financingType}</Badge>}>
          <div className="grid grid-cols-2 gap-5">
            {isLease ? <>
              <Stat big label="Monthly payment" value={usd(f.monthlyPayment, true)} />
              <Stat label="Lease ends" value={f.leaseEndDate ? fmtDate(f.leaseEndDate) : '—'} />
            </> : <>
              <Stat big label="Balance" value={usd(f.currentBalance, true)} />
              <Stat big label="Monthly payment" value={usd(f.monthlyPayment, true)} />
              <Stat label="APR" value={acct.apr ? `${acct.apr.apr}%` : '—'} kind={acct.apr?.provenance} />
              <Stat label="Payments left" value={f.remainingMonths ?? '—'} />
            </>}
            <Stat label="Next payment due" value={acct.nextDue ? fmtDate(acct.nextDue) : 'Nothing due'} />
          </div>
          <div className="mt-5 rounded-lg border border-line p-3">
            <div className="flex items-center justify-between gap-3">
              <div><div className="text-[13px]">Autopay</div><div className="text-[11.5px] text-mute">{acct.autopay.enabled ? `On · drafts from ${acct.autopay.method} on each due date` : 'Off · pay manually each month'}</div></div>
              <button role="switch" aria-checked={acct.autopay.enabled} aria-label="Autopay" disabled={busy || acct.paidInFull} onClick={() => autopay(!acct.autopay.enabled)}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${acct.autopay.enabled ? 'bg-red' : 'bg-line'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${acct.autopay.enabled ? 'left-[22px]' : 'left-0.5'}`} /></button>
            </div>
          </div>
        </Panel>

        <Panel title="Make a payment">
          {acct.paidInFull ? <Empty>This loan is paid in full. Michi has re-checked your options with full equity.</Empty> : <>
            <div role="radiogroup" aria-label="Payment type" className="grid gap-2 sm:grid-cols-3">
              {kinds.map(k => (
                <button key={k} role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setQuote(null) }}
                  className={`panel-elev p-3 text-left transition ${kind === k ? 'border-red glow-red' : 'hover:border-[#3a424e]'}`}>
                  <div className="text-[13px]">{KIND_LABEL[k]}</div>
                  <div className="num mt-1 text-lg">{k === 'monthly' ? usd(f.monthlyPayment, true) : k === 'payoff' ? 'Est. payoff' : 'You choose'}</div>
                  <div className="text-[11px] text-mute">{k === 'monthly' ? 'Due ' + (acct.nextDue ? fmtDate(acct.nextDue) : '—') : k === 'payoff' ? 'Close the loan today' : 'Lowers balance, ends loan sooner'}</div>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {kind === 'extra_principal' && (
                <label className="text-[12.5px]"><span className="text-mute">Amount</span>
                  <div className="mt-1 flex items-center rounded-lg border border-line bg-bg px-3 focus-within:border-red"><span className="text-mute">$</span>
                    <input inputMode="decimal" value={amount} onChange={e => { setAmount(e.target.value.replace(/[^\d.]/g, '')); setQuote(null) }} aria-label="Extra principal amount" className="num w-full bg-transparent px-2 py-2 focus:outline-none" /></div></label>
              )}
              <label className="text-[12.5px]"><span className="text-mute">Pay from</span>
                <select value={method} onChange={e => { setMethod(e.target.value); setQuote(null) }} className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-2 text-[13px]">
                  {acct.fundingSources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select></label>
            </div>
            {!quote && <button className="btn btn-red mt-4" disabled={busy || (kind === 'extra_principal' && !(Number(amount) >= 1))} onClick={review}>{busy ? 'Calculating…' : 'Review payment'}</button>}

            {quote && (
              <div className="rise mt-4 rounded-xl border border-line bg-bg p-4">
                <div className="label mb-3">Review · {KIND_LABEL[quote.preview.kind]}</div>
                <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
                  {([
                    ['Amount', usd(quote.preview.amount, true)], ['From', quote.method],
                    ...(quote.preview.principal != null ? [['To principal', usd(quote.preview.principal, true)], ['To interest', usd(quote.preview.interest, true)]] : []),
                    ...(quote.preview.balanceAfter != null ? [['Balance after', usd(quote.preview.balanceAfter, true)], ['Payments left after', String(quote.preview.remainingAfter)]] : []),
                    ...(quote.preview.monthsSaved ? [['Loan ends sooner by', `${quote.preview.monthsSaved} month${quote.preview.monthsSaved > 1 ? 's' : ''}`]] : []),
                    ...(quote.preview.interestSaved ? [['Estimated interest saved', usd(quote.preview.interestSaved, true)]] : []),
                  ] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between border-b border-line/50 pb-1.5"><dt className="text-mute">{k}</dt><dd className="num">{v}</dd></div>)}
                </dl>
                <ul className="mt-3 space-y-0.5 text-[11.5px] text-mute">{quote.preview.notes.map(n => <li key={n}>· {n}</li>)}</ul>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(acct.stripe === 'test' || acct.stripe === 'live') && <button className="btn btn-red" disabled={busy} onClick={payByCard}>{busy ? 'Opening Stripe…' : `💳 Pay ${usd(quote.preview.amount, true)} by card`}</button>}
                  <button className={`btn ${acct.stripe === 'test' || acct.stripe === 'live' ? '' : 'btn-red'}`} disabled={busy} onClick={confirm}>{busy ? 'Posting…' : `Pay from ${quote.method}`}</button>
                  <button className="btn" disabled={busy} onClick={() => setQuote(null)}>Edit</button>
                </div>
                <div className="mt-2 text-[11px] text-mute">{acct.stripe === 'test' ? 'Card payments run on Stripe test mode: use card 4242 4242 4242 4242, any future date and CVC.' : acct.stripe === 'live-blocked' ? 'Card payments are off: live Stripe keys are blocked for this demo.' : acct.stripe === 'off' ? 'Card payments turn on when a Stripe test key is added.' : 'Card payments are live.'}</div>
              </div>
            )}
          </>}

          {err && <div className="mt-3 rounded-md border border-[#5a1f26] p-2 text-[13px] text-red">{err}</div>}
          {receipt && (
            <div className="rise mt-4 rounded-xl border border-[#2b4a3a] bg-[#76d6a00d] p-4" role="status">
              <div className="flex items-center gap-2 text-good"><span aria-hidden>✓</span><span className="font-display">Payment posted</span><span className="font-mono text-[11px] text-mute">{receipt.confirmation}</span></div>
              <div className="num mt-1 text-[13px]">{usd(receipt.amount, true)} from {receipt.method}{receipt.balanceAfter != null && <> · new balance {usd(receipt.balanceAfter, true)}</>}</div>
              <div className="mt-1 text-[12px] text-mute">Michi is re-checking your options with the new balance. See Overview for any change.</div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Payment history">
        {!acct.payments.length ? <Empty>No payments in NEXT yet.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-[12.5px]">
            <thead className="text-left text-mute"><tr className="[&>th]:pb-2 [&>th]:pr-4 [&>th]:font-normal"><th>Date</th><th>Type</th><th className="text-right">Amount</th><th className="text-right">Principal</th><th className="text-right">Interest</th><th className="text-right">Balance after</th><th>From</th><th>Confirmation</th></tr></thead>
            <tbody className="num">{acct.payments.map(p => (
              <tr key={p.id} className="border-t border-line/60 [&>td]:py-2 [&>td]:pr-4"><td className="font-sans">{new Date(p.createdAt).toLocaleString()}</td><td className="font-sans">{KIND_LABEL[p.kind]}</td><td className="text-right">{usd(p.amount, true)}</td><td className="text-right">{usd(p.principal, true)}</td><td className="text-right">{usd(p.interest, true)}</td><td className="text-right">{usd(p.balanceAfter, true)}</td><td className="font-sans text-mute">{p.method}</td><td className="font-mono text-[11px]">{p.confirmation}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </div>
  )
}
