# Agent Call Handover Implementation Plan

## Overview

Roadmap slice S-11. When a caller transfers to a human agent — by explicit request, by
exhausting retries, or on a downstream error — the agent should not start from zero: they should
see who the caller is (once authenticated) and why the call landed on them. This plan builds a
shared transfer mechanism that carries that context as Connect contact attributes, and an
agent-facing view that renders it, covering the transfer points that exist today in S-01
(facility info) and S-03 (authentication), in both variants.

## Current State Analysis

Every contact flow that can transfer to an agent does so with its own inline
`TransferContactToQueue` block and its own `QueueId` (`REPLACE_WITH_QUEUE_ARN` repeated per
flow) — no shared module exists for this (the only Contact Flow Module in the repo is
`keypad-otp-verify-module.json`, which handles OTP entry, not transfer). No flow sets any
attribute describing *why* the call is transferring, and only `authenticated`/`patientId` (never
`firstName`/`lastName`) are stored as contact attributes when identity is established — even
though the `Authenticate` Lambda's response already carries `firstName`, and the mock's
`/patient/verify` endpoint returns `lastName` too.

The keypad variant has two live transfer points today: `keypad-facility-info-main-menu-flow.json`
(digit `0`, three failed attempts, or a `FacilityInfo` Lambda error — all routed through
`SetTargetQueue` into one `TransferContactToQueue` block) and `keypad-authenticate-flow.json`
(PESEL/phone attempts exhausted, or OTP attempts exhausted — both routed through `giveUpMsg` into
one `TransferContactToQueue` block).

The speech variant has two live transfer points in the committed `speech-facility-info-flow.json`:
an explicit `AgentTransferIntent` utterance, and `fallbackCount >= 3` — both routed through
`setWorkingQueue` (an `UpdateContactTargetQueue` block) into one `TransferContactToQueue` block.
S-03's speech-side authentication flow (`AuthIntent`/`OtpIntent` routing) is **not** merged into
this file yet — `speech-authintent-fragment.md` and `speech-otpintent-fragment.md` are still
hand-merge guides describing blocks (`checkAuthTransfer`, OTP-exceeded routing) that don't exist
in the console today, even though `lambdas/facility-info-speech/index.ts` already implements the
`AuthIntent`/`OtpIntent` handlers those blocks would call into.

### Key Discoveries:

- `connect-flow-templates/flows/keypad-authenticate-flow.json`'s `setAuthAttrs` (caller-ID
  shortcut) and `storeOtpChallenge` (OTP-pending branch) are the only two points that write
  identity onto the contact — both would need to gain `firstName`/`lastName`.
- `lambdas/patient/index.ts`'s `AuthResult` and `OtpChallengeResult` types drop `lastName` even
  though the `VerifyResult` they're built from already carries it (`lastName` appears exactly once
  in that file, in the `VerifyResult` type declaration).
- `lambdas/otp-verify/index.ts` never calls the mock — it only compares a stored code — so name
  data must be captured at the *first* identity check (`beginOtpChallenge`), before the OTP
  challenge even starts, not after OTP succeeds.
- Every package in `lambdas/*` tests with Node's built-in `node --test` / `node:assert/strict`,
  mocking only `globalThis.fetch` and `console.log` — `@pcm/*` workspace packages run for real.
- No CDK changes are needed anywhere in this plan: no new Lambda function, no new permission, no
  new association. Everything is either a Lambda code change to an already-deployed function, or
  hand-built Connect configuration.

## Desired End State

A caller who reaches any of S-01's or S-03's five existing transfer points, in either variant,
lands on a queue whose connecting agent sees (via a Step-by-step Guide in the stock Agent
Workspace): the caller's first and last name, PESEL, and phone number if identity was
established before the transfer, an explicit "identity not yet confirmed" placeholder if not, and
a one-line reason the call transferred. Verified by placing a real call to each of the five
trigger points (three keypad, two speech) and confirming the Guide's content by eye.

### Key Discoveries:

(see Current State Analysis above)

## What We're NOT Doing

- Not merging S-03's speech-side authentication flow (`speech-authintent-fragment.md` /
  `speech-otpintent-fragment.md` into `speech-facility-info-flow.json`). That flow doesn't exist
  in the console yet; merging it is S-03's own unfinished work, not this slice's. This plan only
  updates those two fragment docs to describe the same `transferReason`/identity attributes their
  eventual auth-exceeded and OTP-exceeded transfer points should set, so the pattern is ready
  when that merge happens.
- Not touching `keypad-authenticated-menu-flow.json`, `keypad-booking-flow.json`,
  `keypad-appointment-{list,cancel,reschedule}-flow.json`. Those flows' own transfer points are
  out of scope for S-11 (roadmap prerequisites name only S-01 and S-03); they can be wired to the
  new shared module in a later pass without re-touching anything built here.
- Not building S-12 (agent appointment management during the transferred call) — that's a
  separate, lower-priority roadmap slice with its own prerequisites.
- Not building a custom agent application, a second login, or an audit trail — the PRD's
  Non-Goals rule these out; the agent works entirely inside the platform's stock Agent Workspace.
- Not adding new patient fields to the mock system — `firstName`/`lastName`/`pesel`/`phone` is
  the complete `Patient` entity; there is no address or other field to surface.
- Not building anything for FR-019 (agent transfers the call onward). It is native Agent
  Workspace/CCP functionality with zero code or flow changes required; this plan only carries a
  manual verification step confirming it works as expected, per the PRD's own resolution that
  this FR is "stock... configuration only."

## Implementation Approach

Introduce one new Contact Flow Module that owns queue selection and the actual
`TransferContactToQueue`, callable from both variants. Every existing transfer trigger point sets
a literal `transferReason` contact attribute immediately before handing off to the module, so the
module itself needs no Lambda invocation and no branching — it only needs to know where the
queue is. Patient identity (`firstName`, `lastName`, already-existing `patientId`/`pesel`/`phone`)
rides along as contact attributes already present on the contact by the time the module runs,
fixed at the source in `@pcm/patient` and the two Lambdas that consume it. The module also sets a
**Set event flow** block (Default flow for agent UI) pointing at a new Guide flow containing a
**Show view** block, so the moment the call connects, the agent's workspace renders a View built
from those same attributes.

`transferReason`'s value is caller-domain content read by a human (the agent, persona
"Agent / rejestracja" per the PRD) rather than caller-facing speech, but it describes the same
kind of thing the caller-facing prompts describe — so it is written in Polish, matching every
other piece of caller-domain text in this project. Attribute names, flow/module identifiers, and
code remain English per L-01/L-02.

## Critical Implementation Details

**Timing.** `firstName`/`lastName` must be captured at the *first* identity check
(`beginOtpChallenge`'s initial `verifyPatient` lookup), not after OTP succeeds —
`lambdas/otp-verify/index.ts` never calls the mock, so if the name isn't stored before the OTP
challenge begins, it's unrecoverable without adding a second network call the system doesn't
otherwise need.

**Platform capability contingency.** The Step-by-step Guide / Agent Whisper Flow assumes the
Connect instance has the newer unified Agent Workspace enabled (Views support voice contacts only
there). If it isn't available on this instance, the fallback is the CCP's native "Additional
attributes" panel, which always shows contact attributes with no extra build — Phase 5's manual
verification step checks this first and notes which path was actually used.

## Phase 1: Shared "Agent Handover" flow module

### Overview

A new Contact Flow Module that centralizes queue selection and the transfer itself, so every
calling flow only has to set a `transferReason` attribute and hand off — removing the
per-flow `REPLACE_WITH_QUEUE_ARN` duplication as a side effect.

### Changes Required:

#### 1. New Contact Flow Module

**File**: `connect-flow-templates/modules/agent-handover-module.json`

**Intent**: A minimal module, modeled on `keypad-otp-verify-module.json`'s documentation
conventions (a `Metadata.description` marking it a generated import template, review-before-
publish). It reads no external data and calls no Lambda — it sets the target queue once, then
transfers. Callers are responsible for setting `transferReason` (and, when known,
identity attributes) before invoking it.

**Contract**: `StartAction` → one `UpdateContactTargetQueue` block (`QueueId:
"REPLACE_WITH_QUEUE_ARN"`) → one `TransferContactToQueue` block. No parameters in, no
`EndFlowModuleExecution` needed on the success path (a queue transfer ends the module's relevance
to the contact); an `Errors` transition on the queue-transfer block should still reach
`EndFlowModuleExecution` so a transfer failure doesn't strand the module.

#### 2. Local ARN-fill tooling

**File**: `connect-flow-templates/fill-arns.mjs` (or its README if the script is generic already)

**Intent**: Confirm the existing placeholder-fill script picks up the new module's
`REPLACE_WITH_QUEUE_ARN` occurrence without changes (it already fills any placeholder name it's
given a key for); if the script enumerates specific files rather than globbing
`flows/`/`modules/`, add the new module to that list.

**Contract**: Running `node fill-arns.mjs` with a `REPLACE_WITH_QUEUE_ARN` entry in
`fill-arns.local.json` produces `filled/modules/agent-handover-module.json`.

### Success Criteria:

#### Automated Verification:

- None — this phase is pure Connect console configuration (JSON authored by hand, not built or
  tested by any toolchain in this repo).

#### Manual Verification:

- The module JSON imports cleanly via Flows → Create flow module → Import in the Connect console
  (after running `fill-arns.mjs` with a real queue ARN).
- `node fill-arns.mjs` produces a filled copy of the new module when given a
  `REPLACE_WITH_QUEUE_ARN` entry.

---

## Phase 2: Carry patient name to the source

### Overview

Fix the gap where `firstName`/`lastName` are available from the mock but dropped before reaching
any Lambda's response, so both variants have real name data to store as soon as identity is
established (or the OTP challenge begins).

### Changes Required:

#### 1. Shared patient domain module

**File**: `lambdas/patient/index.ts`

**Intent**: Stop dropping `lastName`. Both authenticated outcomes should carry the full name, and
the OTP-pending outcome should carry it too, since it's already been looked up by that point.

**Contract**: `AuthResult`'s `authenticated: true` branch and `OtpChallengeResult`'s
`authenticated: true` branch each gain a `lastName: string` field, sourced the same way
`firstName` already is (`result.lastName` from the `VerifyResult` match). `OtpChallengeResult`'s
`otpRequired: true` branch gains `firstName: string | null` and `lastName: string | null`,
populated from the match when one exists and `null` for a no-match pair (preserving the existing
neutral-disclosure shape the branch already uses for `code`/`phone`).

#### 2. Authenticate Lambda

**File**: `lambdas/authenticate/index.ts`

**Intent**: Surface the new fields in the handler's response so the keypad capture module (Phase
3) can store them.

**Contract**: The `authenticated: 'true'` return object gains `lastName: result.lastName`. The
`otpRequired: 'true'` return object gains `firstName`/`lastName` (empty string when the source
value is `null`, matching how `code`/`phone` already default to `''` in that branch).

#### 3. Speech facility-info Lambda

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: Same surfacing for the speech variant's `AuthIntent` handler, kept in place even
though the flow that would read it isn't merged yet (see What We're NOT Doing), so the data is
ready for that future merge without another Lambda change.

**Contract**: `AuthIntent`'s caller-ID-shortcut branch (around line 661–675) adds
`lastName: result.lastName` to the session attributes it returns. Its OTP-pending branch (around
line 691–705) adds `firstName`/`lastName` the same way the Authenticate Lambda's `otpRequired`
branch does.

### Success Criteria:

#### Automated Verification:

- `lambdas/patient` typechecks: `cd lambdas/patient && npx tsc --noEmit`
- `lambdas/patient` tests pass, including new assertions that `authenticate()` and
  `beginOtpChallenge()` return `lastName` (and `firstName`/`lastName` on the `otpRequired`
  branch): `cd lambdas/patient && npm test`
- `lambdas/authenticate` typechecks: `cd lambdas/authenticate && npx tsc --noEmit`
- `lambdas/authenticate` tests pass, including new assertions on the handler's `lastName`/
  `firstName` output fields: `cd lambdas/authenticate && npm test`
- `lambdas/facility-info-speech` typechecks: `cd lambdas/facility-info-speech && npx tsc --noEmit`
- `lambdas/facility-info-speech` tests pass, including new assertions on `AuthIntent`'s session
  attributes: `cd lambdas/facility-info-speech && npm test`

#### Manual Verification:

- None beyond automated — this phase is pure Lambda code with existing deployment/test tooling.

---

## Phase 3: Keypad flow wiring

### Overview

Wire `keypad-facility-info-main-menu-flow.json`'s three trigger points and
`keypad-authenticate-flow.json`'s two trigger points into the new module, and start storing
`firstName`/`lastName` where identity is already being stored.

### Changes Required:

#### 1. Main menu flow

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`

**Intent**: Each of the three paths that currently reach `SetTargetQueue` (digit `0`, three
failed attempts, `FacilityInfo` Lambda error) should instead set a literal `transferReason` first,
then hand off to the new module instead of transferring directly.

**Contract**: Insert an `UpdateContactAttributes` block (`transferReason`, one of "Klient poprosił
o kontakt z konsultantem." / "Trzy nieudane próby wprowadzenia danych." / "Błąd systemu podczas
pobierania informacji o placówce.") on each of the three inbound edges to `SetTargetQueue`, then
replace `SetTargetQueue` → `TransferContactToQueue` with a single `TransferToFlowModule` block
targeting `agent-handover-module.json` (`REPLACE_WITH_AGENT_HANDOVER_MODULE_ARN`). Remove the
now-redundant `SetTargetQueue`/`TransferContactToQueue` blocks.

#### 2. Authenticate flow

**File**: `connect-flow-templates/flows/keypad-authenticate-flow.json`

**Intent**: Both of `giveUpMsg`'s feeder branches (PESEL/phone attempts exhausted, OTP attempts
exhausted) should set their own `transferReason` before the shared `giveUpMsg` message plays, and
the flow should hand off to the new module instead of its own `transferQueue` block. Also start
storing the caller's name at the same two points identity is already stored.

**Contract**: `setAuthAttrs` gains `firstName: "$.External.firstName"`,
`lastName: "$.External.lastName"` alongside its existing `authenticated`/`patientId`.
`storeOtpChallenge` gains `firstName: "$.External.firstName"`, `lastName: "$.External.lastName"`
alongside its existing `isDemo`/`code`/`phone`/`patientId`. Insert an `UpdateContactAttributes`
block (`transferReason`: "Trzy nieudane próby weryfikacji tożsamości." or "Trzy nieudane próby
wprowadzenia kodu.") on `bumpAttempts`'s and `checkOtpAuth`'s respective edges into `giveUpMsg`,
then replace `giveUpMsg` → `transferQueue` with `TransferToFlowModule` into
`agent-handover-module.json`. Remove the now-redundant `transferQueue` block.

### Success Criteria:

#### Automated Verification:

- None — hand-built Connect configuration, no toolchain in this repo builds or tests it.

#### Manual Verification:

- A call pressing `0` at the main menu reaches the queue with `transferReason` set to the
  caller-request text and no identity attributes (unauthenticated).
- A call that fails the main menu input three times reaches the queue with the three-attempts
  `transferReason`.
- A call that triggers a `FacilityInfo` error reaches the queue with the system-error
  `transferReason`.
- A call that exhausts PESEL/phone attempts, and a call that exhausts OTP attempts, each reach the
  queue with their respective `transferReason` and no identity attributes.
- A call that authenticates via the caller-ID shortcut, then later transfers (e.g. by pressing `0`
  from the main menu after authenticating), reaches the queue with `firstName`/`lastName`/
  `patientId`/`pesel`/`phone` all present.
- A call that authenticates via OTP reaches the queue (on a later transfer) with the same identity
  attributes present.

---

## Phase 4: Speech flow wiring

### Overview

Wire `speech-facility-info-flow.json`'s two live trigger points into the same module, and record
the equivalent treatment for S-03's not-yet-merged speech auth flow in its fragment docs so the
pattern is ready when that flow is eventually built.

### Changes Required:

#### 1. Speech facility-info flow

**File**: `connect-flow-templates/flows/speech-facility-info-flow.json`

**Intent**: Both paths that currently reach `setWorkingQueue` (explicit `AgentTransferIntent`
utterance, `fallbackCount >= 3`) should set a literal `transferReason` first, then hand off to the
new module instead of setting their own queue and transferring directly.

**Contract**: Insert an `UpdateContactAttributes` block (`transferReason`: "Klient poprosił o
kontakt z konsultantem." for the `AgentTransferIntent` edges, "Trzy niezrozumiałe wypowiedzi." for
the `checkFallback` edge) before `setWorkingQueue`, then replace `setWorkingQueue` →
`transferQueue` with `TransferToFlowModule` into `agent-handover-module.json`. Remove the
now-redundant `setWorkingQueue`/`transferQueue` blocks.

#### 2. Fragment docs (documentation only)

**File**: `connect-flow-templates/flows/speech-authintent-fragment.md`,
`connect-flow-templates/flows/speech-otpintent-fragment.md`

**Intent**: Record that once these fragments are merged, their `checkAuthTransfer` and
OTP-exceeded transfer points should follow the same pattern this plan establishes elsewhere:
set `transferReason` (and rely on the `authenticated`/`patientId`/`firstName`/`lastName` session
attributes `lambdas/facility-info-speech/index.ts` already returns, once Phase 2 lands) before
handing off to `agent-handover-module.json`, instead of inventing a separate transfer mechanism.

**Contract**: A short addition to each fragment's existing prose/reference table — no new blocks
invented here, since the base blocks these fragments describe (`checkAuthTransfer`, OTP-exceeded
routing) don't exist in the console yet.

### Success Criteria:

#### Automated Verification:

- None — hand-built Connect configuration and documentation only.

#### Manual Verification:

- A call saying an `AgentTransferIntent` utterance reaches the queue with the caller-request
  `transferReason`.
- A call that triggers three consecutive fallback/misunderstood turns reaches the queue with the
  three-unclear-utterances `transferReason`.
- The two fragment docs read correctly and would give a future implementer enough to wire
  `transferReason` consistently once S-03's speech auth flow is merged.

---

## Phase 5: Agent-side display and end-to-end verification

### Overview

Build the agent-facing side: a View rendering the attributes Phases 3–4 now set, shown via an
Agent Whisper Flow attached to the destination queue, then verify every live trigger point
end-to-end.

### Changes Required:

#### 1. Agent handover View

**File**: `connect-flow-templates/views/agent-handover-view.json` (or the equivalent console-native
View resource, exported/documented the same way flows are — see Migration Notes if the console
doesn't support exporting Views as importable JSON the way it does flows/modules)

**Intent**: A read-only view showing, when `authenticated == 'true'`: first name, last name,
PESEL, phone, and `transferReason`. When not authenticated: an explicit "Tożsamość nie została
jeszcze potwierdzona." placeholder plus `transferReason`.

**Contract**: Static text fields bound to `$.Attributes.firstName` / `.lastName` / `.pesel` /
`.phone` / `.transferReason`, gated on `$.Attributes.authenticated`.

#### 2. Agent Whisper Flow

**File**: `connect-flow-templates/flows/agent-handover-whisper-flow.json`

**Intent**: Attached to the queue both variants now transfer into, shown to the connecting agent
before or as the call connects.

**Contract**: A `Show view` block (`Target: Agent`) referencing the View above, then whatever
default whisper behavior the queue already has (silence, or the platform default). Assigned to
the queue as its Agent Whisper Flow in the console (see Migration Notes).

### Success Criteria:

#### Automated Verification:

- None — hand-built Connect console configuration.

#### Manual Verification:

- Confirm the target Connect instance has the unified Agent Workspace (Views-capable) enabled; if
  not, fall back to verifying the CCP's native "Additional attributes" panel shows the same
  attributes instead of building the View/Whisper Flow, and note which path was used.
- Place a real call through each of the five wired trigger points (three keypad, two speech) and
  confirm the agent's Guide (or attributes panel) shows the expected patient identity /
  placeholder and `transferReason` for each.
- With an agent connected to a transferred call, confirm they can transfer the call onward to
  another queue or agent using the platform's stock controls (FR-019 — verification only, no
  build).

---

## Testing Strategy

### Unit Tests:

- `lambdas/patient`: `authenticate()` and `beginOtpChallenge()` return `lastName` on every
  authenticated outcome, and `firstName`/`lastName` (or `null`) on the `otpRequired` outcome.
- `lambdas/authenticate`: handler response carries `lastName` on `authenticated: 'true'`, and
  `firstName`/`lastName` on `otpRequired: 'true'`.
- `lambdas/facility-info-speech`: `AuthIntent`'s two success/pending branches carry the same new
  fields in their session attributes.

### Integration Tests:

- None — this project has no integration-test harness beyond real calls through the deployed
  system (see Manual Testing Steps).

### Manual Testing Steps:

1. Call in, press `0` at the main menu — confirm the agent sees "Klient poprosił o kontakt z
   konsultantem." and no identity.
2. Call in, fail the main menu input three times — confirm the three-attempts reason.
3. Call in, authenticate via the caller-ID shortcut, then press `0` — confirm full identity plus
   the caller-request reason.
4. Call in, authenticate via OTP, then transfer — confirm full identity is present.
5. Call in, exhaust PESEL/phone attempts — confirm the identity-verification reason, no identity.
6. Call in, exhaust OTP attempts — confirm the OTP reason, no identity.
7. In the speech variant, say an agent-transfer utterance — confirm the caller-request reason.
8. In the speech variant, trigger three consecutive fallback turns — confirm the unclear-
   utterances reason.
9. With any transferred call connected to an agent, attempt an onward transfer to another queue/
   agent using stock controls.

## Performance Considerations

None — no new Lambda invocations are added to any transfer path; the module only sets a queue and
transfers, and the View reads attributes already on the contact.

## Migration Notes

No data migration. If the Connect instance's console doesn't support exporting Views as
importable JSON the way it does flows/modules, `connect-flow-templates/views/agent-handover-view.json`
becomes a hand-merge guide (like `speech-authintent-fragment.md`) documenting the view's fields
instead of an importable resource — follow `connect-flow-templates/README.md`'s existing
convention for that case.

## References

- Roadmap: `context/foundation/roadmap.md` → S-11
- PRD: `context/foundation/prd.md` → FR-018, FR-019, FR-020, §Access Control → "Agent access to
  calls"
- Contract surfaces: `docs/reference/contract-surfaces.md`
- Precedent module: `connect-flow-templates/modules/keypad-otp-verify-module.json`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Shared "Agent Handover" flow module

#### Manual

- [ ] 1.1 The module JSON imports cleanly via Flows → Create flow module → Import
- [ ] 1.2 `node fill-arns.mjs` produces a filled copy of the new module

### Phase 2: Carry patient name to the source

#### Automated

- [x] 2.1 `lambdas/patient` typechecks — 0b48f11
- [x] 2.2 `lambdas/patient` tests pass, including new `lastName`/`firstName` assertions — 0b48f11
- [x] 2.3 `lambdas/authenticate` typechecks — 0b48f11
- [x] 2.4 `lambdas/authenticate` tests pass, including new output-field assertions — 0b48f11
- [x] 2.5 `lambdas/facility-info-speech` typechecks — 0b48f11
- [x] 2.6 `lambdas/facility-info-speech` tests pass, including new session-attribute assertions — 0b48f11

### Phase 3: Keypad flow wiring

#### Manual

- [ ] 3.1 Digit `0` at main menu reaches queue with caller-request `transferReason`, no identity
- [ ] 3.2 Three failed main-menu attempts reaches queue with three-attempts `transferReason`
- [ ] 3.3 `FacilityInfo` error reaches queue with system-error `transferReason`
- [ ] 3.4 PESEL/phone attempts exhausted reaches queue with identity-verification `transferReason`, no identity
- [ ] 3.5 OTP attempts exhausted reaches queue with OTP `transferReason`, no identity
- [ ] 3.6 Caller-ID-shortcut-authenticated call later transferring carries full identity
- [ ] 3.7 OTP-authenticated call later transferring carries full identity

### Phase 4: Speech flow wiring

#### Manual

- [ ] 4.1 `AgentTransferIntent` utterance reaches queue with caller-request `transferReason`
- [ ] 4.2 Three fallback turns reaches queue with unclear-utterances `transferReason`
- [ ] 4.3 Fragment docs updated and legible for a future implementer

### Phase 5: Agent-side display and end-to-end verification

#### Manual

- [ ] 5.1 Confirm Agent Workspace/Views availability on the target instance, or fall back to the
      native attributes panel
- [ ] 5.2 All five trigger points (3 keypad, 2 speech) show correct identity/placeholder and
      `transferReason` to the agent
- [ ] 5.3 Agent can transfer the call onward to another queue/agent using stock controls (FR-019)
