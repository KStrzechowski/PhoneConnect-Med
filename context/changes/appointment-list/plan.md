# Appointment List Implementation Plan

## Overview

An authenticated caller hears the list of their scheduled appointments, in both the
keypad and natural-language variants, by extending the same shared business-logic layer
`appointment-booking-both-variants` (S-05) introduced. This is roadmap slice S-06
(FR-013) — cheap breadth over an existing data model, not a new capability.

## Current State Analysis

There is no `Appointment` entity. A `Slot` row (`his/src/appointment/slot.entity.ts:5-30`)
with `taken=true` and `patientId=<id>` *is* the appointment record. `@pcm/appointment`
(`lambdas/appointment/index.ts`) currently has only search-and-book functions
(`findAvailableDays`, `findAvailableTimes`, `resolveDay`, `resolveTime`,
`bookAppointment`) — no read-by-patient query exists yet. S-05's own plan explicitly
deferred this: *"Listing, cancelling, or rescheduling appointments (S-06, S-07, S-08) —
`@pcm/appointment` is built narrowly for search-and-book, not shaped in advance for
those operations."*

Caller identity is already solved: `patientId` (the `Patient.id` integer, not the PESEL)
is available as a keypad contact attribute and a Lex session attribute once
`authenticated` is `'true'` (`docs/reference/contract-surfaces.md:56-95`). No new
identity mechanism is needed.

### Key Discoveries:

- `his/src/appointment/appointment.service.ts:13-58` — existing query style: TypeORM
  query builder, join `slot` to `doctor`, filter, `.limit(3)`, `getRawMany`. The new
  query follows this shape exactly.
- `lambdas/booking/index.ts:1-91` and `lambdas/facility-info-speech/index.ts:116-230` —
  the established pattern: a keypad Lambda destructures `event.Details.Parameters`,
  checks `authenticated`, calls `@pcm/appointment`, returns a flat
  `Record<string, string>`; the speech `dispatch()` function does the identical
  auth-check-then-call inline for intents with no slots (see `AuthIntent`/`InfoIntent`
  branches, `lambdas/facility-info-speech/index.ts:263-339`).
- `docs/reference/contract-surfaces.md:209-231` — "Auth-gate redirect asymmetry": an
  unauthenticated caller pressing the main-menu digit for an authenticated-only
  operation is `TransferToFlow`'d into `keypad-authenticate-flow.json`
  (`connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json:434-484`,
  `CheckAuthForBooking` → `TransferToBookingFlow` / `TransferToAuthenticateFlow`); an
  already-authenticated caller skips straight to the operation. The new digit reuses
  this exact `Compare`-on-`$.Attributes.authenticated` shape.
- `lambdas/facility-info/index.ts:1-25` — the simplest existing keypad Lambda (one
  downstream call, no dialog) is the closest structural precedent for the new Lambda,
  not `lambdas/booking/index.ts`'s multi-step dispatch.
- `formatDayLabel` is currently duplicated verbatim in `lambdas/booking/index.ts:4-8`
  and `lambdas/facility-info-speech/index.ts:110-114`. A third copy would be the third
  independent occurrence of the same formatting logic.

## Desired End State

An authenticated caller, in either variant, asks to hear (keypad: presses a digit;
speech: says an utterance) their scheduled appointments and hears each one as
"<specialty>, <day label>, godzina <time>", soonest first, capped at three, with a
fixed trailing line if more exist. A caller with none hears a clear "no appointments"
message. An unauthenticated caller who reaches for this is routed through
authentication first, identically to how booking already handles it. Verified by:
placing a real call in both variants against a patient with 0, 1–3, and 4+ upcoming
appointments, and confirming the mock is queried through `@pcm/appointment`, never
duplicated in either variant's flow.

## What We're NOT Doing

- No new entity or migration — reuses `Slot`/`Doctor` exactly as S-05 left them.
- No pagination or "press for more" beyond the fixed three-plus-more-line shape —
  matches the precedent S-05 already set for capped day offers.
- No cancel or reschedule action reachable from this list — that is S-07/S-08.
- No change to how identity is established — reuses the existing
  `authenticated`/`patientId` contract as-is.
- No historical/past appointments — only `date >= today`.

## Implementation Approach

Add one new read query to the mock and shared module, one new small keypad Lambda, one
new no-slot Lex intent handled inline in the existing speech dispatcher, and one new
small Contact Flow reachable from two entry points (main menu, already-authenticated;
authenticated menu, freshly-authenticated) — mirroring the two-entry-point shape booking
established, but with a single inline Invoke-then-Play flow instead of a multi-step
sub-flow, since there is no dialog to conduct.

## Critical Implementation Details

**Overflow detection without a second query.** The mock query fetches `LIMIT 4` instead
of `LIMIT 3`. Both variants read only the first three for the spoken message and use the
presence of a fourth row to decide whether to add the "you have more appointments"
line — this avoids a `COUNT(*)` round trip while still avoiding a duplicated "how many
to actually speak" decision between variants (both slice `.slice(0, 3)` /
`.length > 3` from the same array `@pcm/appointment` returns).

**Extract `formatDayLabel` into `@pcm/appointment` on this pass.** It would otherwise be
duplicated a third time (already independently copied into `lambdas/booking/index.ts`
and `lambdas/facility-info-speech/index.ts`). Move it to `lambdas/appointment/index.ts`
as a named export and update both existing call sites to import it, rather than adding a
third local copy — this reduces duplication rather than adding a speculative
abstraction (L-02).

**Two entry points, one small flow.** Like booking, the operation must be reachable both
from an already-authenticated caller at the main menu (skip straight through) and from a
caller who just finished authenticating (lands on the authenticated menu). Follow
booking's `TransferToFlow`-into-a-shared-flow shape for this reason, not two duplicated
inline blocks — even though the content here is one Invoke-and-Play, keeping one source
of truth for the spoken wording avoids the two copies drifting.

## Phase 1: Shared business logic

### Overview

Add the patient-scoped read query to the mock and expose it through `@pcm/appointment`.

### Changes Required:

#### 1. Mock query and endpoint

**File**: `his/src/appointment/appointment.service.ts`

**Intent**: Add a method returning a patient's upcoming taken slots, joined to the
doctor for specialty, soonest first, capped at four rows (three to speak, a fourth to
detect overflow).

**Contract**: `findAppointmentsForPatient(patientId: number): Promise<{ specialty: string; date: string; time: string }[]>` — filters `slot.patientId = :patientId AND slot.taken = true AND slot.date >= CURRENT_DATE`, orders by `slot.date ASC, slot.time ASC`, `LIMIT 4`, same query-builder style as `findAvailableDays`.

**File**: `his/src/appointment/appointment.controller.ts`

**Intent**: Expose the new query over HTTP.

**Contract**: `GET /appointment/mine?patientId=<id>` → `{ appointments: { specialty: string; date: string; time: string }[] }`.

#### 2. Shared module

**File**: `lambdas/appointment/index.ts`

**Intent**: Wrap the new endpoint for both variants to call, and host the extracted
`formatDayLabel` so it has one home instead of two independent copies.

**Contract**: `listAppointments(patientId: number, signal: AbortSignal): Promise<{ specialty: string; date: string; time: string }[]>` (thin `fetch` wrapper, same shape as `findAvailableDays`); `formatDayLabel(dateStr: string): string` moved here verbatim from `lambdas/booking/index.ts`.

**File**: `lambdas/booking/index.ts`, `lambdas/facility-info-speech/index.ts`

**Intent**: Import `formatDayLabel` from `@pcm/appointment` instead of defining it locally.

**Contract**: Delete the local definition in both files; add `formatDayLabel` to each file's existing `@pcm/appointment` import.

### Success Criteria:

#### Automated Verification:

- `his/` unit tests pass, including new cases in `appointment.service.spec.ts`: a booked upcoming slot is returned by `findAppointmentsForPatient`, a patient with no bookings gets an empty array, and a past-dated taken slot (if any exist in fixtures) is excluded
- `lambdas/appointment` unit tests pass, including a new case for `listAppointments` mirroring the existing `findAvailableDays` test style (mock `fetch`, assert the returned array)
- `lambdas/booking` and `lambdas/facility-info-speech` unit tests still pass unchanged after the `formatDayLabel` import switch
- Type checking passes across `his/`, `lambdas/appointment`, `lambdas/booking`, `lambdas/facility-info-speech`

#### Manual Verification:

- With the mock running locally against seeded data, booking a slot for a test patient via `POST /appointment/book` and then calling `GET /appointment/mine?patientId=<id>` returns that slot

---

## Phase 2: Keypad Lambda

### Overview

Add the keypad-facing Lambda that checks auth, calls `listAppointments`, and formats the
result as flat Connect output fields.

### Changes Required:

#### 1. New Lambda package

**File**: `lambdas/appointment-list/index.ts` (new package, mirroring `lambdas/appointment/package.json` / `lambdas/booking/package.json`'s `package.json`/`tsconfig.json` shape, workspace-referenced as `@pcm/appointment` dependency)

**Intent**: The keypad entry point — checks `authenticated`, fetches the caller's appointments, and returns up to three formatted lines plus an overflow flag, following `lambdas/facility-info/index.ts`'s single-downstream-call shape rather than `lambdas/booking/index.ts`'s multi-step dispatch (there is no multi-step dialog here).

**Contract**: `export const handler = measured('appointment-list', ...)`. Reads `authenticated`, `patientId` from `event.Details?.Parameters` (same convention as `lambdas/booking/index.ts:13-23`); returns `{ needsAuth: 'true' }` if not authenticated (defensive, matching booking's own defensive check even though the contact flow gates before invoking); otherwise returns `{ reachable: 'true', hasAppointments: 'false' }` for an empty list, or `{ reachable: 'true', hasAppointments: 'true', hasMore: 'true'|'false', appt1, appt2, appt3 }` (each `appt<N>` a string like `"kardiolog, wtorek 9 września, godzina 10:00"`, empty string when absent) for a non-empty one; on a downstream error, `{ reachable: 'false', error }` with `record.outcome = 'error'`, matching every existing handler's catch shape.

**File**: `lambdas/appointment-list/index.test.ts`

**Intent**: Unit-test the handler's three branches (needs-auth, empty list, populated list with and without overflow) by stubbing `@pcm/appointment`'s `listAppointments`, mirroring `lambdas/booking/index.test.ts`'s style of mocking the shared module rather than `fetch` directly.

#### 2. Infra registration

**File**: `infra/lib/infra-stack.ts`

**Intent**: Register the new Lambda the same way `booking` is registered — same VPC/security-group/environment/timeout/log-group shape, an explicit `functionName` per L-04, a Connect invoke permission, and a `CfnIntegrationAssociation` so it is invocable from a contact flow.

**Contract**: `const appointmentList = new NodejsFunction(this, 'AppointmentList', { functionName: 'phoneconnect-med-appointment-list', entry: '.../lambdas/appointment-list/index.ts', ...same props as `booking` at `infra/lib/infra-stack.ts:386-400` })`, followed by `.addPermission('ConnectInvoke', ...)` and `new connect.CfnIntegrationAssociation(this, 'AppointmentListFunctionAssociation', ...)`, plus a `CfnOutput` for its function name (mirroring `BookingFunctionName`).

### Success Criteria:

#### Automated Verification:

- `lambdas/appointment-list` unit tests pass
- `infra/test/infra.test.ts` passes, including a new assertion that `AppointmentList` is named per convention and reaches the mock over the VPC (mirroring the existing `Booking` assertion)
- `cdk synth` succeeds

#### Manual Verification:

- Invoking the deployed `AppointmentList` function directly (test event) against a seeded authenticated patient returns the expected formatted fields

---

## Phase 3: Speech intent

### Overview

Add a no-slot `ListAppointmentsIntent`, handled inline in the existing speech
dispatcher exactly like `InfoIntent`/`AuthIntent` are.

### Changes Required:

#### 1. Dispatch branch

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: Handle `ListAppointmentsIntent` inline in `dispatch()` (no dialog code hook needed — there are no slots to elicit). Check `incoming.authenticated`; if not `'true'`, close with `needsAuth: 'true'` and a spoken prompt, exactly matching `handleBookingDialog`'s auth-check shape (`lambdas/facility-info-speech/index.ts:124-127`) so the same `needsAuth`-loop-back-to-`AuthIntent` mechanism `BookingIntent` already uses applies here too (Lex has no mid-turn intent switch, per `docs/reference/contract-surfaces.md:224-227`). If authenticated, call `listAppointments(Number(incoming.patientId), ...)` and build one spoken sentence from the (up to three) results plus the same overflow line the keypad variant uses, reusing the imported `formatDayLabel`.

**Contract**: New `if (intentName === 'ListAppointmentsIntent') { ... }` block in `dispatch()`, added alongside the existing `InfoIntent`/`AuthIntent`/`OtpIntent` branches (`lambdas/facility-info-speech/index.ts:263-339`), following their exact try/catch/`close()` shape including the error-path transfer.

#### 2. Infra: new intent

**File**: `infra/lib/infra-stack.ts`

**Intent**: Register `ListAppointmentsIntent` as a global-style intent (no slots, fulfillment only) using the existing `globalIntent` helper, exactly like `InfoIntent`.

**Contract**: `globalIntent('ListAppointmentsIntent', listAppointmentsUtterances)` added to the `intents` array (`infra/lib/infra-stack.ts:506-510`), with a new `listAppointmentsUtterances` array declared alongside `infoUtterances`/`bookingUtterances` (`infra/lib/infra-stack.ts:50-134`).

### Success Criteria:

#### Automated Verification:

- `lambdas/facility-info-speech` unit tests pass, including new cases for `ListAppointmentsIntent`'s needs-auth, empty, populated, and error branches
- `infra/test/infra.test.ts` passes, including a new assertion that the speech bot's intent list includes `ListAppointmentsIntent` (mirroring the existing "has all global-layer intents plus AuthIntent, OtpIntent and BookingIntent" assertion)
- `cdk synth` succeeds

### Manual Verification:

- In the Lex V2 console test window, an authenticated test session for `ListAppointmentsIntent` returns the expected spoken list

---

## Phase 4: Contact flow and hand-off

### Overview

Wire the two keypad entry points and hand-import the updated flow templates into the
real Connect instance, then verify both variants end-to-end on a real call.

### Changes Required:

#### 1. New flow: appointment list

**File**: `connect-flow-templates/flows/keypad-appointment-list-flow.json` (new)

**Intent**: A single Invoke-AppointmentList-then-Play flow, reachable via `TransferToFlow` from both entry points below. On `needsAuth` (defensive), on `hasAppointments: 'false'`, and on the populated case (with the overflow line when `hasMore: 'true'`), play the corresponding message, set `lastMessageText` per the existing convention (`docs/reference/contract-surfaces.md:20-30`), then loop back to `keypad-authenticated-menu-flow.json`. On `reachable: 'false'`, transfer to the agent queue (FR-007).

**Contract**: Mirrors `keypad-booking-flow.json`'s Invoke-Lambda-then-branch-on-output-fields shape, but single-step (no `step` parameter, no confirmation turn).

#### 2. Main menu: new digit

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`

**Intent**: Add digit `3` ("hear my appointments"), gated the same way digit `2` (booking) already is.

**Contract**: A new `Compare` block on `$.Attributes.authenticated` (mirroring `CheckAuthForBooking`, `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json:434-462`) branching to `TransferToFlow` → `keypad-appointment-list-flow.json` when `'true'`, or reusing the existing `TransferToAuthenticateFlow` target when not.

#### 3. Authenticated menu: new digit

**File**: `connect-flow-templates/flows/keypad-authenticated-menu-flow.json`

**Intent**: Add digit `2` ("hear my appointments") alongside the existing digit `1` (booking).

**Contract**: `TransferToFlow` → `keypad-appointment-list-flow.json`, parallel to how digit `1` transfers to `keypad-booking-flow.json`.

#### 4. Contract surfaces registration

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Record the two new reserved digits (main menu `3`, authenticated menu `2`) and the new `hasAppointments`/`hasMore`/`appt1`/`appt2`/`appt3` output-field contract, following the existing entry format.

**Contract**: New `##` sections following the pattern of the existing `Details.Parameters.step` / ... (S-05) entry.

### Success Criteria:

#### Automated Verification:

- N/A — this phase is entirely hand-built contact flow configuration and console import, outside IaC and outside the test suite, per the project's recorded baseline decision

#### Manual Verification:

- Flow templates hand-imported/merged into the real Connect instance per `connect-flow-templates/README.md`'s convention
- Keypad, already authenticated (from a prior call or seeded caller-ID match): press main-menu digit 3 → hear the appointment list directly
- Keypad, not authenticated: press main-menu digit 3 → routed through `keypad-authenticate-flow.json` → lands on `keypad-authenticated-menu-flow.json` → press digit 2 → hear the appointment list
- Keypad: a patient with zero upcoming appointments hears the "no appointments" message
- Keypad: a patient with more than three upcoming appointments hears three plus the overflow line
- Speech, authenticated: an utterance for `ListAppointmentsIntent` returns the spoken list directly
- Speech, not authenticated: the same utterance closes with the identify-yourself prompt, then the caller authenticates via `AuthIntent` and repeats the request
- Mock unreachable (simulated): both variants transfer to the agent queue rather than erroring to the caller
- `0`/`*` (transfer/repeat) still work correctly while at the new flow/intent, per L-05

---

## Testing Strategy

### Unit Tests:

- `his/src/appointment/appointment.service.spec.ts`: `findAppointmentsForPatient` — returns upcoming booked slots sorted chronologically, excludes past dates, returns empty for a patient with none, caps at four rows
- `lambdas/appointment/index.test.ts`: `listAppointments` returns the mock's response array (mirroring existing `findAvailableDays` test style)
- `lambdas/appointment-list/index.test.ts`: needs-auth, empty, populated-under-cap, populated-over-cap (overflow line), and downstream-error branches
- `lambdas/facility-info-speech/index.test.ts` (or equivalent): the four `ListAppointmentsIntent` branches above

### Integration Tests:

- None beyond the existing `infra/test/infra.test.ts` CDK synth assertions — no new integration-test harness introduced

### Manual Testing Steps:

See Phase 4's Manual Verification — this is where the end-to-end scenarios live, since they require a real call against the deployed system.

## Performance Considerations

None beyond the existing per-request 1-second `AbortSignal.timeout` and 2-second Lambda
timeout convention every other handler in this repo already uses.

## Migration Notes

None — no schema change. Reuses `Slot`/`Doctor` as already migrated by S-05
(`his/src/migrations/1788469015011-CreateAppointment.ts`).

## References

- Roadmap slice: `context/foundation/roadmap.md` → S-06 (`appointment-list`)
- PRD: `context/foundation/prd.md` → FR-013
- Prior art (booking, in-progress): `context/pending-verification/appointment-booking-both-variants/plan.md`
- Prior art (simplest read-only slice): `context/archive/2026-08-29-facility-info-keypad/plan.md`
- Contract surfaces: `docs/reference/contract-surfaces.md`
- Lessons: `context/foundation/lessons.md` → L-02, L-03, L-04, L-05, L-06

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared business logic

#### Automated

- [x] 1.1 `his/` unit tests pass, including new `findAppointmentsForPatient` cases — 61a308d
- [x] 1.2 `lambdas/appointment` unit tests pass, including new `listAppointments` case — 61a308d
- [x] 1.3 `lambdas/booking` and `lambdas/facility-info-speech` unit tests still pass after the `formatDayLabel` import switch — 61a308d
- [x] 1.4 Type checking passes across `his/`, `lambdas/appointment`, `lambdas/booking`, `lambdas/facility-info-speech` — 61a308d

#### Manual

- [ ] 1.5 `GET /appointment/mine?patientId=<id>` returns a slot booked via `POST /appointment/book` for that patient

### Phase 2: Keypad Lambda

#### Automated

- [x] 2.1 `lambdas/appointment-list` unit tests pass
- [x] 2.2 `infra/test/infra.test.ts` passes, including the new `AppointmentList` naming/VPC assertion
- [x] 2.3 `cdk synth` succeeds

#### Manual

- [ ] 2.4 Direct invocation of the deployed `AppointmentList` function against a seeded authenticated patient returns the expected fields

### Phase 3: Speech intent

#### Automated

- [ ] 3.1 `lambdas/facility-info-speech` unit tests pass, including the four new `ListAppointmentsIntent` branches
- [ ] 3.2 `infra/test/infra.test.ts` passes, including the new `ListAppointmentsIntent` presence assertion
- [ ] 3.3 `cdk synth` succeeds

#### Manual

- [ ] 3.4 Lex V2 console test window returns the expected spoken list for an authenticated test session

### Phase 4: Contact flow and hand-off

#### Manual

- [ ] 4.1 Flow templates hand-imported/merged into the real Connect instance
- [ ] 4.2 Keypad, already authenticated: main-menu digit 3 → direct list
- [ ] 4.3 Keypad, not authenticated: main-menu digit 3 → authenticate → authenticated-menu digit 2 → list
- [ ] 4.4 Keypad: zero-appointments message verified
- [ ] 4.5 Keypad: overflow (4+) line verified
- [ ] 4.6 Speech, authenticated: direct list via `ListAppointmentsIntent`
- [ ] 4.7 Speech, not authenticated: needs-auth prompt → `AuthIntent` → repeat request
- [ ] 4.8 Mock-unreachable case transfers to agent queue in both variants
- [ ] 4.9 Global `0`/`*` digits still work at the new flow/intent
