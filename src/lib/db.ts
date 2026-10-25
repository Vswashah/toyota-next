// Persistence on Node's built-in SQLite: zero setup, survives restarts.
// ponytail: single-file SQLite; swap for PostgreSQL (same tables) when this leaves a laptop.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Recommendation } from './decision.ts'
import type { ScenarioResult } from './scenarios.ts'
import type { StepRecord, WorkflowResult } from './engine.ts'
import type { ActionRecord, ActionStore } from './tools.ts'
import { CUSTOMERS, setAccountOverlay, setProfileOverlay, type ProfileEdit } from './data.ts'
import { accountAfter, type PaymentRecord } from './payments.ts'
import { hashId } from './scenarios.ts'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_execution (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, workflow_type TEXT NOT NULL, trigger TEXT, current_stage TEXT, status TEXT NOT NULL,
  execution_summary TEXT, stage_status TEXT, versions TEXT, iterations INTEGER, started_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_step (
  id TEXT PRIMARY KEY, execution_id TEXT NOT NULL, seq INTEGER, stage TEXT, label TEXT, tool_name TEXT, status TEXT,
  input_summary TEXT, output_summary TEXT, validation_findings TEXT, timestamp TEXT, duration_ms INTEGER);
CREATE TABLE IF NOT EXISTS scenario (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, scenario_type TEXT, input_snapshot TEXT, calculated_results TEXT, assumptions TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS recommendation (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, execution_id TEXT, version INTEGER, scenario_id TEXT, recommended_action TEXT,
  explanation TEXT, tradeoffs TEXT, assumptions TEXT, missing_information TEXT, scenario_ids TEXT, data TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS customer_action (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, recommendation_id TEXT, action_type TEXT, title TEXT, details TEXT, status TEXT, created_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS payment (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, account_id TEXT, kind TEXT, amount REAL, apr_used REAL, method TEXT, confirmation TEXT, data TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS profile_edit (customer_id TEXT PRIMARY KEY, settings TEXT NOT NULL, edit TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS plan_task (
  id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, recommendation_id TEXT, seq INTEGER, kind TEXT, status TEXT, data TEXT NOT NULL, updated_at TEXT);
CREATE TABLE IF NOT EXISTS account_setting (customer_id TEXT PRIMARY KEY, autopay INTEGER NOT NULL, method TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_step_exec ON agent_step(execution_id, seq);
CREATE INDEX IF NOT EXISTS idx_rec_cust ON recommendation(customer_id, version);
`

export interface StoredRecommendation extends Recommendation { executionId: string; scenarioIds: string[] }

const J = (v: unknown) => JSON.stringify(v)
const P = <T>(s: unknown): T => JSON.parse(String(s)) as T
const uid = (p: string) => `${p}-${crypto.randomUUID().slice(0, 8)}`
type Row = Record<string, unknown>

export function openStore(path = process.env.NEXT_DB_PATH ?? '.data/next.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(SCHEMA)

  const stepFromRow = (r: Row): StepRecord => ({
    id: String(r.id), executionId: String(r.execution_id), seq: Number(r.seq), stage: r.stage as StepRecord['stage'], label: String(r.label),
    toolName: (r.tool_name as string) ?? null, status: r.status as StepRecord['status'], inputSummary: String(r.input_summary ?? ''),
    outputSummary: String(r.output_summary ?? ''), validationFindings: r.validation_findings ? P(r.validation_findings) : null,
    timestamp: String(r.timestamp), durationMs: Number(r.duration_ms),
  })
  const recFromRow = (r: Row): StoredRecommendation => ({ ...P<StoredRecommendation>(r.data), id: String(r.id), version: Number(r.version), executionId: String(r.execution_id), scenarioIds: P(r.scenario_ids), createdAt: String(r.created_at) })
  const actFromRow = (r: Row): ActionRecord => ({
    id: String(r.id), customerId: String(r.customer_id), recommendationId: (r.recommendation_id as string) ?? null, actionType: String(r.action_type),
    title: String(r.title), details: P(r.details), status: r.status as ActionRecord['status'], createdAt: String(r.created_at), completedAt: (r.completed_at as string) ?? null,
  })

  const insertStep = db.prepare(`INSERT OR REPLACE INTO agent_step VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
  const saveStep = (s: StepRecord) => insertStep.run(s.id, s.executionId, s.seq, s.stage, s.label, s.toolName, s.status, s.inputSummary, s.outputSummary, s.validationFindings ? J(s.validationFindings) : null, s.timestamp, s.durationMs)

  const store = {
    db,
    /** Persists the whole run in one transaction. Returns the stored recommendation (versioned per customer). */
    saveWorkflow(r: WorkflowResult, trigger: string): StoredRecommendation | null {
      db.exec('BEGIN')
      try {
        const summary = r.recommendation ? `${r.recommendation.recommendedAction} (${r.recommendation.status})` : r.error ?? 'no recommendation'
        const current = (Object.entries(r.stageStatus).reverse().find(([, s]) => s !== 'pending')?.[0]) ?? 'context'
        db.prepare(`INSERT OR REPLACE INTO agent_execution VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          r.executionId, r.customerId, 'next_decision', trigger, current, r.status, summary, J(r.stageStatus), J(r.versions), r.iterations, r.startedAt, r.completedAt)
        r.steps.forEach(saveStep)
        const ins = db.prepare(`INSERT OR IGNORE INTO scenario VALUES (?,?,?,?,?,?,?)`)
        for (const s of r.scenarios) ins.run(s.id, s.customerId, s.type, J(s.inputSnapshot), J(s), J(s.assumptions), r.completedAt)
        let stored: StoredRecommendation | null = null
        if (r.recommendation) {
          const version = Number((db.prepare(`SELECT COALESCE(MAX(version),0) v FROM recommendation WHERE customer_id=?`).get(r.customerId) as Row).v) + 1
          const rec = { ...r.recommendation, id: uid('rec'), version, createdAt: r.completedAt }
          const scenarioIds = r.scenarios.map(s => s.id)
          db.prepare(`INSERT INTO recommendation VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            rec.id, r.customerId, r.executionId, version, rec.scenarioId, rec.recommendedAction, rec.explanation, J(rec.tradeoffs), J(rec.assumptions), J(rec.missingInformation), J(scenarioIds), J(rec), rec.createdAt)
          stored = { ...rec, executionId: r.executionId, scenarioIds }
        }
        db.exec('COMMIT')
        return stored
      } catch (e) { db.exec('ROLLBACK'); throw e }
    },
    /** Records an out-of-workflow agent step (question, action) on the customer's latest execution. */
    logToLatest(customerId: string, s: Pick<StepRecord, 'stage' | 'label' | 'toolName' | 'status' | 'inputSummary' | 'outputSummary'>): StepRecord | null {
      const e = db.prepare(`SELECT id FROM agent_execution WHERE customer_id=? ORDER BY started_at DESC LIMIT 1`).get(customerId) as Row | undefined
      if (!e) return null
      const executionId = String(e.id)
      const seq = Number((db.prepare(`SELECT COALESCE(MAX(seq),0) s FROM agent_step WHERE execution_id=?`).get(executionId) as Row).s) + 1
      const step: StepRecord = { ...s, id: uid('stp'), executionId, seq, validationFindings: null, timestamp: new Date().toISOString(), durationMs: 0 }
      saveStep(step)
      return step
    },
    listRecommendations(customerId: string, limit = 50): StoredRecommendation[] {
      return (db.prepare(`SELECT * FROM recommendation WHERE customer_id=? ORDER BY version DESC LIMIT ?`).all(customerId, limit) as Row[]).map(recFromRow)
    },
    getRecommendation(id: string) { const r = db.prepare(`SELECT * FROM recommendation WHERE id=?`).get(id) as Row | undefined; return r ? recFromRow(r) : null },
    getScenarios(ids: string[]): ScenarioResult[] {
      if (!ids.length) return []
      const rows = db.prepare(`SELECT calculated_results FROM scenario WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as Row[]
      const byId = new Map(rows.map(r => { const s = P<ScenarioResult>(r.calculated_results); return [s.id, s] }))
      return ids.map(i => byId.get(i)).filter((s): s is ScenarioResult => !!s)
    },
    listExecutions(customerId: string, limit = 10) {
      const ex = db.prepare(`SELECT * FROM agent_execution WHERE customer_id=? ORDER BY started_at DESC LIMIT ?`).all(customerId, limit) as Row[]
      const steps = db.prepare(`SELECT * FROM agent_step WHERE execution_id=? ORDER BY seq`)
      return ex.map(e => ({
        id: String(e.id), customerId: String(e.customer_id), workflowType: String(e.workflow_type), trigger: String(e.trigger ?? ''),
        currentStage: String(e.current_stage), status: String(e.status), executionSummary: String(e.execution_summary ?? ''),
        stageStatus: P<Record<string, string>>(e.stage_status ?? '{}'), versions: P<unknown[]>(e.versions ?? '[]'), iterations: Number(e.iterations ?? 0),
        startedAt: String(e.started_at), completedAt: (e.completed_at as string) ?? null,
        steps: (steps.all(e.id as string) as Row[]).map(stepFromRow),
      }))
    },
    listActions(customerId: string): ActionRecord[] {
      return (db.prepare(`SELECT * FROM customer_action WHERE customer_id=? ORDER BY created_at DESC`).all(customerId) as Row[]).map(actFromRow)
    },
    createAction(a: Parameters<ActionStore['createAction']>[0]): ActionRecord {
      const rec: ActionRecord = { ...a, id: uid('act'), status: 'open', createdAt: new Date().toISOString(), completedAt: null }
      db.prepare(`INSERT INTO customer_action VALUES (?,?,?,?,?,?,?,?,?)`).run(rec.id, rec.customerId, rec.recommendationId, rec.actionType, rec.title, J(rec.details), rec.status, rec.createdAt, null)
      return rec
    },
    updateAction(id: string, status: ActionRecord['status']): ActionRecord | null {
      db.prepare(`UPDATE customer_action SET status=?, completed_at=? WHERE id=?`).run(status, status === 'completed' ? new Date().toISOString() : null, id)
      const r = db.prepare(`SELECT * FROM customer_action WHERE id=?`).get(id) as Row | undefined
      return r ? actFromRow(r) : null
    },
    listPayments(customerId: string): PaymentRecord[] {
      return (db.prepare(`SELECT data FROM payment WHERE customer_id=? ORDER BY created_at DESC, rowid DESC`).all(customerId) as Row[]).map(r => P<PaymentRecord>(r.data))
    },
    /** Posts a confirmed payment and updates the live account overlay. */
    addPayment(rec: PaymentRecord, aprUsed: number | null) {
      db.prepare(`INSERT INTO payment VALUES (?,?,?,?,?,?,?,?,?,?)`).run(rec.id, rec.customerId, rec.accountId, rec.kind, rec.amount, aprUsed, rec.method, rec.confirmation, J(rec), rec.createdAt)
      syncAccount(rec.customerId)
      return rec
    },
    getAutopay(customerId: string) {
      const r = db.prepare(`SELECT * FROM account_setting WHERE customer_id=?`).get(customerId) as Row | undefined
      return { enabled: !!r?.autopay, method: (r?.method as string) ?? null, updatedAt: (r?.updated_at as string) ?? null }
    },
    setAutopay(customerId: string, enabled: boolean, method: string | null) {
      db.prepare(`INSERT OR REPLACE INTO account_setting VALUES (?,?,?,?)`).run(customerId, enabled ? 1 : 0, method, new Date().toISOString())
      return store.getAutopay(customerId)
    },
    getSettings(customerId: string): Record<string, unknown> {
      const r = db.prepare(`SELECT settings FROM profile_edit WHERE customer_id=?`).get(customerId) as Row | undefined
      return r ? P(r.settings) : {}
    },
    /** Saves the customer's validated settings and updates the live profile overlay. */
    saveSettings(customerId: string, settings: Record<string, unknown>, edit: ProfileEdit) {
      if (!Object.keys(settings).length) db.prepare(`DELETE FROM profile_edit WHERE customer_id=?`).run(customerId)
      else db.prepare(`INSERT OR REPLACE INTO profile_edit VALUES (?,?,?,?)`).run(customerId, J(settings), J(edit), new Date().toISOString())
      syncProfile(customerId)
    },
    listTasks<T>(customerId: string, recommendationId: string): T[] {
      return (db.prepare(`SELECT data FROM plan_task WHERE customer_id=? AND recommendation_id=? ORDER BY seq`).all(customerId, recommendationId) as Row[]).map(r => P<T>(r.data))
    },
    clearTasks(customerId: string, recommendationId: string) { db.prepare(`DELETE FROM plan_task WHERE customer_id=? AND recommendation_id=?`).run(customerId, recommendationId) },
    saveTask(t: { id: string; customerId: string; recommendationId: string; seq: number; kind: string; status: string }) {
      db.prepare(`INSERT OR REPLACE INTO plan_task VALUES (?,?,?,?,?,?,?,?)`).run(t.id, t.customerId, t.recommendationId, t.seq, t.kind, t.status, J(t), new Date().toISOString())
      return t
    },
    resetCustomer(customerId: string) {
      for (const t of ['profile_edit', 'plan_task']) db.prepare(`DELETE FROM ${t} WHERE customer_id=?`).run(customerId)
      syncProfile(customerId)
      for (const t of ['payment', 'account_setting']) db.prepare(`DELETE FROM ${t} WHERE customer_id=?`).run(customerId)
      syncAccount(customerId)
      for (const t of ['recommendation', 'customer_action', 'scenario']) db.prepare(`DELETE FROM ${t} WHERE customer_id=?`).run(customerId)
      db.prepare(`DELETE FROM agent_step WHERE execution_id IN (SELECT id FROM agent_execution WHERE customer_id=?)`).run(customerId)
      db.prepare(`DELETE FROM agent_execution WHERE customer_id=?`).run(customerId)
    },
  }
  function syncAccount(customerId: string) {
    const base = CUSTOMERS.find(c => c.id === customerId)
    if (!base) return
    const r = db.prepare(`SELECT data, apr_used FROM payment WHERE customer_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(customerId) as Row | undefined
    setAccountOverlay(customerId, r ? accountAfter(base.financing, P<PaymentRecord>(r.data), (r.apr_used as number) ?? null) : null)
  }
  function syncProfile(customerId: string) {
    const r = db.prepare(`SELECT edit FROM profile_edit WHERE customer_id=?`).get(customerId) as Row | undefined
    setProfileOverlay(customerId, r ? P<ProfileEdit>(r.edit) : null)
  }
  CUSTOMERS.forEach(c => { syncAccount(c.id); syncProfile(c.id) })

  return store
}

export type Store = ReturnType<typeof openStore>

const g = globalThis as unknown as { __nextStore?: Store }
const gk = globalThis as unknown as { __nextStoreKey?: string }
// Reopen when this module's schema/code changes (dev hot reload); one shared instance otherwise.
const STORE_KEY = hashId(SCHEMA + openStore.toString())
export const store = () => {
  if (gk.__nextStoreKey !== STORE_KEY || !g.__nextStore) { g.__nextStore = openStore(); gk.__nextStoreKey = STORE_KEY }
  return g.__nextStore
}
