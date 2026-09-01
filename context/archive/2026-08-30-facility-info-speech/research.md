---
date: 2026-08-30T17:17:18+0000
researcher: KStrzechowski
git_commit: f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d
branch: main
repository: PhoneConnect-Med
topic: "Facility information by speech (S-02) — reuse from S-01 and Lex bot design"
tags: [research, codebase, lex, nlu, connect, facility-info, S-02]
status: complete
last_updated: 2026-08-30
last_updated_by: KStrzechowski
---

# Research: Facility information by speech (S-02) — reuse from S-01 and Lex bot design

**Date**: 2026-08-30T17:17:18+0000
**Researcher**: KStrzechowski
**Git Commit**: f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d
**Branch**: main
**Repository**: PhoneConnect-Med

## Research Question

How should the natural-language variant of facility information (roadmap **S-02**,
`facility-info-speech`) be implemented — specifically: what can be reused unchanged from the
keypad slice (S-01), and what does the Lex V2 bot itself need (intents, slots, fulfillment,
CDK constructs), given the Lex/NLU mechanics already de-risked by the F-03 spike?

## Summary

S-02 is almost entirely a **front-end addition**, not new business logic. The shared answer
path — `his/` → `lambdas/facility-info/` — is already variant-agnostic and needs **zero
changes**: it takes no input and returns the same flat string map regardless of who calls it.
`lambdas/measure/index.ts` already types `variant` as `'keypad' | 'speech'`
([lambdas/measure/index.ts:15](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/measure/index.ts#L15)),
so F-02 already anticipated this slice.

What's actually new: a Lex V2 bot (Polish, `pl_PL`) with five global-layer intents
(`MainMenuIntent`, `InfoIntent`, `RepeatIntent`, `AgentTransferIntent`, built-in
`FallbackIntent`), whose sample utterances are **already authored and frozen** in
`context/foundation/lex-sample-utterances.md`. The CDK pattern for defining this bot already
exists — written and proven for the F-03 spike, then deleted at teardown — and can be recovered
verbatim from git history at
[infra/lib/spike-stack.ts (commit 6de3b7d)](https://github.com/KStrzechowski/PhoneConnect-Med/blob/6de3b7d/infra/lib/spike-stack.ts).
The spike proved the mechanics (bot, alias, version, `AwsCustomResource` Connect association)
work; it did not build InfoIntent or any of the global-layer intents S-02 needs, so those are
new construction, not copying.

The one genuinely new piece of business-adjacent logic is a **fulfillment Lambda for
`InfoIntent`** — something S-01 has no analogue for, because a keypad menu has no fulfillment
hook of its own; the contact flow calls `facility-info` directly. This Lambda's *only* job per
L-03 is to invoke the existing `facility-info` handler (or the same downstream call) and shape
a Lex `Close` response; it must not re-decide anything the shared logic already decided.

The hardest constraint is the roadmap's own risk note: S-02's answer "must be byte-identical to
S-01's" ([roadmap.md:225](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/roadmap.md#L225)).
Since `his/facility` returns structured fields, not a sentence
([his/src/facility/facility.entity.ts:1-22](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/his/src/facility/facility.entity.ts#L1-L22)),
"byte-identical" means the **same sentence template composed from the same fields**, not the
same code path — the composition happens once in each front-end (contact flow prompt block for
keypad, Lex `messageGroupsList`/Lambda-composed message for speech), and the plan must state
the template once so both variants build the same sentence from the same data.

## Detailed Findings

### 1. What's already built and needs no change

- **`his/src/facility/*`** — `FacilityController` / `FacilityService` / `Facility` entity return
  `{ name, address, opensAt, closesAt, openDays }` from one seeded Postgres row
  ([his/src/facility/facility.controller.ts:1-13](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/his/src/facility/facility.controller.ts#L1-L13),
  [his/src/facility/facility.service.ts:1-17](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/his/src/facility/facility.service.ts#L1-L17)).
  No auth, no params — identical for both variants by construction.
- **`lambdas/facility-info/index.ts`** — calls `GET ${MOCK_BASE_URL}/facility`, wraps in
  `measured()`/`downstream()`, returns `{ reachable, name, address, opensAt, closesAt,
  openDays }` on success or `{ reachable: 'false', error }` on failure
  ([lambdas/facility-info/index.ts:1-33](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/facility-info/index.ts#L1-L33)).
  Takes no input beyond the Connect event; nothing here is keypad-specific. S-02 can invoke this
  exact function from a Lex fulfillment hook.
- **`lambdas/measure/index.ts`** — `InvocationRecord.variant` is already typed
  `'keypad' | 'speech'`
  ([lambdas/measure/index.ts:15](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/measure/index.ts#L15)),
  and reads `variant` from `event.Details?.Parameters?.variant`
  ([lambdas/measure/index.ts:36](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/measure/index.ts#L36)).
  The Connect→Lambda event shape (`Details.Parameters`) is populated by the Invoke block, whether
  that invocation is fired directly from a menu (S-01) or from a Lex bot's fulfillment path
  wired through Connect — the contract surface
  ([docs/reference/contract-surfaces.md:7-19](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/docs/reference/contract-surfaces.md#L7-L19))
  only names `keypad` and `speech` as the two allowed values — `speech` has been reserved and
  unused since F-02.
- **Contract surfaces already generalize**: `lastMessageText` and the reserved global digits
  (`0` = agent, `*` = repeat) are keypad-specific mechanics
  ([docs/reference/contract-surfaces.md:20-42](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/docs/reference/contract-surfaces.md#L20-L42)).
  S-02 needs its **own** mechanism for FR-001/FR-003 repeat and FR-002/FR-006 agent-transfer,
  expressed as Lex intents rather than digits — `RepeatIntent` and `AgentTransferIntent` are
  already scaffolded as sample-utterance sets for exactly this
  ([context/foundation/lex-sample-utterances.md:52-86](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L52-L86)).
  This is new console/CDK wiring, not a change to the existing contract surfaces (a new entry
  should be added for whatever equivalent of `lastMessageText` speech ends up using, if a
  Lex-side session attribute is chosen).

### 2. What's new: the Lex V2 bot

`context/foundation/lex-sample-utterances.md` is the frozen training-data source of truth,
authored **before** the bot exists, per the measurement protocol
([lex-sample-utterances.md:1-8](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L1-L8)).
For S-02's scope (unauthenticated, Layer 1 only), the relevant intents are all under
`## Global layer`:

- **`MainMenuIntent`** — resets/orients ("dzień dobry", "co mogę tutaj załatwić", "menu główne")
  ([lex-sample-utterances.md:13-30](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L13-L30)).
- **`InfoIntent`** — the actual FR-009 request ("jakie są godziny otwarcia", "jaki jest adres",
  15 utterances covering hours and address separately)
  ([lex-sample-utterances.md:32-50](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L32-L50)).
  No slots — the answer always returns both address and hours together (matching US-01's single
  "the answer" framing and S-01's single menu digit), so no per-field routing is needed.
- **`RepeatIntent`** (FR-001/FR-003) — "powtórz", "nie usłyszałam", "co powiedziałeś"
  ([lex-sample-utterances.md:52-67](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L52-L67)).
- **`AgentTransferIntent`** (FR-002/FR-006) — "połącz z agentem", "chcę rozmawiać z człowiekiem",
  "pomoc"
  ([lex-sample-utterances.md:69-86](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L69-L86)).
- **`FallbackIntent`** — no utterances; Lex's built-in fallback, re-ask then transfer after the
  third failure is FR-006, implemented in the fulfillment Lambda, not the utterance set
  ([lex-sample-utterances.md:88-93](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L88-L93)).

A known confusion pair is already documented and directly relevant to S-02's scope:
`AgentTransferIntent` vs `MainMenuIntent` overlap on "pomoc" / "nie wiem co dalej" — resolved
in favor of `AgentTransfer` deliberately, "a confused caller wanting a human is the safer
default"
([lex-sample-utterances.md:320-326](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/lex-sample-utterances.md#L320-L326)).

### 3. The CDK pattern for defining a Lex bot (proven, then deleted)

`infra/lib/spike-stack.ts` was built and successfully deployed for F-03, then deleted at
teardown (`git log --all -- infra/lib/spike-stack.ts` shows it added in `3265797`, fixed in
`6de3b7d`, removed in `a4b4508`). The full file is recoverable at
[commit 6de3b7d](https://github.com/KStrzechowski/PhoneConnect-Med/blob/6de3b7d/infra/lib/spike-stack.ts)
and demonstrates every construct S-02 needs:

- `lex.CfnBot` with `botLocales[0]` = `pl_PL`, `nluConfidenceThreshold`, `voiceSettings` (Polish
  neural voice `Ola`), intents with `sampleUtterances`, `intentClosingSetting` /
  `intentConfirmationSetting`.
- A `botRole` (`lexv2.amazonaws.com` principal) needing `polly:SynthesizeSpeech` and CloudWatch
  log-group write access.
- `lex.CfnBotVersion` (from `DRAFT`) and `lex.CfnBotAlias` (with `conversationLogSettings` →
  `textLogSettings` → CloudWatch), mirroring the pattern any Lex deploy needs.
- **Connect association is not a first-class CDK construct** — it goes through
  `cr.AwsCustomResource` calling the `connect` service's `AssociateBot` / `DisassociateBot`
  actions directly, keyed by `connectInstanceId` (parsed via `cdk.Arn.split`) and the bot alias
  ARN. This is the one non-obvious piece of plumbing S-02's plan must call out explicitly, since
  it isn't discoverable from `aws-cdk-lib/aws-connect`'s own L1 constructs — `connect.CfnBot*`
  doesn't exist; association is API-only.
- DTMF-specific `PromptAttemptSpecificationProperty` fragments (`keypadAttempt`) are **not**
  reusable for S-02's global-layer intents — those existed only for the spike's PESEL slot,
  which S-02 has no equivalent of (S-02 is unauthenticated, Layer 1 only). `spokenAttempt`
  (`allowAudioInput: true, allowDtmfInput: false, allowInterrupt: true`) is the shape closer to
  what S-02's intents need, since every S-02 interaction is voice-only.

### 4. The one new fulfillment concern: an `InfoIntent` handler

S-01's contact flow calls `lambdas/facility-info/` directly from a Get Customer Input branch —
there is no intermediate decision layer. S-02 needs a Lex **fulfillment** Lambda (or a
`DialogCodeHook`/`FulfillmentCodeHook`) attached to `InfoIntent` that:

1. Invokes the same downstream call `lambdas/facility-info/index.ts` already makes (either by
   calling that Lambda, or by factoring its `fetch('/facility')` + `measured()` wrapper into a
   form both variants' Lambdas import — the plan must decide which, since L-03 requires the
   decision to live in one place either way).
2. Composes the **same sentence template** S-01's contact flow prompt uses, from the same
   `{ name, address, opensAt, closesAt, openDays }` fields, so the spoken answer is
   byte-identical per the roadmap's guardrail
   ([roadmap.md:225](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/roadmap.md#L225)).
   S-01's exact Polish sentence template is not in the repo (it lives only in the hand-built
   Connect console flow, per the "contact flows not committed" convention
   ([context/archive/2026-08-23-aws-deployment-baseline/plan.md](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/archive/2026-08-23-aws-deployment-baseline/plan.md))) —
   the plan/implementation step must pull it from the live S-01 flow (or from whoever built it)
   rather than re-invent independent wording.
3. Returns a Lex `Close` dialog action carrying that message, and sets
   `Details.Parameters.variant = "speech"` at the Connect Invoke boundary (equivalently, on
   whatever Connect block hands off to the bot / receives its result) so `measured()` records
   it correctly.
4. Emits its own measurement record — either by having this Lambda itself call `measured()`
   directly, or by having Connect invoke `lambdas/facility-info/` as a **separate** step after
   Lex returns the intent, mirroring S-01's Invoke-block shape. The former keeps one Lambda in
   the request path (simpler, matches the "byte-identical" framing); the latter keeps
   `facility-info` as the single reused artifact across both variants at the cost of Lex needing
   to hand control back to the flow rather than closing the intent itself. This is a real
   architectural decision the plan needs to make, not something this research resolves.

### 5. Repeat and agent-transfer semantics differ structurally, not just mechanically

FR-003 (repeat) is flagged in the roadmap as **costing more in S-02 than S-01**: "replaying a
prompt is trivial, holding the last spoken message in per-call state is not"
([roadmap.md:227-230](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/roadmap.md#L227-L230)).
Lex V2 supports **session attributes** that a fulfillment Lambda can read/write across turns
within one bot session — the direct analogue of the contact flow's `lastMessageText` contact
attribute, but scoped to the Lex session rather than the Connect contact. The plan should decide
whether this is a Lex session attribute set by every intent that "speaks", read by
`RepeatIntent`'s fulfillment, or whether it round-trips through Connect contact attributes (so
it composes with the existing `lastMessageText` contract surface entry rather than duplicating
it). The PRD explicitly wants this asymmetry **measured, not smoothed over** — so whichever
mechanism is chosen, its cost (lines of Lambda code / config, not just "it works") is worth
noting for the eventual write-up.

`AgentTransferIntent`'s fulfillment needs to route the Connect contact to the same transfer
target (`BasicQueue`) S-01 uses for its digit-`0` transfer, and FR-006's three-strikes rule
needs a counter — likely a session attribute incremented on every `FallbackIntent` hit, checked
in the fulfillment Lambda, with the third strike closing the intent in a way the contact flow
recognizes and routes to transfer (mirroring S-01's combined invalid-keypress/timeout counter,
[context/archive/2026-08-29-facility-info-keypad/plan.md:337-339](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/archive/2026-08-29-facility-info-keypad/plan.md#L337-L339)).

### 6. Testing conventions to carry forward

S-01's Lambda test pattern —`node:test`, `mock.method(globalThis, 'fetch', ...)`,
`captureRecords()` intercepting `console.log`, asserting flat-string-map shape and exactly-one
measurement record —
([lambdas/facility-info/index.test.ts:1-71](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/facility-info/index.test.ts#L1-L71))
is the shape any new fulfillment Lambda's tests should mirror, substituting a Lex event fixture
for the Connect `event.sample.json` this one uses. `package.json`'s shape
([lambdas/facility-info/package.json](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/lambdas/facility-info/package.json)) —
`type: module`, `node --test`, `@pcm/measure` as the only runtime dependency — is the template
for a new `lambdas/*` package under the existing npm workspace
([package.json:3](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/package.json#L3)).

CDK infra assertions from S-01
([context/archive/2026-08-29-facility-info-keypad/plan.md:284-294](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/archive/2026-08-29-facility-info-keypad/plan.md#L284-L294))
assert Connect-permission and integration-association resources via `Template.fromStack`; the
`AwsCustomResource`-based bot association is **not** a CFN resource `Template.fromStack` can
assert as cleanly — the plan should decide what, if anything, is worth asserting here (likely:
the custom resource's IAM policy statements, and that the bot/alias/version resources
synthesize).

### 7. F-03 spike constraints — mostly inapplicable, one is not

The four usability constraints found by the spike
([context/archive/2026-08-26-lex-keypad-capture-spike/findings.md:64-96](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/archive/2026-08-26-lex-keypad-capture-spike/findings.md#L64-L96))
were about DTMF slot capture (PESEL) — S-02 has no slots and no DTMF, so constraints 1, 3, and 4
(decline-disconnects, short-DTMF inconsistency, spoken-digits-not-filling-slot) don't transfer.
**Constraint 2 does transfer**: "re-asks repeat the prompt verbatim, with no 'that didn't
work' framing" is a property of Lex's default retry behavior generally, not just DTMF slots —
S-02's `FallbackIntent` re-asks (leading up to the third-strike transfer) will have the same
silent-repeat property unless the fulfillment Lambda explicitly varies the re-ask message. Worth
a deliberate decision in the plan, not an oversight discovered during build.

Locale confirmation from the spike carries forward directly: `pl_PL` in `eu-central-1` is
confirmed live
([context/archive/2026-08-26-lex-keypad-capture-spike/findings.md:14-34](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/archive/2026-08-26-lex-keypad-capture-spike/findings.md#L14-L34)) —
no new locale-availability risk for S-02.

### 8. PRD acceptance criteria S-02 must satisfy (US-01)

([context/foundation/prd.md:112-124](https://github.com/KStrzechowski/PhoneConnect-Med/blob/f3dc6d61d52eaf4c1ae8816fbb3813dbb8a9269d/context/foundation/prd.md#L112-L124)):

- Reaches the answer without a menu or keypress — satisfied structurally by using Lex intents
  rather than a `Get Customer Input` menu block.
- Answer retrieved through shared business logic, not hard-coded in the language-understanding
  layer — the fulfillment Lambda must call the shared endpoint, never compose facility data
  itself.
- Request latency recorded for this path — `measured()` already does this once `variant:
  "speech"` is set correctly.
- Three unrecognized utterances → transfer (FR-006) — needs the session-attribute counter
  described in §5.
- Per-call record notes path and outcome (FR-008) — already satisfied by `measured()`'s existing
  shape once invoked correctly.

## Code References

- `his/src/facility/facility.controller.ts:1-13` — unauthenticated `GET /facility`, reused as-is
- `his/src/facility/facility.service.ts:1-17` — single seeded row lookup, reused as-is
- `his/src/facility/facility.entity.ts:1-22` — structured fields (no pre-composed sentence),
  language-neutral by design
- `lambdas/facility-info/index.ts:1-33` — the exact downstream call S-02's fulfillment must reach
- `lambdas/facility-info/index.test.ts:1-71` — test pattern template for the new Lambda
- `lambdas/measure/index.ts:15,21-49` — `variant: 'keypad' | 'speech'` already typed; no change
  needed
- `docs/reference/contract-surfaces.md:7-42` — `variant`, `lastMessageText`, reserved digits;
  `speech` already an allowed value
- `context/foundation/lex-sample-utterances.md:11-93` — frozen global-layer intents/utterances
  S-02 must transcribe into the bot definition verbatim
- `infra/lib/infra-stack.ts:1-239` — current infra state; no Lex resources exist yet, both
  Lambdas already deployed and Connect-associated
- `infra/lib/spike-stack.ts` (deleted; recoverable at commit `6de3b7d`) — the proven CDK pattern
  for `CfnBot`/`CfnBotVersion`/`CfnBotAlias`/`AwsCustomResource` Connect association
- `context/foundation/prd.md:112-124` — US-01 acceptance criteria
- `context/foundation/roadmap.md:213-231` — S-02's own outcome/risk statement

## Architecture Insights

- **The shared-logic boundary is already correctly drawn.** S-01 put zero variant-awareness into
  `his/` or `lambdas/facility-info/` — both are pure functions of "give me the one facility
  row." S-02 doesn't need to touch either; it only needs a new caller.
- **The Connect↔Lex integration point, not the shared logic, is where S-02's real design
  decisions live**: where the fulfillment Lambda sits (does it call `facility-info` as a
  sub-call, or does Connect orchestrate two invokes — one to the bot, one to `facility-info` —
  the way S-01's flow does one), and how `variant`/repeat-state/attempt-count travel between Lex
  session state and Connect contact attributes.
- **Contract surfaces are additive, not replaced.** `variant` already supports `speech`;
  `lastMessageText` and reserved digits are keypad-only and don't need to change, but S-02 likely
  earns at least one new contract-surfaces.md entry for whatever repeat/attempt-count mechanism
  it invents on the Lex side, following the same "load-bearing name nothing in the repo enforces"
  pattern.
- **The training-data/build split established for the spike carries forward**: sample utterances
  are authored and frozen before the bot is built, and (per S-09's later constraint) must never
  be re-used as test-corpus utterances — that constraint is on `S-09`, not `S-02`, but is worth
  keeping in mind since `lex-sample-utterances.md` is a shared artifact touched again by later
  slices (`caller-id-authentication`, `appointment-booking-both-variants`) that add their own
  intents to the same bot.

## Historical Context (from prior changes)

- `context/archive/2026-08-29-facility-info-keypad/plan.md` — full S-01 plan; the pattern every
  phase of S-02 mirrors (persistence untouched, Lambda shape, infra shape, contact-flow-as-prose
  convention, phased verification with pause points).
- `context/archive/2026-08-29-facility-info-keypad/plan-brief.md` — condensed decision table;
  useful as a template for S-02's own plan-brief.
- `context/archive/2026-08-26-lex-keypad-capture-spike/findings.md` — the only prior exploration
  of Lex V2 + Connect in this repo; source of the CDK pattern and the one transferable usability
  constraint (§7 above).
- `context/foundation/roadmap.md` §S-02 — the authoritative scope statement, prerequisites (S-01,
  done), and the byte-identical-answer guardrail.

## Related Research

- None yet under `context/changes/**/research.md` covers Lex bot construction directly other than
  the spike's own findings document (which is a findings artifact, not a `research.md`).

## Open Questions

1. **Where does S-01's exact Polish sentence template live?** It was never committed (contact
   flows are hand-built, out of IaC). The plan/implementation step needs to retrieve the live
   wording from the S-01 console flow before composing S-02's fulfillment message, or the
   byte-identical guardrail cannot be verified by inspection — only by listening to both.
2. **Single-Lambda vs two-invoke architecture** (§4, point 4): does the `InfoIntent` fulfillment
   Lambda call `facility-info`'s logic directly (factored into a shared module both Lambdas
   import), or does Connect invoke `facility-info` as a distinct step after Lex resolves the
   intent, matching S-01's own Invoke-block shape more closely? This is a real decision for
   `/10x-plan`, not something resolvable from existing artifacts alone.
3. **Session-attribute mechanism for repeat and attempt-count** (§5): Lex session attributes vs.
   Connect contact attributes (reusing `lastMessageText`) — needs a decision before Phase-level
   implementation, and whichever is chosen likely earns a new `contract-surfaces.md` entry.
4. **Contact-flow-not-committed precedent**: does S-02 also hand-build its flow in the console
   (continuing F-01/S-01's convention), or does introducing a Lex bot change that calculus enough
   to warrant committing the bot definition as CDK (which the spike already did, unlike the
   flow)? The spike committed the *bot* as CDK but not the *flow*; S-02 likely follows the same
   split, but this should be stated explicitly in the plan rather than assumed.
