# Facility Information By Speech Implementation Plan

## Overview

Roadmap item **S-02**, the natural-language sibling of S-01. A caller says what they want in
their own words and hears the same address-and-hours answer S-01 produces — no menu, no
keypress. This slice introduces the project's first production Lex V2 bot (the throwaway F-03
spike proved the mechanics; nothing from it ships) and defines the "global layer" of intents
(orientation, info, repeat, agent-transfer, fallback) every later speech slice extends, mirroring
the role S-01 played for the keypad variant's repeat/attempt/transfer mechanism.

## Current State Analysis

- **The shared answer path needs no changes.** `his/src/facility/*` and
  `lambdas/facility-info/index.ts` already return `{ name, address, opensAt, closesAt, openDays }`
  from a single seeded row, take no input, and know nothing about which variant is calling
  ([his/src/facility/facility.controller.ts:1-13](his/src/facility/facility.controller.ts),
  [lambdas/facility-info/index.ts:1-33](lambdas/facility-info/index.ts)).
- **`lambdas/measure/index.ts` already types `variant` as `'keypad' | 'speech'`**
  (`InvocationRecord.variant`, `lambdas/measure/index.ts:15`) and reads it from
  `event.Details?.Parameters?.variant` (`lambdas/measure/index.ts:36`) — an event shape that
  matches a **Connect-invoked** Lambda, not a **Lex-fulfillment-invoked** one. This slice's new
  Lambda is invoked by Lex, not by Connect directly, so it must synthesize a compatible event
  before calling `measured()` (see Critical Implementation Details).
- **No Lex resources currently exist.** `infra/lib/infra-stack.ts` (239 lines) has two
  `NodejsFunction`s (`ConnectHealth`, `FacilityInfo`), each with `connect.amazonaws.com` Lambda
  permission and a `CfnIntegrationAssociation`. No `aws-cdk-lib/aws-lex` import anywhere in the
  live stack.
- **The CDK pattern for a Lex V2 bot is proven, then deleted.** `infra/lib/spike-stack.ts`
  (added `3265797`, fixed `6de3b7d`, removed at teardown `a4b4508`) built and deployed a working
  `pl_PL` bot with `CfnBot`/`CfnBotVersion`/`CfnBotAlias`, a bot role with
  `polly:SynthesizeSpeech`, and a Connect association via `cr.AwsCustomResource` calling
  `AssociateBot`/`DisassociateBot` directly (Connect↔Lex association is **not** a first-class CDK
  L1 resource). Recoverable at commit `6de3b7d`. The spike's DTMF-specific
  `PromptAttemptSpecificationProperty` fragments don't apply here — every intent in this slice is
  voice-only, unauthenticated, zero-slot.
- **The bot's utterances are already authored and frozen**, per the measurement protocol's
  train-before-build rule: `MainMenuIntent`, `InfoIntent`, `RepeatIntent`, `AgentTransferIntent`,
  and built-in `FallbackIntent` under `## Global layer`
  (`context/foundation/lex-sample-utterances.md:11-93`). None of these five intents carry slots.
- **`docs/reference/contract-surfaces.md`** documents `Details.Parameters.variant` (already
  allows `speech`), the `lastMessageText` **Connect contact attribute**, and the reserved global
  digits (`0`, `*`) — all keypad-specific mechanics that stay unchanged. This slice introduces a
  parallel, Lex-session-scoped set of names that need their own entry.
- **No contact flow is ever committed** — flows are hand-built in the console, and switching
  which variant the test number demonstrates means repointing the number to a different flow by
  hand (established by F-01, continued by S-01, and explicitly how F-03's spike was torn down).
  This plan follows the same convention: only the bot is CDK, the flow is prose here and built by
  hand.
- **S-01's exact spoken answer** (confirmed by the user, not recoverable from the repo since the
  flow isn't committed): `"Nasz adres to {address}. Jesteśmy czynni od {opensAt} do {closesAt},
  {openDays}."` — the literal template this slice's fulfillment message must reproduce,
  substituting the same four fields `facility-info` already returns.

### Key Discoveries:

- `lambdas/facility-info/index.test.ts:1-71` — the test pattern (mock `globalThis.fetch`,
  intercept `console.log` for measurement records, assert flat-string-map / exactly-one-record
  shape) every new Lambda's tests in this plan mirror.
- `package.json:3` (root) — `"workspaces": ["lambdas/*"]`; `lambdas/measure/package.json:6`
  (`"exports": "./index.ts"`) is the exact shape a new shared package should copy — no build
  step, consumed as TypeScript source directly.
- `infra/test/infra.test.ts:80-95` — asserts exactly 2 `connect.amazonaws.com` Lambda permissions
  and 2 `CfnIntegrationAssociation`s. This slice's new Lambda is invoked by **Lex**, not Connect,
  so it must **not** add a third of either — it needs its own `lexv2.amazonaws.com` permission
  instead, sourced from the bot alias ARN.
- `context/archive/2026-08-26-lex-keypad-capture-spike/findings.md:64-96` — of the four usability
  constraints found, only one transfers to this slice: silent, identical re-asks on retry. The
  other three are DTMF-slot-specific and don't apply (this slice has no slots).
- `context/foundation/roadmap.md:225` — the guardrail this plan is built around: S-02's answer
  "must be byte-identical to S-01's."

## Desired End State

A caller dials the speech-variant flow (the test number repointed to it, per the established
console-switching convention), speaks a request in Polish ("jakie są godziny otwarcia"), and
hears the exact same address-and-hours sentence S-01 speaks — sourced through the same
`his/facility` endpoint, with no menu and no keypress. From any point the caller can ask to
repeat the last thing said or ask for a human, and three consecutive unrecognized utterances
transfer to the same agent queue S-01 uses. Every invocation emits a measurement record carrying
`variant: "speech"`.

Verified by: calling the (repointed) test number end-to-end and observing the per-call
measurement record for `facility-info-speech` in the shared log group, and comparing the spoken
answer word-for-word against S-01's.

### Key Discoveries:

(see above — consolidated there to avoid duplication)

## What We're NOT Doing

- **Not modifying `his/` or `lambdas/facility-info/`'s behavior.** The refactor in Phase 1 lifts
  shared code out; it does not change what either existing consumer returns, and
  `facility-info/index.test.ts` passes unmodified.
- **Not modifying S-01's contact flow.** This slice's flow is a new, separate, hand-built flow.
  Demonstrating either variant means repointing the test number, exactly as the F-03 spike's own
  teardown notes describe.
- **Not adding a digit-based fallback for agent-transfer.** `AgentTransferIntent` is the only path
  to a human in this variant — no redundant `0` keypress, so the mechanism boundary the A-vs-B
  comparison relies on ("differ only in how input is collected") stays clean.
- **Not building authentication, slots, or any intent beyond the five global-layer ones already
  authored.** PESEL capture, booking, and every other intent in `lex-sample-utterances.md` belong
  to later slices (S-03+), which extend this same bot.
- **Not committing the contact flow.** Console-only, continuing the established convention.
- **Not adding a `DialogCodeHook`.** None of this slice's intents have slots to elicit, so
  `fulfillmentCodeHook` alone is sufficient — no per-turn dialog hook is needed.

## Implementation Approach

Four phases, mirroring S-01's own shape so the two variants stay genuinely comparable in
implementation cost, in dependency order: extract the one piece of code that needs to be shared,
build the new Lambda that needs it, deploy the bot and function, then build and verify the flow.

`lambdas/facility-info/index.ts`'s downstream call is lifted into a new `@pcm/facility` workspace
package so both the keypad Lambda and the new speech Lambda call the identical fetch — not two
copies of the same three lines, and not a cross-Lambda invoke. `lambdas/facility-info-speech/`
is a Lex V2 fulfillment handler dispatching on intent name, using Lex session attributes as the
speech-variant analogue of Connect's `lastMessageText` contact attribute and reserved digits.
`infra-stack.ts` grows the bot (recovering the spike's proven CDK shape), the new function with a
Lex-scoped (not Connect-scoped) invoke permission, and the same `AwsCustomResource` Connect
association pattern. The contact flow is designed in prose here and built by hand, carrying
forward the loop-back-on-no-match structure S-01 established, adapted to Lex's per-intent outcome
branches instead of digit branches.

## Critical Implementation Details

**The Lex fulfillment event does not match `measured()`'s expected shape.** `measured()`'s `fn`
receives a `ConnectEvent` (`Details.ContactData.ContactId`, `Details.Parameters.variant`) — the
shape of a Connect "Invoke AWS Lambda function" block event. A Lex V2 fulfillment invocation's
event carries `sessionState.intent.name`, `sessionState.sessionAttributes`, `inputTranscript`,
etc. — an unrelated shape. `lambdas/facility-info-speech/index.ts` must **not** modify
`measured()`; instead it synthesizes a minimal `ConnectEvent` (contactId from a Lex session
attribute the flow sets explicitly, `variant` hardcoded to `'speech'` since this Lambda only ever
serves this bot) purely to satisfy `measured()`'s contract, while the actual intent-dispatch logic
closes over the **real** Lex event from the outer scope — not the synthetic one `measured()`
passes into its callback. Getting this backwards (reading intent name off the synthetic event)
fails silently at the type level only if the synthetic event is over-shaped; keep it minimal.

**Session-attribute state carries repeat text and the fallback counter across turns, mirroring
`lastMessageText` but scoped to the Lex session, not the Connect contact.** Every intent response
sets `sessionAttributes.lastMessageText` to whatever it just said; `RepeatIntent`'s handler reads
it back verbatim. `sessionAttributes.fallbackCount` increments only when the matched intent is
`FallbackIntent`, and resets to `'0'` on every other intent — so the **flow**, not the Lambda,
decides whether the third strike transfers: it checks `$.Lex.SessionAttributes.fallbackCount` (the
same `$.Lex.*` reference style the F-03 spike used for `$.Lex.Slots.*`) after every turn and
routes to the transfer queue only when it reads `3` or more, otherwise loops back to the same
Get Customer Input (Lex) block — the direct analogue of S-01's combined invalid-keypress/timeout
counter, expressed as session state instead of a contact attribute.

**The new Lambda's Connect-side permission is scoped to Lex, not Connect.** Unlike
`ConnectHealth`/`FacilityInfo`, `facility-info-speech` is never invoked directly by Connect — Lex
invokes it as a fulfillment code hook. Its `addPermission` principal is `lexv2.amazonaws.com`
with `sourceArn` set to the bot alias ARN, and it gets **no** `CfnIntegrationAssociation`. Only
the bot itself is associated with the Connect instance (via the recovered `AwsCustomResource`
pattern). Wiring this the `connect.amazonaws.com` way would silently fail — Lex, not Connect, is
what calls this function.

## Phase 1: Shared facility-fetch module

### Overview

Lift the downstream `GET /facility` call out of `lambdas/facility-info/index.ts` into a new
workspace package both the existing keypad Lambda and the new speech Lambda import, without
changing either's observable behavior.

### Changes Required:

#### 1. `@pcm/facility` package

**File**: `lambdas/facility/index.ts` (new), `lambdas/facility/package.json` (new),
`lambdas/facility/tsconfig.json` (new)

**Intent**: A single exported function that fetches and parses the facility record, with no
`measured()`/`downstream()` wrapping of its own — timing and error-shaping stay in each caller,
since that's handler-specific.

**Contract**: `package.json` mirrors `lambdas/measure/package.json` exactly (`"exports":
"./index.ts"`, no build step, `node --test`). Exports a `Facility` type
(`{ name, address, opensAt, closesAt, openDays }`, all `string`) and `fetchFacility(signal:
AbortSignal): Promise<Facility>`, calling `fetch(`${process.env.MOCK_BASE_URL}/facility`,
{ signal })` and returning the parsed JSON body. Throws on failure — callers keep their own
try/catch.

#### 2. `lambdas/facility-info/` uses the shared module

**File**: `lambdas/facility-info/index.ts`, `lambdas/facility-info/package.json`

**Intent**: Replace the inline `fetch('/facility')` call with `fetchFacility()`, changing nothing
about the handler's inputs, outputs, or error shape.

**Contract**: `package.json` gains `"@pcm/facility": "*"` alongside the existing
`"@pcm/measure": "*"` dependency. `index.ts`'s `downstream(record, () => fetch(...))` becomes
`downstream(record, () => fetchFacility(abort))`. `facility-info/index.test.ts` is **not**
modified — it mocks `globalThis.fetch`, which `fetchFacility` still calls internally, so the
existing assertions hold unchanged.

### Success Criteria:

#### Automated Verification:

- New package typechecks: `cd lambdas/facility && npx tsc --noEmit`
- New package's own test passes: `cd lambdas/facility && npm test`
- `facility-info` still typechecks: `cd lambdas/facility-info && npx tsc --noEmit`
- `facility-info`'s existing test suite passes unmodified: `cd lambdas/facility-info && npm test`

#### Manual Verification:

- Invoking `facility-info`'s handler locally against the deployed mock still returns the seeded
  facility data, confirming the refactor changed nothing observable

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 2: `lambdas/facility-info-speech/`

### Overview

The Lex V2 fulfillment Lambda: dispatches on matched intent name, composes the byte-identical
facility answer for `InfoIntent`, manages the Lex-session-scoped repeat and fallback-counter
state, and emits a `measured()` record carrying `variant: "speech"`.

### Changes Required:

#### 1. Handler

**File**: `lambdas/facility-info-speech/index.ts`, `lambdas/facility-info-speech/package.json`,
`lambdas/facility-info-speech/tsconfig.json`, `lambdas/facility-info-speech/event.sample.json`

**Intent**: Handle each of the five global-layer intents, closing every turn with a Lex `Close`
dialog action and an updated `sessionAttributes` map. `InfoIntent` calls `fetchFacility()` (via
`downstream()`) and composes `"Nasz adres to {address}. Jesteśmy czynni od {opensAt} do
{closesAt}, {openDays}."` verbatim. `MainMenuIntent` returns a short orientation message
(what the caller can ask for — not a digit menu). `RepeatIntent` echoes
`sessionAttributes.lastMessageText` from the incoming event. `AgentTransferIntent` returns a
short "connecting you" message; the contact flow branches on this intent name directly.
`FallbackIntent` increments `sessionAttributes.fallbackCount` and returns one of three distinct
retry messages depending on the count (escalating from a gentle re-ask to a "connecting you to an
agent" framing on the third), replacing the F-03 spike's known silent-identical-re-ask gap
deliberately rather than inheriting it.

**Contract**: `package.json` depends on `@pcm/measure` and `@pcm/facility` (mirrors
`lambdas/facility-info/package.json`'s shape). The handler synthesizes a `ConnectEvent` for
`measured()` per Critical Implementation Details — `contactId` from
`event.sessionState.sessionAttributes?.contactId`, `Parameters: { variant: 'speech' }` hardcoded.
Every non-`FallbackIntent` response sets `sessionAttributes.fallbackCount = '0'`. Response shape:

```ts
type LexCloseResponse = {
  sessionState: {
    dialogAction: { type: 'Close' };
    intent: { name: string; state: 'Fulfilled' };
    sessionAttributes: Record<string, string>;
  };
  messages: [{ contentType: 'PlainText'; content: string }];
};
```

`event.sample.json` is a `FulfillmentCodeHook` invocation for `InfoIntent` with no prior session
attributes, modeled on the real Lex V2 Lambda input event shape.

### Success Criteria:

#### Automated Verification:

- Function code typechecks: `cd lambdas/facility-info-speech && npx tsc --noEmit`
- Handler tests pass: `cd lambdas/facility-info-speech && npm test`
- `InfoIntent` returns the exact byte-identical sentence template, asserted against the fixed
  string (not just field presence)
- `FallbackIntent` invoked three times in sequence (via three separate handler calls, an
  incoming `fallbackCount` of `'0'`, `'1'`, then `'2'`) produces three distinct message strings
  and a `fallbackCount` of `'1'`, `'2'`, `'3'` respectively
- Any non-`FallbackIntent` invocation with an incoming `fallbackCount` of `'2'` resets it to `'0'`
  in the response
- Exactly one measurement record is emitted per invocation, carrying `variant: 'speech'` and the
  `contactId` read from the incoming session attribute

#### Manual Verification:

- Handler invoked locally with a crafted `InfoIntent` event against the deployed mock returns the
  seeded facility data composed into the exact template

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 3: Infrastructure — the Lex bot and the new function

### Overview

Deploy the Lex V2 bot (recovering the spike's proven CDK shape) transcribing the five frozen
global-layer intents, the new function with a Lex-scoped invoke permission, and the Connect↔bot
association.

### Changes Required:

#### 1. Lex bot construct

**File**: `infra/lib/infra-stack.ts`

**Intent**: Define the `pl_PL` bot with the five intents from `lex-sample-utterances.md`
transcribed verbatim (sample utterances, no slots), reusing the spike's proven `CfnBot` shape
(bot role with `polly:SynthesizeSpeech`, `nluConfidenceThreshold`, neural voice) and its
`CfnBotVersion`/`CfnBotAlias` pattern, recovered from commit `6de3b7d`.

**Contract**: `CfnBotAlias.botAliasLocaleSettings[0].codeHookSpecification.lambdaCodeHook` points
at the new function's ARN; each of the five intents sets `fulfillmentCodeHook: { enabled: true }`
(no `dialogCodeHook` — no slots to elicit). Conversation logging to a CloudWatch log group,
matching the spike's own `textLogSettings` shape, retained at the project's existing 3-month
policy rather than the spike's throwaway 1-week retention.

#### 2. Facility-info-speech function and Lex-scoped permission

**File**: `infra/lib/infra-stack.ts`

**Intent**: Define the new function identically to `FacilityInfo` (same VPC, security group,
timeout, measurement log group), but grant it a **Lex**, not Connect, invoke permission — see
Critical Implementation Details.

**Contract**: A third `NodejsFunction` (`FacilityInfoSpeech`), same
`vpc`/`vpcSubnets`/`securityGroups`/`logGroup`/`loggingFormat` as the other two. `addPermission`
principal `lexv2.amazonaws.com`, `sourceArn` the bot alias ARN. **No** `CfnIntegrationAssociation`
for this function.

#### 3. Connect↔bot association

**File**: `infra/lib/infra-stack.ts`

**Intent**: Associate the bot (not the function) with the Connect instance, recovering the
spike's `AwsCustomResource` pattern exactly (`AssociateBot`/`DisassociateBot`, IAM policy for
`connect:AssociateBot`/`DisassociateBot` and the `lex:*ResourcePolicy` calls the custom resource
needs).

**Contract**: Same shape as `infra/lib/spike-stack.ts`'s `ConnectBotAssociation` custom resource
(commit `6de3b7d`), pointed at this stack's bot alias and this stack's `connectInstanceArn`
context value.

#### 4. Template assertions

**File**: `infra/test/infra.test.ts`

**Intent**: Assert what `Template.fromStack` can show for the new resources, per the agreed
testing depth — the bot/version/alias synthesize with the right locale and intents, the new
function has a `lexv2.amazonaws.com` permission (not a third `connect.amazonaws.com` one), and
the custom resource's IAM policy grants exactly the actions it needs. The `AssociateBot` call
itself is not a native CFN resource `Template.fromStack` can assert — left to Manual Verification,
matching how S-01 already treats console-only state.

**Contract**: Extends the existing suite. New assertions: `AWS::Lex::Bot` resource with
`DataPrivacy.ChildDirected: false` and a `BotLocales` entry for `pl_PL` containing 5 intents (by
name); the existing "both functions may be invoked by the telephony instance" test (asserting
exactly 2 `connect.amazonaws.com` permissions) stays unchanged and must still pass — a new,
separate test asserts exactly 1 `lexv2.amazonaws.com` permission exists; a custom resource IAM
policy assertion for `connect:AssociateBot`/`connect:DisassociateBot`.

### Success Criteria:

#### Automated Verification:

- CDK synthesises: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Existing Connect-permission-count test still passes unchanged (regression guard): `cd infra && npm test`
- New Lex-bot and Lex-permission assertions pass: `cd infra && npm test`

#### Manual Verification:

- `cdk deploy` completes; the bot appears in the Lex console with all 5 intents built
  successfully
- The new function's CloudWatch logs show it receiving Lex fulfillment invocations after a test
  utterance in the Lex console's test window
- The bot alias is associated with the Connect instance (visible in the Connect console's
  "Amazon Lex" configuration for the instance)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 4: Contact flow, hand-off, contract surfaces, and roadmap sync

### Overview

Build the new, separate contact flow by hand in the console: a short greeting, a Get Customer
Input (Lex) block looping on every non-transfer outcome, and the fallback-counter/agent-transfer
branches routing to the same queue S-01 uses. Verify end-to-end with a real call, then close out
bookkeeping.

### Changes Required:

#### 1. Speech-variant contact flow (console, not committed)

**File**: none — Connect console

**Intent**: Greet the caller, hand off to the bot, and loop on every turn that doesn't end the
call.

**Contract**: A Play Prompt greeting (orienting the caller toward what they can ask, without
presenting a digit menu), then a Get Customer Input block configured with the S-02 bot and alias,
passing `$.ContactId` as the Lex session attribute `contactId` (the one piece of context a Lex
fulfillment event cannot otherwise recover — see Critical Implementation Details). Branches:
`AgentTransferIntent` routes directly to the transfer target; every other matched intent checks
`$.Lex.SessionAttributes.fallbackCount` — `3` or more routes to the same transfer target,
otherwise loops back to the same Get Customer Input block. Transfer target is the existing
`BasicQueue`, same as S-01.

#### 2. Contract surfaces

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the Lex-session-scoped names this slice introduces, parallel to the existing
Connect-contact-attribute entries.

**Contract**: A new entry, `Lex session attributes (facility-info-speech bot)`, documenting three
keys: `contactId` (set by the contact flow's Get Customer Input (Lex) block from `$.ContactId`,
read by the fulfillment Lambda to stamp `measured()`'s `contactId` field), `lastMessageText` (the
Lex-session analogue of the Connect contact attribute of the same name — set by every intent
response, read by `RepeatIntent`), and `fallbackCount` (incremented on `FallbackIntent`, reset to
`'0'` otherwise, read by the flow via `$.Lex.SessionAttributes.fallbackCount` to decide
loop-back vs. transfer).

#### 3. Roadmap sync

**File**: `context/foundation/roadmap.md`

**Intent**: Reflect that S-02 has shipped.

**Contract**: The `## At a glance` row for `facility-info-speech` and the `### S-02` body's
`- **Status:**` both move to `done` (via `/10x-archive` at close-out). Frontmatter `updated:`
bumped.

### Success Criteria:

#### Automated Verification:

- None — this phase is console configuration and documentation.

#### Manual Verification:

- Calling the (repointed) test number and speaking a facility-information request produces the
  exact same spoken answer as S-01, word-for-word
- Asking to repeat replays exactly what was last said
- Asking for a human, or three consecutive unrecognized utterances, both reach the same queue
  S-01 uses, without dropping the call
- The three fallback retries use visibly distinct wording, not a silent identical repeat
- The measurement log group shows one `facility-info-speech` record per call, carrying
  `variant: "speech"`
- `contract-surfaces.md` carries the new Lex session attribute entry
- Roadmap status reflects the shipped slice

**Implementation Note**: This is the final phase; no further pause is needed beyond normal review.

---

## Testing Strategy

### Unit Tests:

- `fetchFacility` returns the parsed facility payload and propagates a fetch failure as a thrown
  error
- `facility-info`'s existing suite passes unmodified after the refactor
- `facility-info-speech`'s handler: correct dispatch per intent name, byte-identical `InfoIntent`
  message, fallback-counter increment/reset/escalating-message behavior, exactly-one measurement
  record with the right `variant` and `contactId`

### Integration Tests:

- Infra snapshot assertions: the bot/version/alias synthesize with 5 intents under `pl_PL`; the
  new function carries a `lexv2.amazonaws.com` permission and no `CfnIntegrationAssociation`; the
  existing 2-function Connect-permission count is unchanged

### Manual Testing Steps:

1. Call the (repointed) test number, ask for the address or hours, and confirm the spoken answer
   matches S-01's exactly
2. Ask to repeat and confirm it replays verbatim
3. Ask for a human and confirm immediate transfer
4. Say three unrecognized things in a row and confirm escalating retry messages followed by
   transfer on the third
5. Stop the mock instance's `his` container mid-call to force a downstream error during
   `InfoIntent` and confirm the flow still reaches the queue rather than dropping the call

## Performance Considerations

`InfoIntent`'s downstream call is the same single-row lookup `facility-info` already makes;
`downstreamMs` should read comparably to `facility-info`'s own baseline. Lex's own
speech-recognition latency sits outside the measured Lambda invocation but inside the caller's
end-to-end experience — record it as a qualitative note in the eventual write-up, since NFR-12's
2-second p95 is measured from the request's arrival at the Lambda, not from when the caller
finished speaking.

## Migration Notes

No schema or data changes — this slice adds no persistence. The `@pcm/facility` package
extraction in Phase 1 is a pure refactor with no migration concern.

## References

- Roadmap item: `context/foundation/roadmap.md` → `### S-02`
- Research: `context/changes/facility-info-speech/research.md`
- Pattern to mirror (Lambda shape): `lambdas/facility-info/index.ts`,
  `lambdas/facility-info/index.test.ts`
- Pattern to mirror (shared package shape): `lambdas/measure/package.json`
- Pattern to recover (Lex CDK shape): `infra/lib/spike-stack.ts` at commit `6de3b7d`
- Frozen bot utterances: `context/foundation/lex-sample-utterances.md` (Global layer section)
- Spike constraints, one of which transfers: `context/archive/2026-08-26-lex-keypad-capture-spike/findings.md`
- S-01's own plan, the structural template this plan mirrors:
  `context/archive/2026-08-29-facility-info-keypad/plan.md`
- Code standards this plan must respect: `context/foundation/lessons.md` (L-01, L-02, L-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared facility-fetch module

#### Automated

- [x] 1.1 New package typechecks
- [x] 1.2 New package's own test passes
- [x] 1.3 `facility-info` still typechecks
- [x] 1.4 `facility-info`'s existing test suite passes unmodified

#### Manual

- [ ] 1.5 `facility-info`'s handler still returns the seeded facility data locally

### Phase 2: `lambdas/facility-info-speech/`

#### Automated

- [ ] 2.1 Function code typechecks
- [ ] 2.2 Handler tests pass
- [ ] 2.3 `InfoIntent` returns the exact byte-identical sentence template
- [ ] 2.4 Three sequential `FallbackIntent` invocations produce three distinct messages and an
      incrementing counter
- [ ] 2.5 A non-`FallbackIntent` invocation resets the counter to `'0'`
- [ ] 2.6 Exactly one measurement record per invocation, carrying `variant: 'speech'` and
      `contactId`

#### Manual

- [ ] 2.7 Handler invoked locally with a crafted `InfoIntent` event returns the seeded data
      composed into the exact template

### Phase 3: Infrastructure — the Lex bot and the new function

#### Automated

- [ ] 3.1 CDK synthesises
- [ ] 3.2 Existing Connect-permission-count test still passes unchanged
- [ ] 3.3 New Lex-bot and Lex-permission assertions pass

#### Manual

- [ ] 3.4 `cdk deploy` completes; the bot appears in the Lex console with all 5 intents built
- [ ] 3.5 The new function's logs show it receiving Lex fulfillment invocations from a test
      utterance
- [ ] 3.6 The bot alias is associated with the Connect instance

### Phase 4: Contact flow, hand-off, contract surfaces, and roadmap sync

#### Manual

- [ ] 4.1 Spoken facility answer matches S-01's exactly, word-for-word
- [ ] 4.2 Repeat replays exactly what was last said
- [ ] 4.3 Agent request, and 3 unrecognized utterances, both reach the queue without dropping the
      call
- [ ] 4.4 The three fallback retries use distinct wording
- [ ] 4.5 Measurement log shows one `facility-info-speech` record per call, carrying
      `variant: "speech"`
- [ ] 4.6 `contract-surfaces.md` carries the new Lex session attribute entry
- [ ] 4.7 Roadmap status reflects the shipped slice
