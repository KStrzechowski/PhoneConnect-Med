# Lex Language Detection Spike Implementation Plan

## Overview

A throwaway mechanism, defined in CDK and driven by a hand-built contact flow, answers one
question on the real test number: can Variant B (the natural-language bot) detect which language
the caller is speaking from their **first utterance alone**, and carry that utterance's actual
content — not just its language — into the bot's first real turn, without asking the caller to
repeat themselves?

The question is load-bearing because of what depends on the answer, not because of the mechanism.
Chapter 3, §3.2.2 of the source thesis states — twice — that Variant B's service language "jest
wykrywany automatycznie na podstawie pierwszej wypowiedzi pacjenta, bez konieczności jawnego
wyboru" (is detected automatically from the patient's first utterance, with no explicit choice),
and names this as the key difference from Variant A's menu structure. `english-locale` (S-10) is
blocked on this: a DTMF language prompt in front of Variant B would directly contradict that
sentence, and chapter 3's own worked example ("chcę umówić się do kardiologa na przyszły tydzień
rano") has the first utterance carrying a full booking request, not just a language signal — so a
design that captures language and then discards the utterance would also inflate turns-to-
completion, one of the project's own comparison metrics.

No native Lex V2 or Amazon Connect feature does this. The mechanism has to be assembled from
Kinesis Video Streams (KVS) live media capture, Amazon Transcribe streaming with
`IdentifyLanguage`, and a `RecognizeText` hand-off into the correctly-localized Lex bot. The spike
confirms this mechanism works. It does not build `english-locale`'s menus, flows, or intents.

## Current State Analysis

- **The Lex bot has one locale today.** `const speechLocale = 'pl_PL'` (`infra/lib/infra-stack.ts:16`).
  No second locale, no language-routing mechanism, exists anywhere in the codebase.
- **Region is `eu-central-1`** (`infra/bin/infra.ts` — `env.region`), same as F-03. Whether
  Transcribe streaming's `IdentifyLanguage` supports the `pl-PL`/`en-US` pair in this region has
  never been checked.
- **No proven Node.js/TypeScript path exists for this.** The only AWS reference implementation for
  consuming live call audio from KVS (`amazon-connect/amazon-connect-realtime-transcription`) is
  Java, uses the Java-only Kinesis Video Streams Parser Library, and was archived by its owner in
  March 2023. It also only does fixed-language transcription, not `IdentifyLanguage`. Every Lambda
  in this codebase is Node.js/TypeScript (`lambdas/*/package.json`); whether KVS's fragment
  container format is practically parseable from TypeScript without that library is the single
  biggest unknown this spike carries, bigger than the language-detection question itself.
- **Connect's Lambda invoke timing is fixed and documented.** A synchronous `Invoke AWS Lambda
  function` block caps at 8 seconds; asynchronous caps at 60 seconds and pairs with a `Wait` block
  plus `Load Lambda Result` (AWS Connect Customer docs, `invoke-lambda-function-block.html`).
  Transcribe needs a minimum of ~3 seconds of audio to identify a language reliably, before cold
  start and KVS fragment-availability lag — synchronous mode is too tight; this spike uses
  asynchronous mode from the start.
- **The repo already has the Connect-association and throwaway-stack pattern.** F-03
  (`context/archive/2026-08-26-lex-keypad-capture-spike/`) proved the `AwsCustomResource`
  association shape, the alias/version/locale dependency ordering, and the "spike stack alongside
  `InfraStack` in the same CDK app" structure. This plan reuses that shape rather than
  rediscovering it.
- **`pl_PL` sample utterances already exist for reuse** — `context/foundation/lex-sample-utterances.md`
  (`AuthIntent`, `InfoIntent`). F-03 reused `AuthIntent`'s utterances for its throwaway intent;
  this spike does the same for its Polish side, and authors a small throwaway English-equivalent
  set for its English side (explicitly not the real `english-locale` training data — see What
  We're NOT Doing).
- **`InfraStack` hard-requires `connectInstanceArn` context** and throws without it
  (`infra/lib/infra-stack.ts`), same constraint F-03 worked within.

## Desired End State

A verdict exists, in writing, where `english-locale` will look for it: `findings.md` in this
folder carries one of **confirmed**, **confirmed-with-constraints**, or **refuted**, backed by the
call matrix and the working CDK/Lambda fragments for both halves of the mechanism (language
detection, and the `RecognizeText` session hand-off). The roadmap carries a new Foundation item for
this spike, and S-10's Prerequisites name it. Nothing the spike created is still running on the
Connect instance or costing money afterward.

Verified by: reading `findings.md` and being able to plan `english-locale`'s language-routing
phase from it without making another phone call.

### Key Discoveries:

- **The caller's first utterance has to survive into Lex's NLU, not just yield a language code.**
  Transcribe streaming with `IdentifyLanguage` produces a transcript as well as a language code
  from the same audio — feeding that transcript into `RecognizeText` against the identified
  locale's bot means the utterance is neither wasted nor requires a re-ask. This turns the spike
  into two dependent questions rather than one: does language detection work, and does the
  resulting `RecognizeText` call's session carry forward correctly into a subsequent
  Connect-native `Get Customer Input (Lex)` block for the rest of the call.
- **Connect's Lex session-ID contract for its native block is not documented publicly** in a form
  this plan can cite. If the `RecognizeText` call (made from inside the spike Lambda) doesn't use
  whatever session identifier Connect's own `Get Customer Input (Lex)` block will later use for
  the same contact, the caller's filled slots and session attributes vanish the moment the flow
  hands off to the native block — silently, not as an error. This is Phase 4's actual question.
- **Synchronous Lambda invoke is too tight; asynchronous plus `Wait` plus `Load Lambda Result` is
  the only workable pattern** given the 8-second synchronous cap versus Transcribe's ~3-second
  minimum plus real-world latency.
- **The only existing reference implementation is Java and archived.** Phase 1 exists specifically
  to de-risk this before any CDK or contact-flow work happens, mirroring how F-03's Phase 1
  checked Polish locale availability before writing a bot.
- **`allowDtmfInput`/prompt-attempt gotchas from F-03 don't apply here** — this spike's intents are
  audio-only; no DTMF slot is involved.

## What We're NOT Doing

- **Not building `english-locale`'s real menus, flows, or intents.** No booking, no auth, no
  cancel/reschedule English support. One throwaway intent per locale, enough to prove NLU runs
  after the hand-off.
- **Not authoring `english-locale`'s real training data.** The English utterances written for this
  spike are throwaway and are not to be lifted verbatim into the real bot's `en_US` locale later —
  they exist only to give the spike's English-side intent something to recognize.
- **Not measuring transcription-quality parity** between Transcribe (turn one) and Lex's own ASR
  (later turns) — per the scoping decision, this spike judges the mechanism (language detected
  correctly, `RecognizeText` produces a sane response, session state carries forward), and notes
  transcription quality only anecdotally in `findings.md`, not as a pass/fail criterion.
- **Not testing mid-call language switching.** Chapter 3 specifies detection from the *first*
  utterance only; a caller switching languages mid-call is out of scope for the thesis's own claim
  and for this spike.
- **Not touching the Lambda layer, the mock, or F-02's measurement substrate.** No `@pcm/*`
  package is used; no `InvocationRecord` is emitted. Wiring this into measurement would be scope
  creep on a throwaway, same reasoning F-03 recorded.
- **Not codifying the contact flow.** Flow JSON is a spike input in this folder, imported by hand,
  per the project's standing decision that flows are console-built (roadmap §Parked).
- **Not deciding `english-locale`'s counting rule, booking-parity depth, or global-command
  translation scope.** Those are open in `context/changes/english-locale/change.md` and get
  resolved when that plan is written, informed by this spike's verdict.

## Implementation Approach

Five phases, front-loading the two things that can invalidate everything after them, same
discipline F-03 used.

Phase 1 checks whether a Node.js/TypeScript path to consume KVS audio and drive Transcribe
streaming with `IdentifyLanguage` exists at all, and whether `pl-PL`/`en-US` are a valid
`IdentifyLanguage` candidate pair in `eu-central-1` — **before** any CDK or Lambda code is
written, because either one failing is a larger finding than the spike's own question and would
mean reconsidering the mechanism entirely (a Java-based sidecar, a different service, or
escalating back to a DTMF-based fallback for Variant B with the resulting thesis deviation
recorded).

Phase 2 builds the throwaway stack: a two-locale (`pl_PL`/`en_US`) Lex bot, the spike Lambda
(KVS consumer + Transcribe streaming + `RecognizeText` hand-off), and deploys it.

Phase 3 is the call matrix: does the mechanism correctly detect language and produce a sane
`RecognizeText` response across the ~8-10 calls budgeted (Polish opener, English opener, a full
one-sentence request in each language, one deliberately ambiguous/short opener, repeated where the
first attempt is inconclusive).

Phase 4 is the second half of the real question: does the session that `RecognizeText` established
actually carry into a subsequent Connect-native `Get Customer Input (Lex)` block, so the rest of
the call continues without the caller repeating themselves.

Phase 5 converts calls into a decision, writes it where `english-locale` reads, syncs the roadmap,
and only then destroys anything.

## Critical Implementation Details

**Asynchronous invoke is not optional.** The spike Lambda's own work (KVS `GetMedia`, buffering
~3-5 seconds of audio, opening a Transcribe streaming session, waiting for the identified-language
event) cannot reliably complete inside a synchronous block's 8-second cap once cold start and KVS
fragment-availability lag are accounted for. Use `Invoke AWS Lambda function` in Asynchronous mode,
a `Wait` block (~5-6 seconds, covering a short neutral filler prompt), then `Load Lambda Result`.

**The `RecognizeText` call's session ID must match whatever Connect's native Lex block will use
for the same contact, or Phase 4 fails silently.** This is not assumed — it's what Phase 4 tests.
If Connect's native block does not expose or accept a caller-supplied session ID for one bot alias
that continues a session ID a Lambda already used against the same alias, the fallback (documented
in `findings.md` if it comes to that) is to have the spike Lambda itself call `RecognizeText` a
second time for the caller's *next* utterance too, i.e. keep every subsequent turn Lambda-driven
rather than handing off to a native block at all — a larger, costlier design than the plan assumes,
and worth naming as a possible verdict outcome rather than discovering it only after building
`english-locale`'s real flow.

**KVS delivers an MKV-fragmented container, not raw PCM.** Phase 1's feasibility check is
specifically about whether extracting playable PCM frames from that container is practical from
TypeScript (via the AWS SDK v3 Kinesis Video Media client plus either a matroska-parsing npm
package or hand-rolled parsing of the fragment headers) within the time this spike has budgeted. If
Phase 1 concludes this isn't practical in the time available, the spike stops there and escalates
rather than attempting a partial Phase 2.

**Transcribe streaming's `IdentifyLanguage` requires an explicit `LanguageOptions` candidate list**
(not open-ended detection across all supported languages) — Phase 1 confirms `pl-PL` and `en-US`
can both be named in that list for a single streaming session in `eu-central-1`.

## Phase 1: Feasibility check — before writing any code

### Overview

Confirm, in isolation, that (a) Transcribe streaming's `IdentifyLanguage` accepts a
`pl-PL`/`en-US` candidate pair in `eu-central-1`, and (b) a Node.js/TypeScript path exists to get
usable PCM audio out of a KVS stream and into that Transcribe session. Nothing about the contact
flow or the Lex bot is built in this phase.

### Changes Required:

#### 1. Transcribe language-pair check

**File**: none — an AWS CLI/SDK lookup, recorded in `findings.md`

**Intent**: Establish that `IdentifyLanguage`'s `LanguageOptions` accepts `['pl-PL', 'en-US']`
together for a streaming session in `eu-central-1`, before anything is built around the assumption.

**Contract**: A recorded confirmation (or refutation) in `findings.md`, with the exact API call or
documentation reference used. If the pair is unsupported, `findings.md` records that and Phase 2
does not run — the mechanism needs rethinking (a different language pair framing, or a different
detection approach) before `english-locale` can proceed at all.

#### 2. KVS-to-PCM feasibility spike (throwaway script, not committed)

**File**: none — a local, throwaway Node.js script, deleted after use; its outcome is recorded in
`findings.md`, not the script itself

**Intent**: Confirm that Kinesis Video Media's `GetMedia` output can be demuxed into PCM frames
from TypeScript within a reasonable effort budget, since the only public reference implementation
for this is Java and archived.

**Contract**: A recorded pass/fail in `findings.md`: either a working approach (naming the
technique or npm package used) or a documented refutation with what was tried. A refutation here
is the single largest possible finding of this entire spike — escalate rather than attempting
Phase 2 on an unproven audio path.

### Success Criteria:

#### Automated Verification:

- N/A — this phase is a research checkpoint with no code to commit

#### Manual Verification:

- `pl-PL` and `en-US` are confirmed as a valid `LanguageOptions` pair for Transcribe streaming
  `IdentifyLanguage` in `eu-central-1`, recorded in `findings.md`
- A working (or explicitly refuted) approach to extracting PCM audio from a KVS `GetMedia` stream
  in TypeScript is recorded in `findings.md`

**Implementation Note**: If either check fails, stop here, record the refutation, and do not
proceed to Phase 2 — see Desired End State and the roadmap sync in Phase 5 for how a refutation is
handled.

---

## Phase 2: The throwaway stack

### Overview

Build the two-locale Lex bot, the spike Lambda, and the contact-flow wiring that ties them
together, then deploy.

### Changes Required:

#### 1. Spike stack

**File**: `infra/lib/spike-stack.ts` (new — same path F-03 used and tore down)

**Intent**: A throwaway stack separate from `InfraStack` so `cdk destroy` removes it cleanly,
holding the two-locale bot, its version, alias, the spike Lambda, and the Connect association.

**Contract**: Exports `SpikeStack`, constructed like F-03's, reading the same `connectInstanceArn`
context value. Resources: a `CfnBot` with **two locales** (`pl_PL`, `en_US`), each carrying one
throwaway intent (Polish reuses `AuthIntent`'s existing sample utterances; English gets a small
new throwaway set — see Changes Required #3); a `CfnBotVersion` covering both locales; a
`CfnBotAlias` with text conversation logs; an `AwsCustomResource` associating the alias with the
Connect instance. All removal policies destroy.

#### 2. Spike Lambda

**File**: `lambdas/language-detect-spike/index.ts` (new workspace package)

**Intent**: Invoked asynchronously by the contact flow. Reads the contact's KVS stream, buffers
enough audio for `IdentifyLanguage` to resolve, opens a Transcribe streaming session with
`LanguageOptions: ['pl-PL', 'en-US']`, and once a language and transcript are available, calls Lex
Runtime V2's `RecognizeText` against the matching bot locale with that transcript. Returns the
detected language code and `RecognizeText`'s response (message text and session state) as its
payload.

**Contract**: Standalone package (`lambdas/language-detect-spike/package.json`, matching the
`type: module` / `node --test` / `esbuild` shape every other lambda package uses). Dependencies:
`@aws-sdk/client-kinesis-video`, `@aws-sdk/client-kinesis-video-media`,
`@aws-sdk/client-transcribe-streaming`, `@aws-sdk/client-lex-runtime-v2`. Does **not** depend on
`@pcm/measure` or any other shared package — this is a throwaway, per What We're NOT Doing.

#### 3. Throwaway English intent utterances

**File**: `context/changes/lex-language-detection-spike/spike-english-utterances.md` (new)

**Intent**: A small set of English sample phrases for the spike's `en_US` locale intent, enough
for `RecognizeText` to have something to recognize. Explicitly not `english-locale`'s real
training data.

**Contract**: 8-12 short English phrases mirroring the shape of the reused `AuthIntent` set (a
greeting/identification-style intent), authored fresh for this spike.

#### 4. Wire the stack into the app

**File**: `infra/bin/infra.ts`

**Intent**: Instantiate `SpikeStack` alongside `InfraStack`, matching F-03's precedent.

**Contract**: A second stack instantiation named `PhoneConnect-Med-SpikeStack`.

#### 5. Contact flow JSON

**File**: `context/changes/lex-language-detection-spike/spike-flow.json` (new)

**Intent**: Greet, start media streaming, invoke the spike Lambda asynchronously, wait, load its
result, branch on the detected language, hand off into the matching bot locale via a native
`Get Customer Input (Lex)` block seeded with the session `RecognizeText` already established, read
back what the second turn captured, stop media streaming, disconnect.

**Contract**: Connect flow export format, written to be imported then freely tweaked in the
console — same convention as F-03's `spike-flow.json`. Lives in this change folder, not in
`infra/`.

#### 6. Template assertions

**File**: `infra/test/spike-stack.test.ts` (new)

**Intent**: Assert the properties easy to get wrong and invisible until a call is made — both bot
locales present, text-only conversation logs, the spike Lambda's async-compatible configuration.

**Contract**: Follows `infra/test/infra.test.ts`'s `Template.fromStack` pattern with the same fake
`connectInstanceArn`.

### Success Criteria:

#### Automated Verification:

- CDK synthesises with the spike stack present: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- `npm test --workspace lambdas/language-detect-spike` passes
- Template asserts both `pl_PL` and `en_US` locales exist on the bot
- Template asserts the alias has text conversation logs
- Infra tests pass: `cd infra && npm test`

#### Manual Verification:

- `cdk deploy PhoneConnect-Med-SpikeStack` completes and both bot locales reach Built
- The alias appears in the Connect instance's associated bots
- The flow imports into the Connect console without validation errors
- Calling the test number reaches the flow and the initial filler prompt plays

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: The call matrix — does detection work

### Overview

The budgeted 8-10 real calls, each read back off the text conversation log and the Lambda's
CloudWatch logs, answering: does the mechanism detect the right language and produce a sane
`RecognizeText` response.

### Changes Required:

#### 1. Call matrix results

**File**: `context/changes/lex-language-detection-spike/findings.md`

**Intent**: Record what each call did as it happens, same discipline F-03 used — small timing and
wording details are lost if reconstructed from memory afterward.

**Contract**: One row per call: what was said, which language was expected, which language was
detected, what `RecognizeText` returned, and whether the outcome is acceptable. Calls: a plain
Polish opener; a plain English opener; a full one-sentence Polish booking request (specialty +
time-of-day, mirroring chapter 3's own example); a full one-sentence English booking request; a
short/ambiguous opener (e.g. "halo"); remaining calls repeat whichever row is inconclusive on
first attempt.

### Success Criteria:

#### Manual Verification:

- A plain Polish opener is detected as `pl-PL`
- A plain English opener is detected as `en-US`
- A full one-sentence Polish booking request is detected as `pl-PL` and `RecognizeText` returns a
  `BookingIntent`-shaped response (or the throwaway intent's equivalent) with slots reflecting what
  was said, not a generic fallback
- A full one-sentence English booking request does the same in English
- The ambiguous/short opener's outcome is recorded, whatever it is — a wrong or unresolved result
  here is a real finding, not a spike failure
- Every row's outcome is reconstructable from the text conversation log and Lambda logs, not only
  from memory

**Implementation Note**: If language detection itself doesn't work reliably, record that as the
verdict now and skip to Phase 5 — Phase 4 characterises a mechanism that detects language
correctly and has nothing useful to say about one that doesn't.

---

## Phase 4: Session continuity — does the hand-off survive

### Overview

For each call in Phase 3 that reached a sane `RecognizeText` response, continue the flow into a
native `Get Customer Input (Lex)` block and check whether the caller can proceed without repeating
themselves.

### Changes Required:

#### 1. Continuity results

**File**: `context/changes/lex-language-detection-spike/findings.md`

**Intent**: Record, per call, whether the native Lex block picked up the same session (filled
slots and session attributes intact) or started fresh.

**Contract**: Extends the call matrix with a continuity column per row: whether the flow's native
`Get Customer Input (Lex)` turn saw the state `RecognizeText` established, and if not, what it saw
instead (a fresh, empty session; an error; something else).

### Success Criteria:

#### Manual Verification:

- At least one call where `RecognizeText` filled a slot (e.g. specialty from a full booking
  sentence) shows that slot still filled when the native Lex block's turn begins
- Where continuity fails, the failure mode is recorded precisely enough that `english-locale` can
  decide between fixing the session-ID contract and keeping every turn Lambda-driven instead (see
  Critical Implementation Details)

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Verdict, hand-off, teardown

### Overview

Turn the calls into a decision, put it where `english-locale` reads, sync the roadmap, and only
then destroy anything.

### Changes Required:

#### 1. The verdict

**File**: `context/changes/lex-language-detection-spike/findings.md`

**Intent**: State one of three verdicts and, where it is not a clean confirmation, cost the
fallback options against what `english-locale` would otherwise assume.

**Contract**: The document carries a line reading exactly `Verdict: confirmed`,
`Verdict: confirmed-with-constraints` (naming each constraint and what `english-locale` must do
about it), or `Verdict: refuted` (naming the fallback: DTMF selection for Variant B too, recorded
as a deviation from chapter 3 §3.2.2, per the project's existing pattern of recording deviations
from the source thesis). The document carries the working CDK/Lambda fragments for both halves of
the mechanism so `english-locale` lifts them rather than rederiving them.

#### 2. Roadmap sync — new Foundation item

**File**: `context/foundation/roadmap.md`

**Intent**: This spike is a Foundation item in the same sense F-01–F-03 are — it unblocks a slice
(S-10) rather than delivering user-visible outcome itself.

**Contract**: Add `### F-04: Automatic language detection from the caller's first utterance
confirmed` to `## Foundations`, following F-03's structure (Outcome, Change ID, PRD refs,
Unlocks, Prerequisites, Blockers, Unknowns, Risk, Status). Add a row to `## At a glance`. Add
`F-04` to S-10's `- **Prerequisites:**` line (currently `S-05`) and to the `## Streams` Stream D
chain. Bump frontmatter `updated:`.

#### 3. Contract surface, if one was earned

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register any name settled here that will cross the console/hand-built-flow boundary in
`english-locale`'s real build — the session-ID contract discovered in Phase 4 is the most likely
candidate.

**Contract**: An entry only if `english-locale` will genuinely carry a name across a boundary
nothing in the repo enforces. If nothing qualifies, `findings.md` records that no surface was
earned.

#### 4. Teardown

**File**: `infra/lib/spike-stack.ts`, `infra/bin/infra.ts`, `infra/test/spike-stack.test.ts`,
`lambdas/language-detect-spike/`

**Intent**: Return the Connect instance to clean, and stop the throwaway English intent and
conversation logs from outliving the spike.

**Contract**: `cdk destroy PhoneConnect-Med-SpikeStack` removes the bot, alias, log group, spike
Lambda, and Connect association. The console flow is deleted and the test number returned to what
it pointed at before. The spike files are deleted and the instantiation removed from
`infra/bin/infra.ts`, after which `cdk synth` still succeeds. Gated on `findings.md` being
committed first.

### Success Criteria:

#### Automated Verification:

- `findings.md` carries exactly one `Verdict:` line, and its value is one of the three
- The roadmap carries `F-04` in both `## At a glance` and `## Foundations`, and S-10's
  Prerequisites name it
- After teardown, CDK synthesises with no spike stack: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Infra tests pass after the spike test file and workspace are removed: `cd infra && npm test`

#### Manual Verification:

- `findings.md` carries the working CDK/Lambda fragments for both halves of the mechanism
- Where the verdict is not a clean confirmation, the fallback is costed, including the
  chapter-3-deviation framing if the verdict is refuted
- `contract-surfaces.md` carries an entry, or `findings.md` records why none was earned
- Findings are committed before anything is destroyed
- `cdk destroy` completes and the bot no longer appears in the Connect instance's associated bots
- The console flow is deleted and the test number points where it did before
- The conversation log group is gone

---

## Testing Strategy

The spike's test suite is the call matrix; there is nothing else to test end-to-end. The CDK
template assertions in Phase 2 and the Lambda's own unit tests (mocking the KVS/Transcribe/Lex
Runtime SDK clients) exist only to catch misconfigurations invisible until a call is placed —
missing locale, wrong conversation-log settings, a malformed `RecognizeText` payload shape.

### Unit Tests:

- The spike Lambda's language-to-locale mapping and its `RecognizeText` payload construction,
  with the AWS SDK clients mocked — no real KVS or Transcribe call in the test suite

### Manual Testing Steps:

1. Call the test number, open in Polish, confirm `pl-PL` is detected and the response is sane.
2. Repeat in English, confirm `en-US` is detected.
3. Repeat with a full one-sentence booking request in each language, confirm slots are filled.
4. Repeat with a short/ambiguous opener, record whatever happens.
5. For each call that reached a sane response, continue past the hand-off and confirm the native
   Lex turn does or doesn't see the same session.

Each call's outcome goes into `findings.md` before the next one is placed.

## Cost and call budget

~8-10 real calls, per the scoping decision. Same dial-in-cost-is-personal caveat F-03 recorded. New
cost surfaces versus F-03: Kinesis Video Streams storage/retrieval and Transcribe streaming
minutes, both small at this call volume but genuinely new line items — not previously part of this
project's spend.

## References

- Source thesis requirement: `thesis-drafts/Praca_Magisterska_Konrad_Strzechowski_v3.0.pdf`,
  chapter 3 §3.2.2 (Wariant B — Przepływ IVR sterowany głosowym NLU)
- Roadmap S-10 entry and Open Roadmap Question 2: `context/foundation/roadmap.md`
- Why DTMF-for-Variant-B was rejected, and why Agentic CX / Nova Sonic were rejected: this change's
  `change.md`
- F-03 structure and precedent this plan mirrors: `context/archive/2026-08-26-lex-keypad-capture-spike/`
- Connect Lambda invoke timing: AWS Connect Customer docs, `invoke-lambda-function-block.html`
  (synchronous 8s cap, asynchronous 60s cap)
- KVS-to-Transcribe reference (Java, archived, fixed-language only):
  `amazon-connect/amazon-connect-realtime-transcription` on GitHub
- Consumer of the verdict: `context/changes/english-locale/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Feasibility check — before writing any code

#### Manual

- [ ] 1.1 `pl-PL` and `en-US` are confirmed as a valid `LanguageOptions` pair for Transcribe streaming `IdentifyLanguage` in `eu-central-1`, recorded in `findings.md`
- [ ] 1.2 A working (or explicitly refuted) approach to extracting PCM audio from a KVS `GetMedia` stream in TypeScript is recorded in `findings.md`

### Phase 2: The throwaway stack

#### Automated

- [x] 2.1 CDK synthesises with the spike stack present — 8cf61c0
- [x] 2.2 `npm test --workspace lambdas/language-detect-spike` passes — 8cf61c0
- [x] 2.3 Template asserts both `pl_PL` and `en_US` locales exist on the bot — 8cf61c0
- [x] 2.4 Template asserts the alias has text conversation logs — 8cf61c0
- [x] 2.5 Infra tests pass — 8cf61c0

#### Manual

- [ ] 2.6 `cdk deploy` completes and both bot locales reach Built
- [ ] 2.7 The alias appears in the Connect instance's associated bots
- [ ] 2.8 The flow imports into the Connect console without validation errors
- [ ] 2.9 Calling the test number reaches the flow and the initial filler prompt plays

### Phase 3: The call matrix — does detection work

#### Manual

- [ ] 3.1 A plain Polish opener is detected as `pl-PL`
- [ ] 3.2 A plain English opener is detected as `en-US`
- [ ] 3.3 A full one-sentence Polish booking request is detected as `pl-PL` with slots filled
- [ ] 3.4 A full one-sentence English booking request is detected as `en-US` with slots filled
- [ ] 3.5 The ambiguous/short opener's outcome is recorded
- [ ] 3.6 Every row's outcome is reconstructable from the text conversation log and Lambda logs

### Phase 4: Session continuity — does the hand-off survive

#### Manual

- [ ] 4.1 At least one call shows a `RecognizeText`-filled slot still intact in the native Lex block's turn
- [ ] 4.2 Where continuity fails, the failure mode is recorded precisely enough to decide the fallback

### Phase 5: Verdict, hand-off, teardown

#### Automated

- [ ] 5.1 `findings.md` carries exactly one `Verdict:` line with one of the three values
- [ ] 5.2 The roadmap carries `F-04` in `## At a glance` and `## Foundations`, and S-10's Prerequisites name it
- [ ] 5.3 After teardown, CDK synthesises with no spike stack
- [ ] 5.4 Infra tests pass after the spike test file and workspace are removed

#### Manual

- [ ] 5.5 `findings.md` carries the working CDK/Lambda fragments for both halves of the mechanism
- [ ] 5.6 Where the verdict is not a clean confirmation, the fallback is costed, including the chapter-3-deviation framing if refuted
- [ ] 5.7 `contract-surfaces.md` carries an entry, or `findings.md` records why none was earned
- [ ] 5.8 Findings are committed before anything is destroyed
- [ ] 5.9 `cdk destroy` completes and the bot no longer appears in the Connect instance's associated bots
- [ ] 5.10 The console flow is deleted and the test number points where it did before
- [ ] 5.11 The conversation log group is gone
