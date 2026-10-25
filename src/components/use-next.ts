'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomerProfile } from '@/lib/data.ts'
import type { Assumptions, ScenarioResult } from '@/lib/scenarios.ts'
import type { StepRecord, StepStatus, WorkflowResult } from '@/lib/engine.ts'
import type { Stage, ActionRecord } from '@/lib/tools.ts'
import type { StoredRecommendation } from '@/lib/db.ts'
import type { WhatChanged } from '@/lib/history.ts'
import type { Answer } from '@/lib/ask.ts'

export type CustomerInfo = CustomerProfile & { defaults: Assumptions; apr: { apr: number; provenance: string } | null; lease: { monthsLeft: number; projectedMiles: number; excessMiles: number | null; mileageCharge: number | null } | null }
export type Result = Omit<WorkflowResult, 'recommendation'> & { recommendation: StoredRecommendation | null }
export interface Execution { id: string; trigger: string; status: string; executionSummary: string; startedAt: string; completedAt: string | null; iterations: number; steps: StepRecord[]; stageStatus: Record<string, string> }
export interface ChatItem { role: 'user' | 'next'; text: string; meta?: string; steps?: string[]; links?: { title: string; link: string }[]; actions?: { id: string; label: string }[] }

export const STAGE_ORDER: Stage[] = ['context', 'investigation', 'simulation', 'challenger', 'decision', 'action']
export const STAGE_LABEL: Record<Stage, string> = {
  context: 'Understanding customer context', investigation: 'Investigating alternatives', simulation: 'Calculating financial scenarios',
  challenger: 'Challenging the recommendation', decision: 'Validating the outcome', action: 'Preparing next actions',
}
const idle = () => Object.fromEntries(STAGE_ORDER.map(s => [s, 'pending'])) as Record<Stage, StepStatus>
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error ?? `Request failed (${r.status})`)
  return body as T
}
const post = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export function useNext() {
  const [customers, setCustomers] = useState<CustomerInfo[]>([])
  const [llm, setLlm] = useState<{ configured: boolean; model: string | null }>({ configured: false, model: null })
  const [customerId, setCustomerId] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)
  const [liveStages, setLiveStages] = useState(idle())
  const [liveSteps, setLiveSteps] = useState<StepRecord[]>([])
  const [running, setRunning] = useState(false)
  const [whatChanged, setWhatChanged] = useState<WhatChanged | null>(null)
  const [actions, setActions] = useState<ActionRecord[]>([])
  const [history, setHistory] = useState<StoredRecommendation[]>([])
  const [executions, setExecutions] = useState<Execution[]>([])
  const [chat, setChat] = useState<ChatItem[]>([])
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ctl = useRef<AbortController | null>(null)

  const reloadCustomers = useCallback(() =>
    json<{ customers: CustomerInfo[]; llm: { configured: boolean; model: string | null } }>('/api/customers').then(d => { setCustomers(d.customers); setLlm(d.llm) }).catch(e => setError(String(e.message))), [])
  useEffect(() => { reloadCustomers() }, [reloadCustomers])

  const refresh = useCallback(async (cid: string) => {
    const [a, h, e] = await Promise.all([
      json<{ actions: ActionRecord[] }>(`/api/actions?customerId=${cid}`),
      json<{ recommendations: StoredRecommendation[] }>(`/api/history?customerId=${cid}`),
      json<{ executions: Execution[] }>(`/api/executions?customerId=${cid}&limit=12`),
    ])
    setActions(a.actions); setHistory(h.recommendations); setExecutions(e.executions)
  }, [])

  /** Runs the real workflow; stage/step events are rendered as they stream in (paced slightly for readability). */
  const run = useCallback(async (cid: string, opts: { overrides?: Partial<Assumptions>; request?: string; trigger: string; pace?: number }) => {
    ctl.current?.abort()
    const c = new AbortController(); ctl.current = c
    setRunning(true); setError(null); setLiveStages(idle()); setLiveSteps([])
    const pace = reduced() ? 0 : opts.pace ?? 70
    try {
      const res = await fetch('/api/workflow', { ...post({ customerId: cid, request: opts.request, overrides: opts.overrides, trigger: opts.trigger }), signal: c.signal })
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Workflow failed (${res.status})`)
      const reader = res.body.getReader(), dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim() || c.signal.aborted) continue
          const ev = JSON.parse(line)
          if (ev.type === 'stage') setLiveStages(s => ({ ...s, [ev.stage]: ev.status }))
          else if (ev.type === 'step') { setLiveSteps(s => [...s, ev.step]); if (pace) await sleep(pace) }
          else if (ev.type === 'result') {
            setResult(ev.result); setWhatChanged(ev.whatChanged)
            if (ev.result.status === 'failed') setError(ev.result.error ?? 'Workflow failed')
          } else if (ev.type === 'error') throw new Error(ev.error)
        }
      }
      if (!c.signal.aborted) await refresh(cid)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message)
    } finally {
      if (ctl.current === c) setRunning(false)
    }
  }, [refresh])

  const selectCustomer = useCallback(async (cid: string) => {
    setCustomerId(cid); setResult(null); setWhatChanged(null); setChat([]); setActions([]); setHistory([]); setExecutions([])
    await run(cid, { trigger: 'initialize' })
  }, [run])

  const ask = useCallback(async (question: string) => {
    if (!customerId) return
    setChat(c => [...c, { role: 'user', text: question }]); setAsking(true)
    try {
      const history = chat.slice(-6).map(m => ({ role: m.role, text: [m.text, ...(m.steps ?? [])].join(' ').slice(0, 1200) }))
      const { answer } = await json<{ answer: Answer }>('/api/ask', post({ customerId, question, history }))
      setChat(c => [...c, { role: 'next', text: answer.text, steps: answer.steps, links: answer.links, actions: answer.actions }])
      await refresh(customerId)
    } catch (e) {
      setChat(c => [...c, { role: 'next', text: (e as Error).message, meta: 'error' }])
    } finally { setAsking(false) }
  }, [customerId, refresh, chat])

  const createAction = useCallback(async (a: { actionType: string; title: string; details: string[] }) => {
    if (!customerId) return null
    const r = await json<{ action: ActionRecord }>('/api/actions', post({ customerId, recommendationId: result?.recommendation?.id ?? null, ...a }))
    await refresh(customerId)
    return r.action
  }, [customerId, result, refresh])

  const updateAction = useCallback(async (actionId: string, status: ActionRecord['status']) => {
    if (!customerId) return
    await json('/api/actions', post({ customerId, actionId, status }, 'PATCH'))
    await refresh(customerId)
  }, [customerId, refresh])

  const compare = useCallback((from: string, to: string) =>
    json<{ whatChanged: WhatChanged; scenarios: { from: ScenarioResult[]; to: ScenarioResult[] } }>(`/api/history?customerId=${customerId}&from=${from}&to=${to}`), [customerId])

  const resetDemo = useCallback(async () => {
    if (!customerId) return
    await json('/api/reset', post({ customerId }))
    await selectCustomer(customerId)
  }, [customerId, selectCustomer])

  const refreshAll = useCallback(() => { if (customerId) refresh(customerId).catch(() => {}) }, [customerId, refresh])
  const customer = customers.find(c => c.id === customerId) ?? null
  return { refreshAll, reloadCustomers, customers, llm, customer, customerId, result, liveStages, liveSteps, running, whatChanged, actions, history, executions, chat, asking, error, setError, run, selectCustomer, ask, createAction, updateAction, compare, resetDemo }
}
export type NextState = ReturnType<typeof useNext>
