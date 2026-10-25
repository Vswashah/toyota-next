import type { GoalId } from '@/lib/data.ts'

export const GOAL_OPTIONS: { id: GoalId; label: string }[] = [
  { id: 'lower_payment', label: 'Lower my monthly payment' },
  { id: 'minimize_cost', label: 'Minimize total modeled cost' },
  { id: 'replace_vehicle', label: 'Replace my vehicle' },
  { id: 'lease_end', label: 'Decide what to do at lease end' },
  { id: 'understand_options', label: 'Understand my options' },
]
export const goalLabelClient = (g: GoalId) => GOAL_OPTIONS.find(o => o.id === g)?.label ?? g
