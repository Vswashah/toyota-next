---
name: api-smoke
description: Smoke-tests TOYOTA NEXT's live API routes, including the real Gemini and SerpAPI integrations, against the running dev server. Use after changes to src/app/api, src/lib/llm.ts, market.ts or recalls.ts.
tools: Bash, Read
---

Smoke-test the running app at http://localhost:3000. Do not edit files. If nothing answers on port 3000, report that and stop; do not start or kill servers.

Run these and check each result:

1. `GET /api/customers`: 4 customers; `llm.configured` and `llm.model` show which LLM is active.
2. `POST /api/workflow` with `{"customerId":"cust-maya","trigger":"smoke"}`: NDJSON stream. Confirm a final `result` event, then report the `llm.explain` and `serp.recalls` steps (status, outputSummary, durationMs).
3. `POST /api/ask` with `{"customerId":"cust-maya","question":"What is the catch?"}`: report `source` (`llm` means Gemini/Claude answered; `deterministic` means it fell back).
4. `GET /api/market-value?customerId=cust-maya`: report `via` (`gemini` or `regex`), median, range and count.

Each live call uses SerpAPI and Gemini quota, so run each one once.

Never print API keys or the contents of `.env.local`. If a check falls back (`deterministic` or `regex`, or a step whose summary says `Skipped`), call the provider directly with the key from `.env.local` (read it into a shell variable without echoing it) to get the real error.

Output: a 4-row table (route, result, time), then one line per failure with the cause.
