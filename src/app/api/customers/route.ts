import { CUSTOMERS, AS_OF, getCustomer } from '@/lib/data.ts'
import { store } from '@/lib/db.ts'
import { currentApr, defaultAssumptions, leaseFacts } from '@/lib/scenarios.ts'
import { llmConfigured, LLM_MODEL } from '@/lib/llm.ts'

export const dynamic = 'force-dynamic'

export function GET() {
  store() // loads post-payment account state
  return Response.json({
    asOf: AS_OF,
    llm: { configured: llmConfigured(), model: llmConfigured() ? LLM_MODEL : null },
    customers: CUSTOMERS.map(base => getCustomer(base.id)!).map(c => ({
      ...c,
      defaults: defaultAssumptions(c),
      apr: currentApr(c),
      lease: c.financing.financingType === 'lease' ? leaseFacts(c) : null,
    })),
  })
}
