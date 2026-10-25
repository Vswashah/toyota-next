# TOYOTA NEXT · NEXT // INTELLIGENCE

*See the possibilities. Find your next move.*

A hackathon prototype for Toyota Financial Services' **"What's Your Next Move?"** challenge: an agentic decision workflow that investigates a customer's situation, runs deterministic financial scenarios, challenges its own recommendation, explains it, and turns it into tracked next steps.

> All customers, accounts, rates and valuations are **synthetic**. NEXT does not connect to Toyota systems, make offers, determine eligibility, or change accounts.

## Meet Michi

**Michi** (道, Japanese for "the way") is the agent inside TOYOTA NEXT: a calm guide for the road ahead, echoing the Toyota Way. Its tagline is *"Your road ahead, made clear."* and its mark is a road curving to a red destination point.

The customer home leads with **"Michi suggests"**, written so any age group can follow:
- one plain-language headline, e.g. *"Spread your loan over 5 years"*, with the jargon named underneath (*"This is called refinancing"*);
- two big bars comparing the payment now with the payment on Michi's plan;
- three short lines covering the monthly change, the total-cost catch, and whether it fits the budget;
- three large buttons: **Show me how**, **Talk to a person** (creates a specialist request) and **See all options**;
- **Read aloud** using the browser's speech synthesis, plus an **A+ Larger text** toggle in the top bar.

The wording comes from `src/lib/plain.ts`, which is tested. Every number in it is engine output.

## Run it

Requires **Node 24+** (it uses the built-in `node:sqlite` and native TypeScript in tests). No database server is needed.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 32 tests: formulas, scenarios, challenger, workflow, tools, LLM fallback, history, impact
npm run build && npm start   # production
```

Optional LLM wording (the app is fully functional without it):

```bash
ANTHROPIC_API_KEY=sk-... npm run dev     # defaults to claude-opus-5-5; override with NEXT_LLM_MODEL
GEMINI_API_KEY=... npm run dev           # Gemini instead (wins if set); defaults to gemini-3.5-flash-lite
NEXT_LLM=off npm run dev                 # force deterministic mode
```

Data persists to `.data/next.db` (override with `NEXT_DB_PATH`). Use **Reset demo data** in the sidebar to clear a profile.

## Demo script (about 3 minutes)

1. **Explore demo profile** → Maya Chen (RAV4 loan, $593/mo, wants ≤ $500).
2. Watch **NEXT Agent Activity** stream the six stages. The preliminary pick is the 72-month extension (lowest payment). The **Challenger** finds a 60-month option that meets the target at lower modeled cost, revises the pick, then runs a +1.5 pt rate sensitivity and flags it as *fragile*.
3. **NEXT Twin** → drag *Payment target* to $430. The workflow re-runs, the move changes to 72 months, and *What changed?* shows the cause **established by counterfactual re-run**.
4. **Decision History** → previous vs current, ranking changes, validation findings, and both scenario sets side by side.
5. **Ask NEXT** → "What is the catch?" (grounded answer), then "What if my budget was $450?" (runs a real hypothetical workflow).
6. **Next Steps** → add a proposed step, then mark it completed (simulated, logged as an agent step).
7. **Stress test** → "Vehicle value −10%" shows before/after; **Reset scenario**.
8. **Switch profile** (⌘K / Ctrl+K) → Marcus (no option reaches $340, so he is routed to a specialist) or Daniel (lease end: return vs buyout, mileage projection).
9. **Impact Lab** → the real engine runs on a 200-customer synthetic cohort; engine-derived, assumed and hypothetical metrics are labeled separately, and an experiment is sized.

## Michi's action plan (Next Steps)

Next Steps is an agent that works for the customer, not a list of tips. It runs in four phases:
- **Plan:** builds the steps that fit the recommended move (refinance, trade-in, lease return or buyout, keep, or specialist).
- **Act:** calls real tools:
  - NHTSA recalls API (free, no key)
  - web listings for market value (SerpApi)
  - Toyota dealers near the customer's ZIP (SerpApi Google Maps)
  - official toyotafinancial.com pages (SerpApi)
  - a payoff estimate from the `quote_payment` tool
  - calendar reminders as a downloadable `.ics` file
- **Observe and adapt:** a recall leads to finding a dealer and requesting a repair appointment. A market value more than 8% off the estimate leads to offering to update it. Finding dealers leads to offering an appointment request.
- **Ask first:** appointment requests, specialist hand-offs and value updates wait for the customer's **OK**. Approved actions become tracked steps. Nothing is sent to a dealer automatically.

The agent is bounded at 10 steps, runs one plan per customer at a time, and logs every tool call to the agent activity trail. Failed steps can be retried.

## Settings

Customers can edit their car (year, model, trim, color, mileage, miles per year, and their own value estimate), ZIP, budget and contact preference. **VIN lookup** uses NHTSA vPIC to fill in the car's details. Only changed fields are saved and they are labeled "From you". Saving makes Michi re-check, and **Undo my changes** restores the original profile.

## Payments (one-stop servicing)

**Payments** in the customer app: pay the monthly amount, pay extra toward principal, or pay off the loan (lease accounts: monthly payment only), plus autopay and payment history.

- **Two steps, customer-confirmed:** *Review payment* returns a quote (principal and interest split, new balance, months and interest saved). *Confirm & pay* posts it. Quotes are single use, expire after 10 minutes, and are re-checked against the account so a stale quote can't post.
- **Agents can quote but never pay:** `quote_payment` is an agent tool, while posting is only possible through the customer's confirmation in `/api/payments`.
- **Payments change the account everywhere:** the engine, Overview and admin console read the post-payment balance, and NEXT re-runs its decision workflow automatically (trigger `payment`). A paid-off loan is handled: refinancing is skipped and equity is full.
- **Simulated:** demo funding accounts only, no card entry, no money moves. *Reset demo data* clears a profile's payments and autopay.

### Real card payments (Stripe, test mode)

Add a Stripe **test** secret key to `.env.local` (`STRIPE_SECRET_KEY=sk_test_...`) and restart. Payments then offers **Pay by card**:
- The customer pays on Stripe's hosted Checkout page, so card data never touches this app.
- On return, the server retrieves the session from Stripe and posts the payment only if it is `paid`. Posting is idempotent per session.
- Optional webhook backup: run `stripe listen --forward-to localhost:3000/api/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET`.
- Live keys (`sk_live_`) are refused unless `STRIPE_ALLOW_LIVE=1`, because these are synthetic accounts.
- Buy-now-pay-later and slow bank debits are excluded, so it is cards only.

Test card: `4242 4242 4242 4242`, any future date and CVC. On Stripe's page, untick "Save my information with Link" or enter a phone number.

## TFS team console (`/admin`)

A separate view for the Toyota Financial Services team, linked from the welcome screen. It refreshes every 5 s from the recorded workflows:

- **Challenge scorecard:** live numbers for Personalize, Simplify, Guide and Value.
- **Opportunity pipeline:** each customer's validated next move mapped to a TFS opportunity (new vehicle + financing, lease buyout financing, account restructure, retained, retention risk), with financing volume, stage (identified → engaged → action selected → completed) and route (self-service or specialist).
- **Team outreach:** *Follow up* or *Assign specialist* creates a tracked step in the customer's Next Steps through the same validated action tool. It is simulated; nothing is sent externally.
- **At scale:** the real engine run over the 200-customer synthetic cohort, showing opportunity mix, volume and income.
- **Live agent activity** across all customers, and **trust & guardrails** (Challenger revisions, disclosed caveats, tool failures, LLM fallbacks).

Volumes and counts are engine output. *Est. finance income* is **hypothetical**: amount financed × an adjustable assumed margin × half the term. Set `ADMIN_PASSCODE` to require a passcode for the console and its API.

## Architecture (modular monolith)

```
src/lib/
  finance.ts     deterministic loan math (payment, balance, implied APR, depreciation)
  data.ts        synthetic customers (+ cohort registry for Impact Lab)
  scenarios.ts   Assumptions schema (zod) + keep / refinance / trade-in / lease-end / support simulators
  decision.ts    comparison, ranking (hard constraints → published score), Challenger rules, decision, action plan, signals
  tools.ts       typed tool registry: zod in/out validation, per-stage permissions, fault injection for tests
  engine.ts      bounded workflow: context → investigation → simulation → challenger (≤4 iterations) → decision → action
  llm.ts         optional Claude wording; output rejected unless every number is grounded in the facts
  history.ts     "What changed?" diff + counterfactual attribution
  ask.ts         Ask NEXT: deterministic intents, what-if re-runs
  impact.ts      seeded cohort, metrics with formulas, experiment sizing
  db.ts          SQLite store: AgentExecution, AgentStep, Scenario, Recommendation, CustomerAction
src/app/api/     route handlers (workflow streams NDJSON events)
src/components/  UI (Command Center, NEXT Twin, Signals, Next Steps, History, Impact Lab, ⌘K palette)
```

**Trust rules built in:** every figure comes from `finance.ts`/`scenarios.ts`; the illustrative refinance rate starts at the customer's own rate (no invented better offers); unknown fees stay *missing* and are disclosed; vehicle values are labeled assumptions; customer text can only set a goal or target; tool calls are validated and logged, and failures are recorded rather than hidden; actions are proposals until the customer confirms.

**Known simplifications:** SQLite rather than PostgreSQL (same tables; swap the store for production). Taxes and fees are not modeled unless supplied. Depreciation is a single illustrative rate.
