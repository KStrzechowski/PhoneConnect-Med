# Lex Keypad Capture Spike Implementation Plan

## Overview

Roadmap item **F-03**. A throwaway Lex V2 bot, defined in CDK and driven by a hand-built contact
flow, is called on the real test number to answer one question: can the natural-language variant
collect an 11-digit PESEL on the keypad **inside a conversational turn**, and then carry on in
speech, without bouncing the caller out to a separate input step?

The question is load-bearing because of what depends on the answer, not because of the feature.
PRD §Authentication resolves FR-005 by capturing PESEL on the keypad in **both** variants, so
identity capture cannot explain any measured difference between them. If Wariant B has to leave
the bot to collect digits, the two variants no longer capture identity identically and the
authenticated half of the comparison is confounded for reasons unrelated to the hypothesis.
S-03 (`caller-id-authentication`) is blocked on this.

The spike confirms a mechanism. It does not build authentication.

## Current State Analysis

- **Nothing exists in the cloud beyond the Connect instance and the claimed test number** —
  no bot, no contact flow, no deployed function (`context/foundation/roadmap.md:111`).
- **F-01 and F-02 have never been deployed.** Every automated step of both landed; every manual
  verification step is unchecked. This spike is planned so that it depends on neither: no
  Lambda, no mock, no round trip.
- **The DTMF mechanism is expressible in the pinned CDK.** `aws-cdk-lib@^2.265.0` carries
  `CfnBot` (`aws-lex/lib/lex.generated.d.ts:17`), `CfnBotVersion` (`:3951`) and `CfnBotAlias`
  (`:3472`). `AllowedInputTypesProperty` has required `allowAudioInput` and `allowDtmfInput`
  booleans (`:1746`, `:1752`); `DTMFSpecificationProperty` has `deletionCharacter`,
  `endCharacter`, `endTimeoutMs`, `maxLength` (`:1790`); `CfnBotAlias.ConversationLogSettings`
  has `textLogSettings` and `audioLogSettings` (`:3721`). So the spike tests *behaviour on a
  call*, not whether an API exists.
- **The repo already has the Connect-association pattern.** `infra/lib/infra-stack.ts:104-124`
  associates a Lambda with the Connect instance through an `AwsCustomResource`, with the console
  fallback recorded in `context/changes/aws-deployment-baseline/change.md`. The bot association
  is the same shape against a different API.
- **`InfraStack` hard-requires `connectInstanceArn` context** and throws without it
  (`infra/lib/infra-stack.ts:83-89`), asserted by `infra/test/infra.test.ts:81`.
- **Sample utterances for the entry intent already exist** —
  `context/foundation/lex-sample-utterances.md:100-112` (`AuthIntent`), authored before the test
  corpus by design. Reusing them keeps train/test separation intact.
- **Region is `eu-central-1`** (`infra/bin/infra.ts:6`), and this change is the project's first
  contact with Lex of any kind. Polish locale availability has never been checked.

## Desired End State

A verdict exists, in writing, where S-03 will look for it: `findings.md` in this folder carries
one of **confirmed**, **confirmed-with-constraints**, or **refuted**, backed by the text
conversation log of real calls and by the working `CfnBot` DTMF fragment. The roadmap's F-03 item
no longer says `proposed`, and its open Unknown is either closed or replaced by a costed
decision. Nothing the spike created is still running on the Connect instance.

Verified by: reading `findings.md` and being able to plan S-03's identity capture from it
without making another phone call.

### Key Discoveries:

- **DTMF exists only on the telephony channel.** Lex's console test window and the
  `RecognizeText` API cannot exercise it. Every DTMF finding in this plan therefore requires a
  real phone call, which is why Phase 1 deliberately claims nothing about DTMF.
- **`allowDtmfInput` is set per prompt *attempt*, not per slot.**
  `PromptAttemptSpecificationProperty` (`aws-lex/lib/lex.generated.d.ts:1692`) is keyed by
  attempt, so configuring only the initial prompt leaves every re-ask silently audio-only. This
  is precisely the partial failure the pass bar exists to catch, and it is invisible until a
  caller mis-keys.
- **The bot alias, not the bot, is what Connect associates.** The association takes an alias
  ARN, an alias needs a version, and a version cannot be cut while a locale is still building —
  so the dependency chain has to be explicit, not inferred.
- **The spike stack shares the CDK app with `InfraStack`.** CDK constructs every stack in the
  app regardless of the deploy target, so `connectInstanceArn` must be supplied even when only
  the spike is being deployed. The spike needs the value anyway.
- **Idle cost is not the reason for teardown.** Lex bills per request, a contact flow costs
  nothing to exist, and the number bills per day whether or not the spike runs. Teardown is
  hygiene: a stale bot alias on the instance S-02 will build its real speech flow on, and
  conversation logs of keyed PESELs.

## What We're NOT Doing

- **Not building authentication.** No PESEL validation, no phone-number pairing, no attempt
  counting, no transfer-on-exhaustion, no caller-ID matching. Those are S-03.
- **Not chaining the full auth sequence.** One DTMF slot plus one spoken slot proves the turn
  handover. PESEL then phone then a 6-digit code across three attempts is S-03's design work.
- **Not touching the Lambda layer or the mock.** No fulfillment codehook, no round trip, no
  dependency on F-01 or F-02 having been deployed.
- **Not codifying the contact flow.** Flow JSON is a spike input in this folder, imported by
  hand, per the decision recorded in the roadmap's §Parked.
- **Not enabling audio conversation logs.**
- **Not measuring anything.** The spike produces no latency figures and no records for the
  A-vs-B comparison. Wiring it into F-02's measurement substrate would be scope creep on a
  throwaway.
- **Not building the keypad variant's equivalent.** Wariant A collects DTMF through Connect's
  own input block and has never been in doubt.

## Implementation Approach

Four phases, front-loading the two things that can invalidate everything after them.

Phase 1 checks Polish locale availability **before** any bot is written, because a missing
Polish locale is a far larger finding than F-03's own question and belongs on a throwaway in the
first hour rather than inside S-02. It then deploys the bot, claiming nothing about DTMF — which
is unprovable without a call.

Phase 2 is the answer to the roadmap's question: one call, eleven digits, correct readback, and
the session continuing into a spoken slot.

Phase 3 is the difference between "it works" and "S-03 can be built on it": the end character,
the correction character, the timeout, a short input, and a caller who speaks instead of
pressing. Each is one call, each read back off the text log.

Phase 4 converts calls into a decision, writes it where S-03 reads, and only then destroys
anything — the gate exists so a surprise can still be re-tested.

## Critical Implementation Details

**Prompt attempts, not slots.** Set `allowedInputTypes.allowDtmfInput` and the
`audioAndDtmfInputSpecification` on **every** attempt of the `pesel` slot's prompt
specification, not just the initial one. A configuration that covers only the first ask passes
Phase 2 and fails Phase 3 row four, and would fail in production the first time a caller
mis-keys a digit.

**Deploy ordering.** The Connect association depends on the alias, the alias on the version, and
the version on the bot's locale having finished building. CloudFormation will not infer the last
link from property references alone — make the version's dependency on the bot explicit, or the
first `cdk deploy` fails on a locale that is still building.

**Association API shape.** Connect associates a Lex V2 bot by alias ARN. Confirm the exact
parameter shape against the Connect API before deploying, and if the custom resource fights
back, associate in the Connect console instead and note it — the flow is console-built anyway,
so the fallback costs one click. This mirrors the precedent recorded in
`context/changes/aws-deployment-baseline/change.md`.

**Evidence is written down as each call ends, not afterwards.** Phase 3 is five calls whose
findings differ in small details — how long the timeout actually was, what the bot said on a
re-ask. Reconstructing that from memory after the fifth call is how a spike ends up needing a
sixth.

## Phase 1: Polish locale and the throwaway bot

### Overview

Confirm Polish is available, then deploy a Lex V2 bot with a DTMF-capable slot and associate its
alias with the Connect instance. Nothing about DTMF is provable in this phase.

### Changes Required:

#### 1. Locale availability check

**File**: none — a lookup, recorded in `context/changes/lex-keypad-capture-spike/findings.md`

**Intent**: Establish that Lex V2 offers a Polish locale in `eu-central-1` before any bot is
written. If it does not, stop and escalate: that outcome invalidates Wariant B's design and is a
bigger finding than the one this spike was opened for.

**Contract**: A locale identifier that Lex V2 accepts for a bot locale in this region, recorded
verbatim in `findings.md` along with where it was read. If Polish is unavailable, `findings.md`
records that instead and the remaining phases do not run.

#### 2. Spike stack

**File**: `infra/lib/spike-stack.ts` (new)

**Intent**: A throwaway stack holding the bot, its version, its alias with text conversation
logs, and the Connect association. Separate from `InfraStack` so `cdk destroy` can remove it
without touching the baseline.

**Contract**: Exports `SpikeStack`, constructed like `InfraStack` and reading the same
`connectInstanceArn` context value. Resources: a `CfnBot` with one locale, one intent and one
DTMF slot; a `CfnBotVersion`; a `CfnBotAlias` carrying `conversationLogSettings.textLogSettings`
pointed at a spike-owned log group with `RemovalPolicy.DESTROY`; an IAM role assumable by the
Lex V2 service principal; an `AwsCustomResource` associating the alias with the Connect
instance, with `onDelete` disassociating. All removal policies destroy — nothing in this stack
survives `cdk destroy`.

#### 3. The bot definition

**File**: `infra/lib/spike-stack.ts`

**Intent**: One intent that a Polish spoken utterance triggers, eliciting a DTMF `pesel` slot and
then a spoken confirmation slot. The speech-to-DTMF-to-speech shape is the point: a DTMF-only
bot would pass this spike while Wariant B still failed.

**Contract**: Intent sample utterances lifted from
`context/foundation/lex-sample-utterances.md:100-112` (`AuthIntent`), so the spike authors no new
training data and train/test separation holds. Slot `pesel`: a digit-bearing slot type,
`maxLength` 11, `endCharacter` `#`, `deletionCharacter` `*`, `allowDtmfInput` true on **every**
prompt attempt, `allowAudioInput` left true so Phase 3 row five can be observed. Slot 2: a
spoken yes/no confirmation, audio-only. Bot locale carries a Polish Polly voice and an explicit
`nluConfidenceThreshold`.

#### 4. Wire the stack into the app

**File**: `infra/bin/infra.ts`

**Intent**: Instantiate `SpikeStack` alongside `InfraStack` under the same env and project tag.

**Contract**: A second stack instantiation named `PhoneConnect-Med-SpikeStack`. Note that CDK
constructs every stack in the app, so deploying only the spike still requires
`connectInstanceArn`.

#### 5. Template assertions

**File**: `infra/test/spike-stack.test.ts` (new)

**Intent**: Assert the three properties that are easy to get wrong and invisible until a call is
made — the locale, DTMF on every prompt attempt, and text-only conversation logs.

**Contract**: Follows the existing `Template.fromStack` pattern in `infra/test/infra.test.ts`,
constructing the app with the same fake `connectInstanceArn`. Asserts: the bot locale id equals
the locale confirmed in change 1; every prompt attempt of the `pesel` slot allows DTMF input;
the alias has text log settings and no audio log settings.

### Success Criteria:

#### Automated Verification:

- CDK synthesises with the spike stack present: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Template pins the bot locale to the confirmed Polish locale
- Template sets DTMF input on every prompt attempt of the `pesel` slot
- Template gives the alias text conversation logs and no audio log settings
- Infra tests pass: `cd infra && npm test`

#### Manual Verification:

- Polish is listed as an available Lex V2 locale in `eu-central-1`, and the identifier is recorded in `findings.md`
- `cdk deploy PhoneConnect-Med-SpikeStack` completes and the bot locale reaches Built
- The alias appears in the Connect instance's associated bots
- The Lex console test window elicits the intent from a Polish utterance — speech recognition only, DTMF is not testable here

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: The flow, and the first successful call

### Overview

Import a contact flow that hands the caller to the spike bot and reads the captured slot back,
then make the call that answers the roadmap's question.

### Changes Required:

#### 1. Contact flow JSON

**File**: `context/changes/lex-keypad-capture-spike/spike-flow.json` (new)

**Intent**: A minimal flow — greet, hand off to the bot, read the captured `pesel` back to the
caller, disconnect — written as importable JSON rather than assembled by dragging blocks.

**Contract**: Connect flow export format. Names the spike bot alias on the get-customer-input
block, and references the captured slot as an external attribute in the readback prompt. Lives
in this change folder, not in `infra/` — flows are console-built and not codified (roadmap
§Parked). Written to be imported, then freely tweaked in the console with no drift obligation
back to this file.

#### 2. Console wiring

**File**: none — Connect console

**Intent**: Import the flow, publish it, and point the claimed test number at it.

**Contract**: The test number's inbound flow is the spike flow. What it pointed at beforehand is
recorded in `findings.md` so teardown knows what to restore.

### Success Criteria:

#### Automated Verification:

- The flow JSON parses and names the spike bot alias

#### Manual Verification:

- The flow imports into the Connect console without validation errors
- Calling the test number reaches the flow and the bot greets in Polish
- Eleven keyed digits are captured into the `pesel` slot
- The readback speaks back exactly the digits keyed
- The session continues to the spoken confirmation slot without leaving the bot
- The text conversation log shows the DTMF capture and the following speech turn within one session id

**Implementation Note**: The last two criteria are the roadmap's actual question. If either
fails, record it in `findings.md` immediately and go to Phase 4 — Phase 3 characterises a
mechanism that works, and has nothing to say about one that does not.

---

## Phase 3: The behaviours that decide usability

### Overview

Five calls, one per row of the matrix, each read back off the text conversation log. This is the
difference between "digits arrived once" and "S-03 can be built on this".

### Changes Required:

#### 1. Call matrix results

**File**: `context/changes/lex-keypad-capture-spike/findings.md`

**Intent**: Record what each call did, as it happens rather than afterwards. Small details differ
between rows — how long the timeout actually was, what the bot said on a re-ask — and
reconstructing them from memory is how a spike needs a sixth call.

**Contract**: One row per behaviour, each carrying what was keyed, what the caller heard, what
the text log shows, and whether the behaviour is acceptable for S-03. Rows: `#` as end
character; `*` as correction mid-capture; no `#` pressed, ending by inter-digit timeout, with
the observed timeout recorded; fewer than eleven digits; digits spoken instead of pressed.

### Success Criteria:

#### Manual Verification:

- Pressing `#` ends input before `maxLength` is reached, and the captured value is correct
- Pressing `*` corrects a mis-keyed digit within the same capture, and the captured value is correct
- Not pressing `#` ends input by timeout, and the observed timeout length is recorded
- Fewer than eleven digits produces a re-ask, and the re-ask still accepts keypad input
- Speaking digits instead of pressing them produces a recorded, non-crashing outcome
- Every row's behaviour is reconstructable from the text conversation log, not only from memory

**Implementation Note**: Pause for manual confirmation before Phase 4. The re-ask row is the one
most likely to fail — see Critical Implementation Details on prompt attempts.

---

## Phase 4: Verdict, hand-off, teardown

### Overview

Turn the calls into a decision, put it where S-03 reads, and only then destroy anything.

### Changes Required:

#### 1. The verdict

**File**: `context/changes/lex-keypad-capture-spike/findings.md`

**Intent**: State one of three verdicts and, where it is not a clean confirmation, lay out the
fallback options with their confound cost so the decision can be made rather than deferred.

**Contract**: The document carries a line reading exactly `Verdict: confirmed`,
`Verdict: confirmed-with-constraints` (naming each constraint and what S-03 must do about it),
or `Verdict: refuted`. For the latter two, the fallback options are costed against the confound
the spike exists to prevent: bouncing Wariant B out to a Connect input block, restructuring the
capture within Lex, or re-framing the authenticated comparison. The document also carries the
working `CfnBot` DTMF fragment and the flow JSON so S-03 lifts them rather than rederiving them.

#### 2. Roadmap sync

**File**: `context/foundation/roadmap.md`

**Intent**: F-03's status and its open Unknown reflect the answer, since the roadmap is where
S-03's prerequisite is read from.

**Contract**: The `## At a glance` row for `lex-keypad-capture-spike` and the `### F-03` body's
`- **Status:**` both move off `proposed`. F-03's Unknown — is a separate input step acceptable,
or does the authenticated comparison get re-framed instead — is closed, or restated as a decision
the verdict now costs. Frontmatter `updated:` bumped.

#### 3. Contract surface, if one was earned

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register any name the spike settled that will cross the console boundary in the real
system — the same class of thing as the existing `Details.Parameters.variant` entry.

**Contract**: An entry only if S-03 will genuinely carry the name across a boundary nothing in
the repo enforces — a slot name a hand-built flow must reference, or a session attribute the
readback depends on. If nothing qualifies, `findings.md` records that no surface was earned. The
throwaway's own names do not qualify.

#### 4. Teardown

**File**: `infra/lib/spike-stack.ts`, `infra/bin/infra.ts`, `infra/test/spike-stack.test.ts`

**Intent**: Return the Connect instance to clean before S-02 builds the real speech flow on it,
and stop conversation logs of keyed PESELs outliving the afternoon. Git keeps the source; the
durable copy lives in `findings.md`.

**Contract**: `cdk destroy PhoneConnect-Med-SpikeStack` removes the bot, alias, log group and
the Connect association. The console flow is deleted and the test number returned to what it
pointed at before. The two new spike files are deleted and the instantiation removed from
`infra/bin/infra.ts`, after which `cdk synth` still succeeds. Gated on the findings being
committed first.

### Success Criteria:

#### Automated Verification:

- `findings.md` carries exactly one `Verdict:` line, and its value is one of the three
- The roadmap's F-03 status is no longer `proposed`
- After teardown, CDK synthesises with no spike stack: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Infra tests pass after the spike test file is removed: `cd infra && npm test`

#### Manual Verification:

- `findings.md` carries the working `CfnBot` DTMF fragment and the flow JSON
- Where the verdict is not a clean confirmation, the fallback options are costed against the confound
- `contract-surfaces.md` carries an entry, or `findings.md` records why none was earned
- Findings are committed before anything is destroyed
- `cdk destroy` completes and the bot no longer appears in the Connect instance's associated bots
- The console flow is deleted and the test number points where it did before
- The conversation log group is gone

---

## Testing Strategy

The spike's test suite is the call matrix; there is nothing else to test. The CDK template
assertions in Phase 1 exist only to catch the three misconfigurations that are invisible until a
call is placed — wrong locale, DTMF missing from a retry attempt, audio logging left on.

### Manual Testing Steps:

1. Call the test number, trigger the intent by speaking Polish, key eleven digits ending with `#`, confirm the readback.
2. Repeat, keying `*` after a deliberate mis-key.
3. Repeat without pressing `#`, timing how long the bot waits.
4. Repeat with seven digits, observing the re-ask and whether it still accepts the keypad.
5. Repeat speaking the digits instead of keying them.

Each call's outcome goes into `findings.md` before the next one is placed.

## Cost and call budget

Roughly a dozen calls. Lex bills per request and the bot idles free; the contact flow costs
nothing to exist; the number bills per day whether or not the spike runs; text conversation logs
at this volume sit inside the CloudWatch free tier. The real cost is the caller side — dial-in
comes off a personal phone bill, not platform credits (`NEXT-STEPS.md` step 6a) — which is why
the matrix is five calls rather than open-ended experimentation.

## References

- Roadmap item: `context/foundation/roadmap.md:164-185` (F-03)
- Why it is load-bearing: `context/foundation/prd.md:191-200` (FR-005 resolution), `context/foundation/prd.md:315-322` (§Access Control Layer 2)
- Entry-intent utterances: `context/foundation/lex-sample-utterances.md:100-112`
- Connect-association pattern to mirror: `infra/lib/infra-stack.ts:104-124`
- Template-assertion pattern to follow: `infra/test/infra.test.ts`
- Console-fallback precedent: `context/changes/aws-deployment-baseline/change.md`
- Flows are not infrastructure-as-code: `context/foundation/roadmap.md` §Parked
- Consumer of the verdict: roadmap S-03 `caller-id-authentication`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Polish locale and the throwaway bot

#### Automated

- [x] 1.1 CDK synthesises with the spike stack present — 3265797
- [x] 1.2 Template pins the bot locale to the confirmed Polish locale — 3265797
- [x] 1.3 Template sets DTMF input on every prompt attempt of the `pesel` slot — 3265797
- [x] 1.4 Template gives the alias text conversation logs and no audio log settings — 3265797
- [x] 1.5 Infra tests pass — 3265797

#### Manual

- [x] 1.6 Polish is listed as an available Lex V2 locale in `eu-central-1`, and the identifier is recorded in `findings.md`
- [x] 1.7 `cdk deploy` completes and the bot locale reaches Built
- [x] 1.8 The alias appears in the Connect instance's associated bots
- [x] 1.9 The Lex console test window elicits the intent from a Polish utterance

### Phase 2: The flow, and the first successful call

#### Automated

- [x] 2.1 The flow JSON parses and names the spike bot alias — 3265797

#### Manual

- [x] 2.2 The flow imports into the Connect console without validation errors
- [x] 2.3 Calling the test number reaches the flow and the bot greets in Polish
- [x] 2.4 Eleven keyed digits are captured into the `pesel` slot
- [x] 2.5 The readback speaks back exactly the digits keyed
- [x] 2.6 The session continues to the spoken confirmation slot without leaving the bot
- [x] 2.7 The text conversation log shows the DTMF capture and the following speech turn within one session id

### Phase 3: The behaviours that decide usability

#### Manual

- [x] 3.1 Pressing `#` ends input before `maxLength` is reached, and the captured value is correct
- [x] 3.2 Pressing `*` corrects a mis-keyed digit within the same capture, and the captured value is correct
- [x] 3.3 Not pressing `#` ends input by timeout, and the observed timeout length is recorded
- [x] 3.4 Fewer than eleven digits produces a re-ask, and the re-ask still accepts keypad input
- [x] 3.5 Speaking digits instead of pressing them produces a recorded, non-crashing outcome
- [ ] 3.6 Every row's behaviour is reconstructable from the text conversation log

### Phase 4: Verdict, hand-off, teardown

#### Automated

- [x] 4.1 `findings.md` carries exactly one `Verdict:` line with one of the three values — 20710b4
- [x] 4.2 The roadmap's F-03 status is no longer `proposed` — 20710b4
- [x] 4.3 After teardown, CDK synthesises with no spike stack — a4b4508
- [x] 4.4 Infra tests pass after the spike test file is removed — a4b4508

#### Manual

- [x] 4.5 `findings.md` carries the working `CfnBot` DTMF fragment and the flow JSON — 20710b4
- [x] 4.6 Where the verdict is not a clean confirmation, the fallback options are costed against the confound — 20710b4
- [x] 4.7 `contract-surfaces.md` carries an entry, or `findings.md` records why none was earned — 20710b4
- [x] 4.8 Findings are committed before anything is destroyed — 20710b4
- [x] 4.9 `cdk destroy` completes and the bot no longer appears in the Connect instance's associated bots
- [ ] 4.10 The console flow is deleted and the test number points where it did before — left to the operator, not tracked (see findings.md §Console state)
- [x] 4.11 The conversation log group is gone
