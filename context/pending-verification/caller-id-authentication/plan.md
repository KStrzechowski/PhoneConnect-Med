# Caller ID Authentication Implementation Plan

## Overview

Roadmap **S-03**: a caller supplies a PESEL and phone number on the keypad, in both variants,
and — when calling from the number they declared — reaches the authenticated layer without a
texted code. This is the first slice to introduce a data model beyond facility information, the
first to require identical multi-step capture logic in both variants, and the first to define
what "authenticated" observably means before any Layer-3 feature (booking, listing) exists to
hand off to.

## Current State Analysis

`his/` has one domain (`facility`) with a Postgres-backed entity, service, controller, and
migration, seeded with one row. No `Patient` entity, table, or endpoint exists. The shared-logic
pattern is established: `his/src/<domain>/*` exposes a REST endpoint, a `@pcm/<domain>` package
under `lambdas/` wraps the fetch, and both variant-facing Lambdas import that package rather than
calling `his/` directly. The keypad variant (`lambdas/facility-info/`) is invoked directly from a
Connect flow's Invoke-Lambda block; the speech variant (`lambdas/facility-info-speech/`) is the
single Lex V2 fulfillment code hook for a bot (`SpeechBot` in `infra-stack.ts`) that currently
handles five global-layer intents with no slots. No authentication code exists anywhere.

F-03's spike already answered the load-bearing unknown: in-conversation DTMF capture inside a Lex
turn works, so both variants can capture a fixed-format field identically without one variant
bouncing to a separate input step. It also surfaced a bug this slice must not inherit: declining
the read-back confirmation currently disconnects the call instead of re-eliciting.

## Desired End State

A caller on either variant keys their PESEL and phone number on the keypad, hears both read back,
and confirms. If they are calling from the number they declared and it matches a real patient
record, they hear a confirmation and return to the main menu with an authenticated session state
set — ready for a future slice (S-05) to check without rebuilding this flow. Every other outcome —
a pair that matches no record, a pair that matches but from a different number, a declined
confirmation, or no input at all — is handled safely and identically in both variants, without
ever revealing to the caller which case applied, and without leaving them stuck: declines and
timeouts get up to three combined attempts to re-enter, and anything requiring a texted code (not
yet built — that is S-04) ends in a transfer to an agent.

### Key Discoveries:

- `lambdas/measure/index.ts:16` already types `authPath?: 'caller-id' | 'otp' | 'demo'` on
  `InvocationRecord` — F-02 anticipated this slice; the measurement contract needs no changes.
- `infra/lib/infra-stack.ts:278-343` — the existing `SpeechBot` / `CfnBotVersion` / `CfnBotAlias`
  / Connect-association shape from S-02 is the pattern this slice extends, not replaces.
- `context/archive/2026-08-26-lex-keypad-capture-spike/findings.md` §Constraints 1 — the
  decline-disconnects-the-call bug that this slice must fix, not inherit.
- `docs/reference/contract-surfaces.md` — the `Details.Parameters.variant` and Lex
  session-attribute conventions are the pattern this slice's new attributes (`callerNumber`,
  `authenticated`, `patientId`) must follow and get documented in.
- `his/src/facility/*` — the entity/service/controller/migration shape `his/src/patient/*`
  mirrors exactly.
- The caller-ID shortcut is confirmed present on the source thesis's own diagram, not a deviation
  from it (correcting the roadmap's current framing) — and is deliberately the mechanism this
  project uses to make the authenticated path callable without live SMS delivery, i.e. its
  built-in test hole. The roadmap/PRD text still calls it a "deviation"; that wording is stale but
  out of this plan's scope to edit (roadmap sync below only touches the `Status` field).

## What We're NOT Doing

- Sending or validating a real one-time code over SMS — that is S-04, gated on AWS SMS production
  access. This slice's non-shortcut outcomes speak the neutral "code sent" wording and transfer,
  they do not attempt real delivery.
- Any booking, listing, cancelling, or rescheduling behaviour (S-05–S-08).
- Any agent-facing view of patient data (S-11/S-12).
- A password or any factor beyond PESEL + phone — the pair is unchanged from the source thesis.
- PESEL checksum or format validation beyond what the DTMF capture step itself constrains.
- Persisting authentication across calls — session state is per-call only, per the PRD.
- Committing the contact flow or the Connect Contact Flow Module to the repo — like every other
  flow in this project, it is hand-built in the console.

## Implementation Approach

`his/` gains a `patient` domain mirroring `facility`'s shape exactly. A new `@pcm/patient` package
wraps the verification fetch and — critically — owns the one piece of logic that must never
diverge between variants: deciding whether a confirmed PESEL+phone pair, together with the
caller's actual number, earns the caller-ID shortcut. Both the new keypad Lambda
(`lambdas/authenticate/`) and the extended speech Lambda (`lambdas/facility-info-speech/`) call
this same function and only render its result — neither variant makes an authentication decision
of its own (L-03). The speech variant's capture step extends the existing `SpeechBot` with a new
`AuthIntent` carrying two DTMF-only slots and an intent-level confirmation with an explicit
decline path. The keypad variant's capture step is designed as a self-contained Connect Contact
Flow Module (console, hand-built) so a later slice can invoke the same sub-flow rather than
rebuilding it.

## Critical Implementation Details

- **Outcome neutrality is load-bearing, not cosmetic.** Once a PESEL+phone pair is captured and
  confirmed, verification happens exactly once — there is no retry at the verification stage
  itself. Every outcome other than "matched, and the caller's number equals the declared phone"
  — including a pair that matches no record at all — must produce the *identical* neutral
  response ("Kod weryfikacyjny został wysłany na podany numer telefonu.") followed immediately by
  a transfer to the agent queue. Giving a pair that matches-but-wrong-number a different message
  than a pair that matches nothing would let a caller distinguish a real identity from a fake one
  by which response they get — exactly the enumeration the NFR ("the system does not reveal
  whether supplied identity data corresponds to a real patient") and the PRD's own neutral-wording
  requirement exist to prevent. The three-attempt retry limit applies only to the *capture* stage
  — a DTMF timeout, a malformed entry, or a declined read-back confirmation — never to a
  completed, confirmed pair's verification result.
- **No fake OTP loop.** Because S-04 owns real code delivery and validation, this slice does not
  build a code-entry step that can never succeed. Every non-shortcut outcome speaks the neutral
  line once and transfers. Record it distinctly in the per-call record (`outcome: 'transferred'`,
  `authPath` left unset) so these are identifiable once S-04 starts producing real
  `authPath: 'otp'` records for comparison.
- **F-03's decline-disconnect bug must not ship again.** The Lex `intentConfirmationSetting` needs
  an explicit `declinationResponse` and a `declinationNextStep` that clears both slots and
  re-elicits from `pesel`; the contact flow's Lex-branching must key off
  `SessionState.Intent.State`, not intent name alone (F-03 Constraint 1).
- **Caller ID retrieval.** Both variants need the caller's actual number to compare against the
  declared phone. Connect exposes it as `$.CustomerEndpoint.Address`; the keypad flow reads it
  directly, and the speech variant's contact flow must forward it as a new Lex session attribute
  (`callerNumber`) the same way it already forwards `contactId` — a Lex fulfillment event carries
  no caller-ID field of its own.

## Phase 1: Patient persistence in `his/`

### Overview

Give the mock medical system a `Patient` record and a way to verify a PESEL+phone pair, mirroring
the `Facility` domain's shape exactly.

### Changes Required:

#### 1. Patient domain

**Files**: `his/src/patient/patient.entity.ts`, `patient.service.ts`, `patient.controller.ts`,
`patient.module.ts`, `patient.service.spec.ts`

**Intent**: Persist the minimal identity fields needed to verify a pair and to display a name in
future slices (S-06/S-11), and expose exactly one verification operation that never hints at
*why* a pair failed to match.

**Contract**: `Patient` entity with `id` (PK), `pesel`, `phone`, `firstName`, `lastName` — all
plain string columns, no format constraints. `PatientService.verify(pesel, phone): Promise<Patient
| null>` implemented as a single `findOneBy({ pesel, phone })` — the combined WHERE clause is what
enforces "neither factor alone is sufficient" at the database level. `PatientController` exposes
`POST /patient/verify` accepting `{ pesel, phone }`, returning `{ matched: false }` or
`{ matched: true, id, firstName, lastName }` and nothing else on a non-match. `PatientModule`
mirrors `FacilityModule`. The spec mirrors `facility.service.spec.ts` against a real Postgres
instance: a seeded pair matches, a wrong phone with a real PESEL does not, an unknown PESEL does
not.

#### 2. Wiring

**Files**: `his/src/data-source.ts`, `his/src/app.module.ts` (edit)

**Intent**: Register the new entity and module the same way `Facility` is registered.

**Contract**: Add `Patient` to `dataSourceOptions.entities`; add `PatientModule` to `AppModule`'s
`imports`.

#### 3. Migration

**File**: `his/src/migrations/<timestamp>-CreatePatient.ts` (generated via
`npm run migration:generate` inside `his/`)

**Intent**: Create the table and seed at least one test patient for manual verification.

**Contract**: Mirrors `CreateFacility`'s raw-SQL `CREATE TABLE` / `INSERT` shape. The seeded
phone number is placeholder data — it must be edited to a real tester's calling number before
Phase 6's manual verification, exactly as `facility`'s seeded address was placeholder data in S-01.

### Success Criteria:

#### Automated Verification:

- `npm run test` inside `his/` passes, including the new patient spec
- `npm run migration:run` inside `his/` applies cleanly against a fresh database

#### Manual Verification:

- `POST /patient/verify` against the running mock returns `matched: true` for the seeded pair and
  `matched: false` for a wrong phone or unknown PESEL, with no other field present on the
  non-match response

---

## Phase 2: Shared `@pcm/patient` authentication module

### Overview

Own the one decision that must never diverge between variants: whether a confirmed PESEL+phone
pair, together with the caller's actual number, earns the caller-ID shortcut.

### Changes Required:

#### 1. Verification fetch wrapper and shared decision function

**Files**: `lambdas/patient/package.json`, `tsconfig.json`, `index.ts`, `index.test.ts`

**Intent**: Give both variant Lambdas one function to call so neither ever makes an
authentication decision itself (L-03).

**Contract**: `package.json` mirrors `lambdas/facility/package.json` (name `@pcm/patient`, `type:
module`, `exports: ./index.ts`). `index.ts` exports a `verifyPatient(pesel, phone, signal)` fetch
wrapper calling `POST ${MOCK_BASE_URL}/patient/verify`, and `authenticate(pesel, phone,
callerNumber, signal)` that calls it and returns a discriminated result: `{ authenticated: true,
patientId, firstName }` only when the pair matched **and** `callerNumber === phone`; `{
authenticated: false }` in every other case (no match, or matched but wrong number) — the caller
of this function cannot distinguish those two `false` cases from the return value alone, by
design (see Critical Implementation Details). Tests mock `fetch` the same way
`lambdas/facility-info/index.test.ts` does, covering all three branches.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/patient` passes, covering shortcut-match, matched-wrong-number,
  and no-match cases

#### Manual Verification:

- None — this phase has no observable behaviour of its own

---

## Phase 3: Keypad-variant Lambda

### Overview

A Connect-invoked Lambda mirroring `facility-info`'s shape, calling the shared decision function
and returning a flat map the contact flow can branch on.

### Changes Required:

#### 1. `lambdas/authenticate/`

**Files**: `package.json`, `tsconfig.json`, `index.ts`, `index.test.ts`, `event.sample.json`

**Intent**: Receive the caller's confirmed PESEL, phone, and actual calling number from the
contact flow's Invoke-Lambda parameters, call `@pcm/patient`'s `authenticate`, and return a flat
string map the flow can branch on without embedding any decision logic itself.

**Contract**: Mirrors `lambdas/facility-info/index.ts`'s `measured()`/`downstream()` wrapper
shape. Reads `pesel`, `phone`, `callerNumber` from `Details.Parameters`; returns
`{ authenticated: 'true', patientId, firstName }` or `{ authenticated: 'false' }`, plus the
existing `reachable`/`error` fields on a downstream failure. Stamps `record.authPath =
'caller-id'` only on the `authenticated: 'true'` branch.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/authenticate` passes, covering the authenticated and
  not-authenticated branches and a downstream-failure case

#### Manual Verification:

- Invoking the deployed function directly (test event) with the seeded pair and a matching
  `callerNumber` returns `authenticated: 'true'`

---

## Phase 4: Speech-variant fulfillment

### Overview

Extend the existing Lex fulfillment handler with an `AuthIntent` branch, calling the same shared
decision function as the keypad variant.

### Changes Required:

#### 1. `lambdas/facility-info-speech/index.ts` (edit)

**Intent**: Add an `AuthIntent` branch to `dispatch()` that reads the `pesel`/`phone` slot values
and the `callerNumber` session attribute, calls `@pcm/patient`'s `authenticate`, and closes the
intent with the confirmation or neutral message — setting `authenticated`/`patientId` session
attributes on success so a future intent handler can check them without recapturing identity.

**Contract**: Follows the existing `close()`/session-attribute pattern used by `InfoIntent` et al.
On success, sets `sessionAttributes.authenticated = 'true'` and `patientId`; on any non-shortcut
outcome, speaks the neutral message and returns a `Close` with a session attribute signalling the
flow should transfer (mirroring how `AgentTransferIntent` already signals a transfer today).

#### 2. `lambdas/facility-info-speech/index.test.ts` (edit)

**Intent**: Cover `AuthIntent`'s three outcomes (shortcut success, no-match, matched-wrong-number)
without the test being able to tell the latter two apart from anything other than internal mock
setup — asserting the caller-facing response is identical in both.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/facility-info-speech` passes, including the new `AuthIntent` cases

#### Manual Verification:

- None beyond Phase 6's end-to-end call matrix

---

## Phase 5: Infrastructure

### Overview

Wire the new keypad Lambda into Connect the same way `facility-info` is wired, and extend the
existing `SpeechBot` with `AuthIntent`'s slots and confirmation — fixing F-03's decline bug in the
same change that introduces it.

### Changes Required:

#### 1. `infra/lib/infra-stack.ts` (edit) — keypad function

**Intent**: Deploy `lambdas/authenticate/` and associate it with Connect exactly as `facilityInfo`
is.

**Contract**: A new `NodejsFunction` (`Authenticate`) with the same VPC/security-group/timeout/
logging shape as `facilityInfo`, followed by `addPermission('ConnectInvoke', ...)` and a
`CfnIntegrationAssociation`, following `facilityInfo`'s block verbatim.

#### 2. `infra/lib/infra-stack.ts` (edit) — `AuthIntent` on `SpeechBot`

**Intent**: Add PESEL and phone capture to the existing bot without touching its five existing
intents.

**Contract**: Two DTMF-only custom slot types (mirroring the spike's `KeyedDigits` shape — a
single `ORIGINAL_VALUE` sample, no regex/checksum — with `allowAudioInput: false` this time, since
FR-005's resolution keeps this capture DTMF-only and F-03 showed spoken digits are heard but never
fill the slot anyway). An `AuthIntent` with both slots and an `intentConfirmationSetting` that
sets an explicit `declinationResponse` and a `declinationNextStep` re-eliciting the `pesel` slot
— the concrete fix for F-03 Constraint 1. `facilityInfoSpeech` (the existing fulfillment function)
is reused as this intent's code hook; no new Lambda or bot resource is created.

### Success Criteria:

#### Automated Verification:

- `cdk synth` succeeds
- The infra stack's existing `Template.fromStack` assertions still pass, extended to assert the
  new function and the bot's intent count

#### Manual Verification:

- `cdk deploy` succeeds and the new function/intent appear in the console

---

## Phase 6: Contact flow, hand-off, bookkeeping

### Overview

Build the keypad capture flow as a reusable Contact Flow Module, verify both variants end-to-end
on a real call, and document the new contract surfaces.

### Changes Required:

#### 1. Keypad capture flow (console, not committed)

**Intent**: A Contact Flow Module — not inline in the main flow — so S-05 can invoke the same
sub-flow later without rebuilding it. Keys PESEL then phone (each terminated by `#`), reads both
back via Play Prompt, asks for keypad confirmation (1 confirm / 2 re-enter), and on confirmation
invokes the `Authenticate` function with `pesel`, `phone`, and `$.CustomerEndpoint.Address` as
`callerNumber`. Branches on the function's `authenticated` field: `'true'` sets
`authenticated`/`patientId` contact attributes and returns to the main menu with a confirmation
prompt; `'false'` speaks the neutral message and transfers. A declined confirmation or a timeout
re-enters the module from the PESEL prompt, up to three combined attempts before transferring —
using the reserved `0`/`*` global digits and the `lastMessageText` repeat convention throughout,
per `docs/reference/contract-surfaces.md`.

#### 2. Speech-variant contact flow (console, not committed)

**Intent**: Add the `AuthIntent` path to the existing Get Customer Input (Lex) loop, forwarding
`$.CustomerEndpoint.Address` as the `callerNumber` Lex session attribute alongside the existing
`contactId`, and branching on the new `authenticated`/transfer session attributes the same way
the flow already branches on `fallbackCount`.

#### 3. `docs/reference/contract-surfaces.md` (edit)

**Intent**: Document the new load-bearing names this slice introduces, following the file's
existing entry format.

**Contract**: New entries for `callerNumber` (Connect parameter and Lex session attribute),
`authenticated` and `patientId` (contact attribute and Lex session attribute, set on shortcut
success, read by any future slice that needs to know identity was established).

#### 4. Roadmap sync

**File**: `context/foundation/roadmap.md` (edit)

**Intent**: Flip S-03's status to reflect that planning is complete, per this skill's mechanical
roadmap-sync step.

**Contract**: `## At a glance` row for S-03 and the `### S-03` item body both get `Status:
planning`.

### Success Criteria:

#### Automated Verification:

- None — this phase is entirely console configuration and documentation

#### Manual Verification:

- A real call on the keypad variant: correct pair from the registered number authenticates and
  returns to the main menu; correct pair from a different number gets the neutral message and
  transfers; a wrong pair retries up to three times then transfers; declining the read-back
  confirmation re-elicits instead of disconnecting; silence at any prompt behaves the same as a
  declined confirmation
- The same five outcomes verified on the speech variant, with caller-facing wording identical to
  the keypad variant wherever the guardrail requires it (the neutral message; never revealing
  which field was wrong)
- The per-call record for each of the above carries `variant`, `authPath` (only on the
  authenticated case), and a distinguishable `outcome` for the transferred-pending-OTP case

---

## Testing Strategy

### Unit Tests:

- `PatientService.verify` — matched pair, wrong phone with a real PESEL, unknown PESEL (all via
  real Postgres, mirroring `facility.service.spec.ts`)
- `@pcm/patient`'s `authenticate` — shortcut-match, matched-wrong-number, no-match — asserting the
  latter two are indistinguishable from the return shape alone
- `lambdas/authenticate` — authenticated and not-authenticated branches, downstream failure
- `lambdas/facility-info-speech`'s `AuthIntent` branch — same three outcomes, asserting identical
  spoken wording for the two non-shortcut cases

### Integration Tests:

- None beyond the above — this slice has no cross-service integration surface that unit-level
  mocking doesn't already cover

### Manual Testing Steps:

1. Edit the migration's seeded phone number to a real tester's number before deploying
2. Call the keypad variant from that number with the seeded PESEL+phone — expect authentication
3. Call the keypad variant from a different number with the same seeded PESEL+phone — expect the
   neutral message and a transfer
4. Call either variant with a wrong PESEL or phone — expect up to three retries then transfer
5. Decline the read-back confirmation on either variant — expect re-elicitation, not a disconnect
6. Say nothing / press nothing at a prompt — expect the same retry behaviour as a decline

## Performance Considerations

None beyond the existing 2-second timeout already applied to every Lambda in the stack; the new
`Authenticate` function and the extended `facilityInfoSpeech` function reuse that same timeout.

## Migration Notes

Not applicable — no existing data or behaviour changes; this is new persistence and new
capability additive to the existing system.

## References

- Roadmap: `context/foundation/roadmap.md` §S-03
- PRD: `context/foundation/prd.md` §Access Control, §FR-005
- F-03 findings: `context/archive/2026-08-26-lex-keypad-capture-spike/findings.md`
- Precedent plans: `context/archive/2026-08-29-facility-info-keypad/plan.md`,
  `context/archive/2026-08-30-facility-info-speech/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: Patient persistence in `his/`

#### Automated

- [x] 1.1 `npm run test` inside `his/` passes, including the new patient spec — cb0a35c
- [x] 1.2 `npm run migration:run` inside `his/` applies cleanly against a fresh database — cb0a35c

#### Manual

- [ ] 1.3 `POST /patient/verify` returns `matched: true`/`false` correctly, with no extra field on
      a non-match

### Phase 2: Shared `@pcm/patient` authentication module

#### Automated

- [x] 2.1 `npm test --workspace lambdas/patient` passes, covering all three branches — d6e92cc

### Phase 3: Keypad-variant Lambda

#### Automated

- [x] 3.1 `npm test --workspace lambdas/authenticate` passes, covering authenticated,
      not-authenticated, and downstream-failure — 1091400

#### Manual

- [x] 3.2 Direct test-event invocation with the seeded pair and matching `callerNumber` returns
      `authenticated: 'true'`

### Phase 4: Speech-variant fulfillment

#### Automated

- [x] 4.1 `npm test --workspace lambdas/facility-info-speech` passes, including `AuthIntent` cases — 910ee5d

### Phase 5: Infrastructure

#### Automated

- [x] 5.1 `cdk synth` succeeds — 09b52f9
- [x] 5.2 `Template.fromStack` assertions pass, extended for the new function and bot intent count — 09b52f9

#### Manual

- [ ] 5.3 `cdk deploy` succeeds; new function and intent visible in the console

### Phase 6: Contact flow, hand-off, bookkeeping

#### Manual

- [ ] 6.1 Keypad variant: correct pair from registered number authenticates
- [ ] 6.2 Keypad variant: correct pair from a different number gets neutral message + transfer
- [ ] 6.3 Keypad variant: wrong pair retries up to three times then transfers
- [ ] 6.4 Keypad variant: declined confirmation re-elicits instead of disconnecting
- [ ] 6.5 Speech variant: same five outcomes verified, wording identical where required
- [ ] 6.6 Per-call records carry `variant`, `authPath`, and a distinguishable transferred-pending
      -OTP outcome
