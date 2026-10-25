'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { NextState } from './use-next'
import type { FinancingAccount } from '@/lib/data.ts'
import type { PaymentKind, PaymentPreview, PaymentRecord } from '@/lib/payments.ts'
import { Badge, Empty, Panel, usd } from './ui'

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

  const load = useCallback(() => call<Account>(undefined, c.id).then(a => { setAcct(a); if (a.stripe === 'test' || a.stripe === 'live') setMethod(m => m === 'demo-checking' ? 'card' : m) }).catch(e => setErr(e.message)), [c.id])
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
      setReceipt(d.receipt); setAcct(d.account); setQuote(null); onDone()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (f: () => Promise<void>) => { setBusy(true); setErr(null); try { await f() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) } }
  const review = () => act(async () => { setReceipt(null); setQuote(await call<Quote>({ action: 'quote', customerId: c.id, kind, method: method === 'card' ? 'demo-checking' : method, ...(kind === 'extra_principal' ? { amount: Number(amount) } : {}) })) })
  const payByCard = () => act(async () => {
    const d = await call<{ url: string }>({ action: 'checkout', customerId: c.id, quoteId: quote!.quoteId })
    window.location.href = d.url // Stripe’s hosted, secure payment page
  })
  const confirm = () => act(async () => {
    const d = await call<{ receipt: PaymentRecord; account: Account }>({ action: 'confirm', customerId: c.id, quoteId: quote!.quoteId })
    setReceipt(d.receipt); setAcct(d.account); setQuote(null)
    onDone() // refresh balances and re-run NEXT on the new account
  })
  const autopay = (enabled: boolean) => act(async () => setAcct((await call<{ account: Account }>({ action: 'autopay', customerId: c.id, enabled, method: method === 'card' ? 'demo-checking' : method })).account))

  if (!acct) return err ? <Empty>{err}</Empty> : <div className="text-sm text-mute"><span className="pulse-dot">●</span> Loading account…</div>
  const f = acct.financing, isLease = f.financingType === 'lease'
  const kinds: PaymentKind[] = isLease ? ['monthly'] : ['monthly', 'extra_principal', 'payoff']
  const cardOn = acct.stripe === 'test' || acct.stripe === 'live'
  const p = quote?.preview
  const pick = (k: PaymentKind) => { setKind(k); setQuote(null); setReceipt(null) }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* The bill: what's due, when, one tap to start */}
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-[#eb0a1e14] blur-2xl" />
        {acct.paidInFull ? (
          <div className="flex items-center gap-4"><span className="grid h-14 w-14 place-items-center rounded-full bg-[#76d6a01a] text-2xl text-good">✓</span>
            <div><div className="font-display text-2xl">Paid in full</div><div className="text-[14px] text-mute">Nothing is due. Michi has re-checked your options.</div></div></div>
        ) : <>
          <div className="label">Amount due</div>
          <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="num font-display text-5xl">{usd(f.monthlyPayment, true)}</div>
              <div className="mt-1 text-[15px] text-mute">Due {acct.nextDue ? fmtDate(acct.nextDue) : '—'}</div>
            </div>
          </div>
          {!isLease && f.currentBalance != null && (
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              {[['Left to pay', usd(f.currentBalance)], ['Payments left', String(f.remainingMonths ?? '—')], ['Rate', acct.apr ? `${acct.apr.apr}%` : '—']].map(([k, v]) => (
                <div key={k} className="rounded-xl bg-bg/60 px-2 py-3"><div className="num text-lg">{v}</div><div className="text-[12px] text-mute">{k}</div></div>
              ))}
            </div>
          )}
          {isLease && f.leaseEndDate && <div className="mt-4 text-[14px] text-mute">Lease ends {fmtDate(f.leaseEndDate)}</div>}
        </>}
      </section>

      {receipt ? (
        <section className="rise panel p-6 text-center" role="status">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#76d6a01a] text-3xl text-good">✓</div>
          <div className="mt-3 font-display text-2xl">Payment done</div>
          <div className="num mt-1 text-3xl">{usd(receipt.amount, true)}</div>
          <div className="mt-1 text-[14px] text-mute">from {receipt.method}</div>
          {receipt.balanceAfter != null && <div className="mt-3 text-[15px]">You now owe <b className="num">{usd(receipt.balanceAfter, true)}</b></div>}
          <div className="mt-3 font-mono text-[12px] text-mute">Confirmation {receipt.confirmation}</div>
          <button className="btn mt-4 px-5 py-2.5" onClick={() => { setReceipt(null); pick('monthly') }}>Done</button>
        </section>
      ) : !acct.paidInFull && (quote && p ? (
        /* Review: one big number, what it does, one button */
        <section className="rise panel p-5 sm:p-6">
          <div className="label">Check and pay</div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-xl">{KIND_LABEL[p.kind]}</div>
            <div className="num font-display text-4xl">{usd(p.amount, true)}</div>
          </div>
          <div className="mt-1 text-[14px] text-mute">{method === 'card' ? 'By card on Stripe’s secure page' : `From ${quote.method}`}</div>

          {p.principal != null && p.interest ? (
            <div className="mt-5">
              <div className="flex h-4 overflow-hidden rounded-full bg-line" role="img" aria-label={`${usd(p.principal, true)} to your loan, ${usd(p.interest, true)} to interest`}>
                <div className="bg-good transition-all duration-500" style={{ width: `${(p.principal / p.amount) * 100}%` }} />
                <div className="bg-[#c98500]" style={{ width: `${(p.interest / p.amount) * 100}%` }} />
              </div>
              <div className="mt-2 flex justify-between text-[13px]"><span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-good align-middle" /><span className="num">{usd(p.principal, true)}</span> <span className="text-mute">pays down your loan</span></span>
                <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-[#c98500] align-middle" /><span className="num">{usd(p.interest, true)}</span> <span className="text-mute">interest</span></span></div>
            </div>
          ) : null}

          {p.balanceBefore != null && p.balanceAfter != null && (
            <div className="mt-5 flex items-center justify-center gap-4 rounded-xl bg-bg/60 p-4 text-center">
              <div><div className="num text-lg text-mute line-through decoration-1">{usd(p.balanceBefore)}</div><div className="text-[12px] text-mute">You owe now</div></div>
              <span className="text-2xl text-mute" aria-hidden>→</span>
              <div><div className="num text-2xl text-good">{usd(p.balanceAfter)}</div><div className="text-[12px] text-mute">After this payment</div></div>
            </div>
          )}

          {(p.monthsSaved || p.interestSaved) ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {!!p.monthsSaved && <Badge tone="good">🗓 Done {p.monthsSaved} month{p.monthsSaved > 1 ? 's' : ''} sooner</Badge>}
              {!!p.interestSaved && <Badge tone="good">💰 Saves about {usd(p.interestSaved)} in interest</Badge>}
            </div>
          ) : null}

          <button className="btn btn-red mt-6 w-full py-3.5 text-base" disabled={busy} onClick={method === 'card' ? payByCard : confirm}>
            {busy ? (method === 'card' ? 'Opening secure page…' : 'Paying…') : method === 'card' ? `💳 Pay ${usd(p.amount, true)} by card` : `Pay ${usd(p.amount, true)}`}</button>
          <button className="mt-2 w-full py-2 text-[14px] text-mute hover:text-ink" disabled={busy} onClick={() => setQuote(null)}>← Change something</button>
          <details className="mt-2 text-[12px] text-mute"><summary className="cursor-pointer">Fine print</summary>
            <ul className="mt-1 space-y-0.5">{p.notes.map(n => <li key={n}>· {n}</li>)}
              {method === 'card' && acct.stripe === 'test' && <li>· Stripe test mode: card 4242 4242 4242 4242, any future date and CVC.</li>}</ul></details>
        </section>
      ) : (
        /* Choose: what and how */
        <section className="panel p-5 sm:p-6">
          {kinds.length > 1 && <>
            <div className="label mb-2">1 · What do you want to pay?</div>
            <div role="radiogroup" aria-label="Payment type" className="grid gap-2 sm:grid-cols-3">
              {kinds.map(k => (
                <button key={k} role="radio" aria-checked={kind === k} onClick={() => pick(k)}
                  className={`rounded-xl border p-4 text-left transition ${kind === k ? 'border-red bg-[#eb0a1e0f]' : 'border-line hover:border-[#3a424e]'}`}>
                  <div className="text-xl" aria-hidden>{k === 'monthly' ? '📅' : k === 'extra_principal' ? '➕' : '🏁'}</div>
                  <div className="mt-1 text-[15px]">{KIND_LABEL[k]}</div>
                  <div className="text-[12.5px] text-mute">{k === 'monthly' ? usd(f.monthlyPayment, true) : k === 'payoff' ? 'Finish the loan today' : 'Finish the loan sooner'}</div>
                </button>
              ))}
            </div>
            {kind === 'extra_principal' && (
              <div className="mt-3">
                <div className="flex items-center rounded-xl border border-line bg-bg px-4 focus-within:border-red"><span className="text-xl text-mute">$</span>
                  <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-label="Extra amount" className="num w-full bg-transparent px-2 py-3 text-2xl focus:outline-none" /></div>
                <div className="mt-2 flex gap-2">{[100, 250, 500, 1000].map(v => <button key={v} className={`rounded-full border px-3 py-1 text-[13px] ${Number(amount) === v ? 'border-red' : 'border-line'}`} onClick={() => setAmount(String(v))}>{usd(v)}</button>)}</div>
              </div>
            )}
          </>}

          <div className={`label mb-2 ${kinds.length > 1 ? 'mt-6' : ''}`}>{kinds.length > 1 ? '2 · ' : ''}How do you want to pay?</div>
          <div role="radiogroup" aria-label="Pay with" className="grid gap-2 sm:grid-cols-3">
            {[...(cardOn ? [{ id: 'card', label: 'Debit or credit card', icon: '💳', sub: 'Secure checkout by Stripe' }] : []),
              ...acct.fundingSources.map(s => ({ id: s.id, label: s.label.replace(/^Demo /, '').replace(/^\w/, ch => ch.toUpperCase()), icon: '🏦', sub: 'Bank account (demo)' }))].map(m => (
              <button key={m.id} role="radio" aria-checked={method === m.id} onClick={() => setMethod(m.id)}
                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${method === m.id ? 'border-red bg-[#eb0a1e0f]' : 'border-line hover:border-[#3a424e]'}`}>
                <span className="text-2xl" aria-hidden>{m.icon}</span><span><span className="block text-[14px]">{m.label}</span><span className="block text-[12px] text-mute">{m.sub}</span></span>
              </button>
            ))}
          </div>

          <button className="btn btn-red mt-6 w-full py-3.5 text-base" disabled={busy || (kind === 'extra_principal' && !(Number(amount) >= 1))} onClick={review}>{busy ? 'One moment…' : 'Continue'}</button>
        </section>
      ))}

      {err && <div className="rounded-xl border border-[#5a1f26] p-3 text-[14px] text-red" role="alert">{err}</div>}

      {!acct.paidInFull && (
        <section className="panel flex items-center justify-between gap-4 p-5">
          <div><div className="text-[15px]">Autopay</div><div className="text-[13px] text-mute">{acct.autopay.enabled ? `On · paid from ${acct.autopay.method} each month` : 'Never miss a due date'}</div></div>
          <button role="switch" aria-checked={acct.autopay.enabled} aria-label="Autopay" disabled={busy} onClick={() => autopay(!acct.autopay.enabled)}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${acct.autopay.enabled ? 'bg-good' : 'bg-line'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${acct.autopay.enabled ? 'left-[22px]' : 'left-0.5'}`} /></button>
        </section>
      )}

      <Panel title="Past payments">
        {!acct.payments.length ? <Empty>No payments yet.</Empty> : (
          <ul className="divide-y divide-line/60">{acct.payments.map(r => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-full bg-[#76d6a01a] text-good" aria-hidden>✓</span>
                <div><div className="text-[14px]">{KIND_LABEL[r.kind]}</div><div className="text-[12px] text-mute">{new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {r.method}</div></div></div>
              <div className="text-right"><div className="num text-[15px]">{usd(r.amount, true)}</div><div className="hidden font-mono text-[11px] text-mute sm:block">{r.confirmation}</div></div>
            </li>
          ))}</ul>
        )}
      </Panel>
      <p className="text-center text-[12px] text-mute">{acct.stripe === 'test' ? 'Card payments run on Stripe test mode. Bank accounts are demo only.' : 'Demo account. No real money moves.'}</p>
    </div>
  )
}
