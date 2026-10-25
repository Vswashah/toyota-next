// "What changed?": diffs two stored recommendations and only attributes a change to an input
// when a deterministic counterfactual re-run proves it.
import { usd } from './finance.ts'
import { ASSUMPTION_LABELS, type Assumptions, type ScenarioResult } from './scenarios.ts'
import { runWorkflow } from './engine.ts'
import type { StoredRecommendation } from './db.ts'

export interface Attribution { key: keyof Assumptions; label: string; established: boolean; test: string; result: string }

export interface WhatChanged {
  previous: Snapshot; current: Snapshot; recommendationChanged: boolean
  inputChanges: { key: keyof Assumptions; label: string; from: string; to: string }[]
  calculationChanges: { scenario: string; metric: string; from: string; to: string; delta: number }[]
  rankingChanges: { label: string; from: number | null; to: number | null }[]
  qualifications: { added: string[]; removed: string[] }
  missing: { added: string[]; removed: string[] }
  attribution: Attribution[]
  attributionSummary: string
}
interface Snapshot { id: string; version: number; recommendedAction: string; headline: string; scenarioId: string; scenarioKey: string; goal: string; status: string; createdAt: string; ranking: { label: string; eligible: boolean; score: number | null }[] }

const fmt = (k: keyof Assumptions, v: unknown) => {
  if (v == null) return 'not supplied'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') return /Pct$/.test(k) ? `${v}%` : /Months$/.test(k) ? `${v} mo` : usd(v)
  return String(v).replace(/_/g, ' ')
}
const snap = (r: StoredRecommendation): Snapshot => ({
  id: r.id, version: r.version, recommendedAction: r.recommendedAction, headline: r.headline, scenarioId: r.scenarioId, scenarioKey: r.scenarioKey,
  goal: r.inputs.goal, status: r.status, createdAt: r.createdAt, ranking: r.ranking.map(x => ({ label: x.label, eligible: x.eligible, score: x.score })),
})
const setDiff = (a: string[], b: string[]) => ({ added: b.filter(x => !a.includes(x)), removed: a.filter(x => !b.includes(x)) })

async function keyFor(customerId: string, inputs: Assumptions) {
  const r = await runWorkflow({ customerId, overrides: inputs })
  return r.recommendation?.scenarioKey ?? null
}

export async function whatChanged(prev: StoredRecommendation, cur: StoredRecommendation, prevScen: ScenarioResult[], curScen: ScenarioResult[]): Promise<WhatChanged> {
  const keys = Object.keys(cur.inputs) as (keyof Assumptions)[]
  const changed = keys.filter(k => JSON.stringify(prev.inputs[k]) !== JSON.stringify(cur.inputs[k]))
  const inputChanges = changed.map(k => ({ key: k, label: ASSUMPTION_LABELS[k], from: fmt(k, prev.inputs[k]), to: fmt(k, cur.inputs[k]) }))

  const calculationChanges: WhatChanged['calculationChanges'] = []
  for (const c of curScen.filter(s => !s.sensitivityOf)) {
    const p = prevScen.find(s => s.key === c.key)
    if (!p) continue
    for (const [metric, k] of [['Monthly payment', 'monthlyPayment'], ['Net cost over horizon', 'netCostOverHorizon'], ['Lifetime cost', 'lifetimeCost'], ['Balance at horizon', 'balanceAtHorizon']] as const) {
      const a = p[k], b = c[k]
      if (a != null && b != null && Math.abs(a - b) >= 1) calculationChanges.push({ scenario: c.label, metric, from: usd(a), to: usd(b), delta: Math.round(b - a) })
    }
  }
  const rank = (r: StoredRecommendation, label: string) => { const i = r.ranking.findIndex(x => x.label === label); return i < 0 ? null : i + 1 }
  const labels = [...new Set([...prev.ranking, ...cur.ranking].map(r => r.label))]
  const rankingChanges = labels.map(l => ({ label: l, from: rank(prev, l), to: rank(cur, l) })).filter(x => x.from !== x.to)

  const recommendationChanged = prev.scenarioKey !== cur.scenarioKey
  const attribution: Attribution[] = []
  if (recommendationChanged && changed.length) {
    for (const k of changed.slice(0, 6)) { // ponytail: bounded counterfactuals (2 runs per input); fine for a handful of edits
      const revertKey = await keyFor(cur.customerId, { ...cur.inputs, [k]: prev.inputs[k] })
      const applyKey = await keyFor(cur.customerId, { ...prev.inputs, [k]: cur.inputs[k] })
      const reverts = revertKey === prev.scenarioKey, suffices = applyKey === cur.scenarioKey
      attribution.push({
        key: k, label: ASSUMPTION_LABELS[k], established: reverts || suffices,
        test: `Re-ran the workflow with only ${ASSUMPTION_LABELS[k].toLowerCase()} reverted, and with only it applied.`,
        result: reverts && suffices ? 'Necessary and sufficient: reverting it alone restores the previous move; applying it alone produces the new one.'
          : reverts ? 'Reverting it alone restores the previous recommendation.'
          : suffices ? 'Applying it alone produces the new recommendation.'
          : 'Not established on its own; the change depends on a combination of inputs.',
      })
    }
  }
  const est = attribution.filter(a => a.established)
  return {
    previous: snap(prev), current: snap(cur), recommendationChanged, inputChanges, calculationChanges, rankingChanges,
    qualifications: setDiff(prev.qualifications, cur.qualifications), missing: setDiff(prev.missingInformation, cur.missingInformation), attribution,
    attributionSummary: !recommendationChanged ? 'The recommended move did not change.'
      : !changed.length ? 'No recorded input changed; the difference comes from validation or data changes.'
      : est.length ? `Established by counterfactual re-run: ${est.map(a => a.label).join(', ')}.`
      : 'No single input change is established as the cause; it results from the combination.',
  }
}
