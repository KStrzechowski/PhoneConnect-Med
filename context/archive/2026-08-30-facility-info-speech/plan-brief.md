# Facility Information By Speech — Plan Brief

> Full plan: `context/changes/facility-info-speech/plan.md`
> Research: `context/changes/facility-info-speech/research.md`

## What & Why

Roadmap item **S-02**: a caller says what they want in their own words and hears the exact same
facility address-and-hours answer S-01 produces — no menu, no keypress. It completes the walking
skeleton (both variants proven to reach identical business logic) and introduces the project's
first production Lex V2 bot, defining the global-layer intents (orientation, info, repeat,
agent-transfer, fallback) every later speech slice extends.

## Starting Point

The shared answer path (`his/src/facility/*` → `lambdas/facility-info/`) already returns
`{ name, address, opensAt, closesAt, openDays }` from one seeded row and needs no changes — it
takes no input and knows nothing about which variant calls it. No Lex resources exist in the live
stack; the throwaway F-03 spike proved the CDK mechanics work (bot, alias, version, Connect
association via a custom resource) but was deleted at teardown and built no facility-related
intents. `lambdas/measure`'s `variant` field already types `'speech'` as a valid value — F-02
anticipated this slice.

## Desired End State

A caller reaches the speech-variant flow, speaks a request, and hears the identical spoken answer
S-01 produces, sourced through the same shared logic. From any point they can ask to repeat, ask
for a human, or get transferred automatically after three unrecognized utterances — all measured
identically to the keypad variant, carrying `variant: "speech"`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Fulfillment architecture | Shared `@pcm/facility` module, one Lambda | Keeps one Lambda in the request path and matches the byte-identical framing without an inter-Lambda call | Plan |
| Session state for repeat/attempts | Lex session attributes (new mechanism) | Maps naturally onto Lex's turn model; the asymmetry vs. Connect's `lastMessageText` is meant to be measured, not hidden | Plan |
| Contact flow commit | Hand-built only, like S-01 | Continues the established convention; only the bot itself is CDK | Plan |
| Byte-identical wording | `"Nasz adres to {address}. Jesteśmy czynni od {opensAt} do {closesAt}, {openDays}."` | User-provided, transcribed from S-01's live (uncommitted) flow | Plan |
| Retry/fallback UX | Three distinct, escalating messages | Doesn't affect NFR-14 accuracy or the FR-006 strike count — pure caller-facing UX, safe to improve on the spike's silent-repeat gap | Plan |
| Agent-transfer access | Speech-only, no digit fallback | Matches US-01's literal acceptance criteria and keeps the two variants' input mechanisms cleanly separated for the comparison | Plan |
| Lex vs. Connect Lambda permission | `lexv2.amazonaws.com` principal, no `CfnIntegrationAssociation` | This Lambda is invoked by Lex as a fulfillment hook, never directly by Connect | Research/Plan |
| Infra test depth | Assert what `Template.fromStack` can show; leave the custom-resource association to Manual Verification | Matches S-01's own established testing convention exactly | Plan |

## Scope

**In scope:** `@pcm/facility` shared package; `lambdas/facility-info-speech/`; the Lex V2 bot
(5 global-layer intents, no slots) via CDK; the new function's Lex-scoped permission and Connect
bot association; the speech-variant contact flow (console); contract-surfaces and roadmap
bookkeeping.

**Out of scope:** any change to `his/` or `facility-info`'s observable behavior; S-01's contact
flow; authentication, slots, or any intent beyond the five global-layer ones; a digit-based
agent-transfer fallback; committing the contact flow.

## Architecture / Approach

`lambdas/facility-info/index.ts`'s downstream fetch is lifted into `@pcm/facility`, imported by
both the existing keypad Lambda (unchanged behavior) and the new `facility-info-speech` Lambda.
The new Lambda is a Lex V2 fulfillment code hook, dispatching on intent name, using Lex session
attributes for repeat text and a fallback counter. `infra-stack.ts` recovers the F-03 spike's
proven `CfnBot`/`CfnBotVersion`/`CfnBotAlias` shape, transcribing the frozen sample-utterances
file, and associates the bot with Connect via the same custom-resource pattern the spike used —
distinct from how the two existing functions are wired, since Lex (not Connect) invokes this one.
The contact flow loops on a single Get Customer Input (Lex) block, branching to transfer on
`AgentTransferIntent` or a fallback count of 3.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared facility-fetch module | `@pcm/facility`, `facility-info` refactored to use it | Refactor of already-shipped code; must not change `facility-info`'s tests or behavior |
| 2. `lambdas/facility-info-speech/` | The Lex fulfillment handler | The Lex-event-to-`measured()` adapter is genuinely new territory in this repo |
| 3. Infrastructure | The Lex bot, the new function, Connect association | Recovering deleted CDK from git history; getting the Lex-vs-Connect permission distinction right |
| 4. Contact flow, hand-off, bookkeeping | Console flow, contract surfaces, roadmap sync | Entirely console work with no automated check — correctness rests on the manual call matrix, same as S-01 |

**Prerequisites:** S-01 (done). F-03's confirmed `pl_PL` / `eu-central-1` locale availability.
**Estimated effort:** One to two sessions across 4 phases; Phase 3 carries the most infrastructure
surface (recovering and adapting deleted CDK), Phase 4 is verification-heavy but code-free.

## Open Risks & Assumptions

- **The exact wording of S-01's live flow was supplied by the user from memory/notes, not
  re-verified against the live console during this planning session** — worth a quick listen-back
  before Phase 4's manual verification, since the guardrail requires byte-identical output.
- **`$.Lex.SessionAttributes.*` reference syntax in a Connect flow is assumed from the established
  `$.Lex.Slots.*` pattern the F-03 spike used** — not independently re-confirmed against AWS
  documentation in this planning session; if Connect exposes session attributes differently, the
  flow's branching logic in Phase 4 needs adjusting, not the Lambda.
- **No agent queue changes needed** — reuses S-01's existing `BasicQueue`.
- **Recovering `infra/lib/spike-stack.ts` from git history (commit `6de3b7d`) is assumed to still
  apply cleanly** against the current `aws-cdk-lib` version; not diffed line-by-line against the
  current stack in this planning session.

## Success Criteria (Summary)

- A real phone call to the speech-variant flow produces a spoken answer identical to S-01's,
  through the same shared Postgres-backed logic.
- Repeat, agent-transfer, and the three-strike fallback-to-transfer all work, sharing one
  measurement trail carrying `variant: "speech"`.
- The global-layer intent set is documented and built well enough that S-03 (authentication) can
  extend the same bot rather than starting over.
