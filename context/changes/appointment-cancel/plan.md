# Appointment Cancel Implementation Plan

## Overview

An authenticated caller cancels one of their scheduled appointments, releasing the slot, in
both the keypad and natural-language variants (roadmap slice S-07, FR-014). Both variants
reach identical business logic (L-03): a shared `resolveAppointment`/`cancelAppointment` pair
in `@pcm/appointment`, driven by a position digit the caller selects from their own upcoming
list — never a raw database ID.

## Current State Analysis

- The `Slot` row (`his/src/appointment/slot.entity.ts`) that S-05 introduced already models
  cancellation as its own inverse: `taken=true, patientId=<id>` is a booked slot;
  `taken=false, patientId=null` is a free one. No new entity, column, or migration is needed.
- `AppointmentService.book()` (`his/src/appointment/appointment.service.ts`) is the mirror image
  of the method this plan adds: it finds a free slot matching a full set of criteria and flips
  `taken`/`patientId` one way; cancel flips them the other way.
- `findAppointmentsForPatient()` (same file) already returns the ordered, capped list of a
  patient's upcoming appointments (`specialty`, `date`, `time`) that S-06 built for the "hear my
  appointments" feature — this plan reuses it as the source list for cancel's selection menu, but
  does not reuse S-06's contact flow or Lambda output shape (see Key Discoveries).
- `lambdas/appointment/index.ts` (`@pcm/appointment`) already has the exact shape this plan's
  shared functions need to follow: `resolveDay`/`resolveTime` each re-fetch a fresh list and index
  into it by a 1-based position (`dayChoice - 1`), never storing or trusting a caller-passed date;
  `bookAppointment` is a thin `fetch` wrapper around a mock endpoint.
- `lambdas/facility-info-speech/index.ts`'s `handleBookingDialog`/`handleBookingFulfillment` is the
  direct precedent for `CancelIntent`'s dialog code hook: a `stage` session attribute drives a
  small state machine, each stage re-derives its data from the shared layer using only the digit
  choice carried in session attributes, and `intentConfirmationSetting` (not the standalone
  `ConfirmationIntent`/`DenyIntent` intents documented in `lex-sample-utterances.md` but never
  implemented anywhere in `infra-stack.ts`) is Lex's native yes/no mechanism for the final confirm
  turn.
- `connect-flow-templates/flows/keypad-booking-flow.json` is the direct precedent for the new
  keypad flow's shape: a shared `bookingInputAttempts` counter across every `GetParticipantInput`
  block (L-05), a separate `availabilityAttempts` counter for "the resolved choice turned out
  invalid" (as opposed to "the digit itself was malformed"), and every menu wiring `0`/`*`/`#`
  alongside its own digits.
- Menu digits already in use: main menu `1`=facility info, `2`=book, `3`=list
  (`keypad-facility-info-main-menu-flow.json`); authenticated menu `1`=book, `2`=list
  (`keypad-authenticated-menu-flow.json`). Both menus already reserve `0`/`*` globally.

## Desired End State

An authenticated caller who wants to cancel an appointment, in either variant, hears their
upcoming appointments, selects one by its number, hears it read back with a request to confirm,
and — on confirming — hears that it was cancelled, with the underlying slot released and bookable
again. An unauthenticated caller reaching for this option is transparently routed through
authentication first, exactly as booking and list already handle it. A caller with no upcoming
appointments hears that clearly instead of an empty or confusing menu. A downstream failure at any
step transfers the caller to an agent rather than erroring the call.

### Key Discoveries:

- `his/src/appointment/appointment.service.ts:47` (`findAppointmentsForPatient`) selects
  `specialty`/`date`/`time` only — no `slot.id`. This plan does not add one: cancel resolves a slot
  the same way booking resolves a day/time, by re-deriving it from a fresh list query rather than
  carrying an ID across the call.
- `.reference/legacy-src/lambda/cancel-appointment/index.ts` (a discarded earlier design) had the
  caller speak/key a real `appointmentId` and stored resolved `cancelCandidates` in a session
  attribute. This plan deliberately does not follow that shape — it conflicts with L-03 and with
  every mechanism this codebase's current architecture (S-05/S-06) actually uses.
- `docs/reference/contract-surfaces.md`'s "Keypad digits" entry for S-06 documents an asymmetric
  digit pattern (`3` at the main menu, `2` at the authenticated menu) precisely because each menu
  already has its own occupied digits at different positions. Cancel continues that asymmetry:
  `4` at the main menu (after `1`/`2`/`3`), `3` at the authenticated menu (after `1`/`2`).

## What We're NOT Doing

- Rescheduling (FR-015 / roadmap S-08) — a separate slice that depends on this one, not a bundled
  extension of it.
- Agent-workspace cancellation (FR-017 / roadmap S-12) — a separate slice with its own
  prerequisites, this one included.
- Any new entity, migration, or persistence change.
- Exposing a real appointment/slot database ID anywhere in a flow, prompt, or session attribute.
- A same-turn "resume" for the auth-gate redirect — this plan reuses the exact asymmetric
  redirect mechanism S-05 already built and documented (see contract-surfaces.md's "Auth-gate
  redirect asymmetry between variants"), not a new one.

## Implementation Approach

Same shape as every prior slice: thin mock endpoint → thin `@pcm/appointment` wrapper → a keypad
Lambda and a speech-intent branch that both call the identical shared functions (L-03). The keypad
Lambda is step-based like `lambdas/booking`, with three steps (`list`, `confirm`, `cancel`) rather
than booking's four, since there is no analogue to booking's two-parameter search phase — the
input to every step is just the caller's own patient ID and (for `confirm`/`cancel`) the position
digit they chose. The contact flow builds its own selection menu directly from the `list` step's
output rather than transferring through the existing `keypad-appointment-list-flow.json` — that
flow's fixed 3-line announcement-and-exit shape doesn't carry a digit-selection menu, and forking
it or adding a new exit branch would be more wiring for less real reuse than duplicating the
~4-line formatter each Lambda already independently carries (S-06's own Lambda and speech handler
already each have their own copy).

## Phase 1: Shared business logic

### Overview

Add the mock-side cancel endpoint and the shared-layer functions both variants will call: one to
resolve a position digit against the caller's own upcoming list, one to actually release the slot.

### Changes Required:

#### 1. HIS appointment service — cancel method

**File**: `his/src/appointment/appointment.service.ts`

**Intent**: Add a `cancel` method that is `book`'s mirror image — instead of finding a free slot
matching a search and marking it taken, find a taken slot matching the patient's identity and the
appointment's date/time, and free it.

**Contract**: `cancel(date: string, time: string, patientId: number): Promise<boolean>`. Matches a
slot where `patientId = :patientId AND date = :date AND time = :time AND taken = true`; on a match,
updates `taken = false, patientId = null`; returns whether a row was affected. No `specialty`
parameter — `patientId` + `date` + `time` is already the granularity `findAppointmentsForPatient`
exposes to callers, and a patient cannot hold two appointments at the same date and time.

#### 2. HIS appointment controller — cancel route

**File**: `his/src/appointment/appointment.controller.ts`

**Intent**: Expose the new service method as a mock HTTP endpoint, following the existing `book`
route's shape exactly.

**Contract**: `POST /appointment/cancel`, body `{ date: string, time: string, patientId: number }`,
response `{ cancelled: boolean }`.

#### 3. HIS appointment service test

**File**: `his/src/appointment/appointment.service.spec.ts`

**Intent**: Cover the new method the same way `book`'s tests do: a successful cancel that frees the
slot for rebooking, and a no-op cancel against a slot that doesn't match (already free, or wrong
patient/date/time).

**Contract**: New `it(...)` blocks following the file's existing `describe('AppointmentService')`
structure and `releasePatientSlots` helper.

#### 4. `@pcm/appointment` — resolve and cancel wrappers

**File**: `lambdas/appointment/index.ts`

**Intent**: Add the shared-layer pair every variant calls: one to turn "the caller's 1-based
position choice" into the actual appointment (specialty/date/time), one to call the new mock
endpoint.

**Contract**:

```ts
export const resolveAppointment = async (
  patientId: number,
  selectedSlot: number,
  signal: AbortSignal,
): Promise<{ specialty: string; date: string; time: string } | null> => {
  const appointments = await listAppointments(patientId, signal);
  return appointments[selectedSlot - 1] ?? null;
};

export const cancelAppointment = async (
  date: string,
  time: string,
  patientId: number,
  signal: AbortSignal,
): Promise<boolean> => { /* POST /appointment/cancel, mirroring bookAppointment's fetch shape */ };
```

`resolveAppointment` re-fetches the list on every call rather than accepting a caller-passed list —
same reasoning as `resolveDay`/`resolveTime`: the position must be resolved against fresh data,
never trusted across a call boundary.

#### 5. `@pcm/appointment` tests

**File**: `lambdas/appointment/index.test.ts`

**Intent**: Cover `resolveAppointment`'s in-range/out-of-range behavior and `cancelAppointment`'s
request shape, following this file's existing `resolveDay`/`bookAppointment` test patterns (mocked
`fetch`).

### Success Criteria:

#### Automated Verification:

- HIS unit tests pass: `cd his && npm test`
- `@pcm/appointment` unit tests pass: `cd lambdas/appointment && npm test`
- Type checking passes across touched packages
- Linting passes

#### Manual Verification:

- None required for this phase — pure business logic, fully covered by automated tests.

---

## Phase 2: Keypad Lambda

### Overview

A new step-based Lambda (`lambdas/appointment-cancel`), mirroring `lambdas/booking`'s
`step`-dispatch shape, exposing `list` / `confirm` / `cancel` steps for the new contact flow to
drive.

### Changes Required:

#### 1. Keypad Lambda

**File**: `lambdas/appointment-cancel/index.ts`

**Intent**: One `measured('appointment-cancel', ...)` handler, dispatching on
`event.Details.Parameters.step`.

**Contract**:

- Every step short-circuits with `{ needsAuth: 'true' }` when `authenticated !== 'true'`, matching
  `lambdas/appointment-list/index.ts` and `lambdas/booking/index.ts`.
- `step: 'list'` — calls `listAppointments`, returns `{ reachable, hasAppointments, appt1, appt2,
  appt3 }` (three fixed fields, same formatter shape as `lambdas/appointment-list/index.ts`'s
  `formatAppointment`, duplicated locally rather than imported — each Lambda already keeps its own
  copy, per the Implementation Approach above). No `hasMore` field: unlike S-06's read-only list,
  cancel's list is a selection menu capped at exactly 3 choices, not an announcement of "more
  exist."
- `step: 'confirm'` — input `selectedSlot` (the 1/2/3 digit, as a string). Calls
  `resolveAppointment(patientId, Number(selectedSlot), signal)`. Returns `{ reachable, found:
  'false' }` when it resolves to `null` (selection didn't match any current appointment — stale
  count or bad digit); otherwise `{ reachable, found: 'true', message: '<specialty>, <day label>,
  godzina <time>' }`.
- `step: 'cancel'` — input `selectedSlot` again (not a stored date/time — re-resolved fresh, same
  reasoning as booking's `invokeBook` step re-deriving from `dayChoice`/`timeChoice` rather than a
  stored date/time). Calls `resolveAppointment` again, then `cancelAppointment` with the resolved
  date/time. Returns `{ reachable, found: 'false' }` if resolution fails, else `{ reachable, found:
  'true', cancelled: 'true' | 'false' }`.
- All three steps: any thrown error → `record.outcome = 'error'`, `{ reachable: 'false', error:
  message }`, matching every existing Lambda's `downstream`/try-catch shape.

#### 2. Event fixture

**File**: `lambdas/appointment-cancel/event.sample.json`

**Intent**: Base fixture for tests, following `lambdas/appointment-list/event.sample.json`'s shape.

#### 3. Keypad Lambda tests

**File**: `lambdas/appointment-cancel/index.test.ts`

**Intent**: Cover each step's success/edge/error paths, following
`lambdas/appointment-list/index.test.ts`'s `mock.method(globalThis, 'fetch', ...)` pattern: auth
gate on every step, empty list, populated list, `confirm` with a valid vs. out-of-range
`selectedSlot`, `cancel` success vs. `cancelled: 'false'` (race/stale), and a mock-unreachable error
on each step.

#### 4. Package scaffolding

**Files**: `lambdas/appointment-cancel/package.json`, `lambdas/appointment-cancel/tsconfig.json`

**Intent**: Copy `lambdas/appointment-list`'s scaffolding verbatim (same dependencies: `@pcm/measure`,
`@pcm/appointment`).

#### 5. Infra registration

**File**: `infra/lib/infra-stack.ts`

**Intent**: Register the new Lambda following the `appointmentList` `NodejsFunction` block
immediately above it verbatim (same `vpc`, `environment`, `timeout`, `logGroup` shape), plus its
`ConnectInvoke` permission and `CfnIntegrationAssociation`.

**Contract**: `functionName: 'phoneconnect-med-appointment-cancel'` (L-04), entry
`lambdas/appointment-cancel/index.ts`.

### Success Criteria:

#### Automated Verification:

- Keypad Lambda unit tests pass: `cd lambdas/appointment-cancel && npm test`
- `cdk synth` succeeds with the new function and integration association
- Type checking and linting pass

#### Manual Verification:

- None required for this phase in isolation — the Lambda has no contact-flow entry point yet.
  Covered end-to-end in Phase 4.

---

## Phase 3: Speech intent

### Overview

A new `CancelIntent` in the Lex bot definition and a matching dialog/fulfillment branch in
`lambdas/facility-info-speech/index.ts`, mirroring `BookingIntent`'s shape.

### Changes Required:

#### 1. Lex intent definition

**File**: `infra/lib/infra-stack.ts`

**Intent**: Add `CancelIntent` to the bot's `intents` array, immediately after `BookingIntent`,
using the `CancelIntent` sample utterances already documented in `lex-sample-utterances.md`.

**Contract**: `dialogCodeHook: { enabled: true }`, `fulfillmentCodeHook: { enabled: true }`, one
slot (`selectedSlot`, type `AMAZON.Number`, reused as the position choice exactly as
`BookingIntent` reuses its own `selectedSlot` for both day and time), and a native
`intentConfirmationSetting` for the final yes/no turn (not the standalone `ConfirmationIntent`/
`DenyIntent` intents — see Current State Analysis). `declinationNextStep` resets `selectedSlot`
via `slotValueOverride: {}`, matching `BookingIntent`'s own decline handling.

#### 2. Sample utterances constant

**File**: `infra/lib/infra-stack.ts` (wherever `bookingUtterances`/`listAppointmentsUtterances` are
declared)

**Intent**: Add a `cancelUtterances` constant from `lex-sample-utterances.md`'s `CancelIntent`
list.

#### 3. Dialog code hook

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: A `handleCancelDialog` function mirroring `handleBookingDialog`'s stage machine, but
with two stages instead of three (no upfront slot-collection phase — there's nothing to collect
before the list itself).

**Contract**: A `cancelStage` session attribute (`''` / `'select'`):

- `stage === ''` (first turn): auth-gate check (`needsAuth`, matching every other intent); call
  `listAppointments`; if empty, `close` with the "no appointments" message; otherwise elicit
  `selectedSlot` with the numbered list as the prompt, set `cancelStage: 'select'`.
- `stage === 'select'`: read `selectedSlot` from the slot value, call `resolveAppointment`; if
  `null`, retry-elicit `selectedSlot` (bounded by a `cancelAttempts` counter, giving up and
  transferring after the limit — same shape as `BOOKING_ATTEMPT_LIMIT`); otherwise
  `confirmIntent(...)` with the read-back message, storing the resolved `date`/`time` is **not**
  done — only `selectedSlot` persists in session attributes, re-resolved at fulfillment.

#### 4. Fulfillment code hook

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: A `handleCancelFulfillment` function mirroring `handleBookingFulfillment`: re-resolve
the appointment from `selectedSlot` one more time, call `cancelAppointment`, and close with success
or the "could not cancel" message (matching Q1's answer — no retry loop here, mirrors
`handleBookingFulfillment`'s single-attempt shape, not `handleBookingDialog`'s retry loop).

#### 5. Dispatch wiring

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: Add a `CancelIntent` branch to `dispatch`, following the existing `BookingIntent`
branch's `invocationSource` check verbatim.

### Success Criteria:

#### Automated Verification:

- Speech Lambda unit tests pass (new tests covering `CancelIntent`'s dialog/fulfillment paths,
  following the file's existing `BookingIntent` test patterns — confirm whether
  `lambdas/facility-info-speech` has an existing test file and match its structure, or create one
  following the sibling Lambdas' `node:test` convention if none exists)
- `cdk synth` succeeds with the new Lex intent
- Type checking and linting pass

#### Manual Verification:

- None required for this phase in isolation — the intent has no contact-flow wiring yet. Covered
  end-to-end in Phase 4.

---

## Phase 4: Contact flow & hand-off

### Overview

A new keypad contact flow reachable from both menus (matching booking's and list's two-entry-point
precedent), the two new menu digits, `contract-surfaces.md` documentation, and real-call
verification of both variants.

### Changes Required:

#### 1. New keypad flow

**File**: `connect-flow-templates/flows/keypad-appointment-cancel-flow.json`

**Intent**: A self-contained flow with its own listing step (per the Flow shape decision), a
selection menu, a confirm step, and the cancel action — structurally `keypad-booking-flow.json`
shrunk to three `InvokeExternalResource` steps instead of four, crossed with
`keypad-appointment-list-flow.json`'s auth/reachability/empty-list branching at the top.

**Contract**: Two shared attempt counters, both reset at flow entry and both capped at 3 (L-05):

- `cancelInputAttempts` — bumped on `NoMatchingCondition`/`InputTimeLimitExceeded` at both the
  selection menu and the confirm menu (one shared counter across both `GetParticipantInput`
  blocks, matching `keypad-booking-flow.json`'s single `bookingInputAttempts` across all of its
  menus).
- `cancelSelectionAttempts` — bumped when the `confirm` step returns `found: 'false'`, looping back
  to the selection menu (mirrors `availabilityAttempts`/`bumpAvailabilityAttempts`).

Every `GetParticipantInput` block wires `0` (transfer), `*` (repeat, via the `lastMessageText`
contact attribute), and `#` (return to main menu — this flow is a sub-menu deep enough to need it,
same as booking). The selection menu unconditionally wires digits `1`/`2`/`3` to
`selectedSlot` regardless of how many appointments actually exist, exactly as
`keypad-booking-flow.json`'s `daysMenu`/`timesMenu` unconditionally wire `1`/`2`/`3` — an
out-of-range choice is caught downstream by the `confirm` step's `found: 'false'`, not by the menu
itself. The final `cancel` step's `cancelled: 'false'` outcome plays a failure message and
transfers to the authenticated menu directly (Q1's answer — no retry loop, unlike the
`availabilityAttempts` loop above it). Confirm-step decline (`2`) transfers directly to the
authenticated menu (no loop back to selection — the caller already chose once).

#### 2. Main menu digit

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`

**Intent**: Add digit `4` ("Naciśnij 4, aby odwołać wizytę"), gated by the same
`Compare`-on-`$.Attributes.authenticated` pattern as `CheckAuthForBooking`/
`CheckAuthForAppointmentList` — unauthenticated routes through `keypad-authenticate-flow.json`
first; authenticated transfers straight into `keypad-appointment-cancel-flow.json`.

**Contract**: New `CheckAuthForAppointmentCancel` compare block, new prompt text digit, following
the existing `CheckAuthForAppointmentList` block verbatim.

#### 3. Authenticated menu digit

**File**: `connect-flow-templates/flows/keypad-authenticated-menu-flow.json`

**Intent**: Add digit `3` ("Naciśnij 3, aby odwołać wizytę"), transferring straight into
`keypad-appointment-cancel-flow.json`.

#### 4. `contract-surfaces.md` update

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Document the new menu digits (mirroring the existing "Keypad digits: main menu `3`,
authenticated menu `2` (S-06)" entry) and the new Lambda output fields
(`found`/`cancelled`/`message`, mirroring the existing `hasAppointments`/`hasMore`/`appt1..3`
entry).

### Success Criteria:

#### Automated Verification:

- `cdk synth` succeeds with both menu flows' referenced Lambda ARNs resolvable
- Full test suite passes: repo-wide test command
- Linting and type checking pass repo-wide

#### Manual Verification:

- A real call, keypad variant: from the main menu, digit `4` as an unauthenticated caller routes
  through authentication and lands able to reach cancel from the authenticated menu; as an
  authenticated caller, digit `4` (main menu) and digit `3` (authenticated menu) both reach the
  cancel flow directly.
- A real call, keypad variant: a caller with zero appointments hears the empty message and returns
  to the authenticated menu without a dead end.
- A real call, keypad variant: a caller with one or more appointments selects one by digit, hears
  it read back, confirms, hears success, and the slot is verifiably free again (rebookable via the
  booking flow).
- A real call, keypad variant: pressing `0`/`*`/`#` at each input step behaves per L-05; 3 invalid
  selection-digit presses and 3 invalid confirm-digit presses each transfer to an agent.
- A real call, speech variant: an authenticated caller says a `CancelIntent` utterance, hears their
  list, states a number, hears the read-back, confirms with "tak", and hears success.
- A real call, speech variant: an unauthenticated caller reaching for `CancelIntent` is routed
  through the same `needsAuth`/`AuthIntent` loop-back booking already established.
- A mock outage at any step, either variant, transfers the caller to an agent rather than erroring
  the call.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding further. Flows are hand-built outside IaC (L-06) — commit the generated JSON alongside
the code that wires it, per L-06.

---

## Testing Strategy

### Unit Tests:

- HIS `AppointmentService.cancel`: successful cancel frees the slot; no-op against an
  already-free/mismatched slot.
- `@pcm/appointment`'s `resolveAppointment`/`cancelAppointment`: in-range and out-of-range
  resolution; request shape and error propagation for the cancel call.
- Keypad Lambda: auth gate on all three steps; `list` empty/populated; `confirm` valid/invalid
  selection; `cancel` success/race-failure; mock-unreachable error on each step.
- Speech handler: `CancelIntent` dialog stages (list-and-elicit, resolve-and-confirm) and
  fulfillment (cancel success/failure), auth gate, attempt-limit give-up.

### Integration Tests:

- End-to-end HIS test: book a slot, cancel it via the new endpoint, confirm it reappears as
  available via `findAvailableDays`/`findAvailableTimes` (mirrors the existing
  `appointment.service.spec.ts` book/rebook pattern).

### Manual Testing Steps:

See Phase 4's Manual Verification — this is where all end-to-end call behavior is actually
exercised, since flows are hand-built outside IaC.

## Performance Considerations

None beyond the existing per-Lambda `AbortSignal.timeout(1000)` convention every downstream call in
this codebase already uses.

## Migration Notes

None — no schema change.

## References

- Sibling slice: `context/pending-verification/appointment-list/plan.md` (S-06, the direct
  structural precedent for this plan)
- Roadmap slice: `context/foundation/roadmap.md` → "S-07: Cancelling an appointment"
- PRD requirement: `context/foundation/prd.md` → FR-014
- Utterances: `context/foundation/lex-sample-utterances.md` → `CancelIntent`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Shared business logic

#### Automated

- [x] 1.1 HIS unit tests pass: `cd his && npm test`
- [x] 1.2 `@pcm/appointment` unit tests pass: `cd lambdas/appointment && npm test`
- [x] 1.3 Type checking passes across touched packages
- [x] 1.4 Linting passes

### Phase 2: Keypad Lambda

#### Automated

- [ ] 2.1 Keypad Lambda unit tests pass: `cd lambdas/appointment-cancel && npm test`
- [ ] 2.2 `cdk synth` succeeds with the new function and integration association
- [ ] 2.3 Type checking and linting pass

### Phase 3: Speech intent

#### Automated

- [ ] 3.1 Speech Lambda unit tests pass (new `CancelIntent` coverage)
- [ ] 3.2 `cdk synth` succeeds with the new Lex intent
- [ ] 3.3 Type checking and linting pass

### Phase 4: Contact flow & hand-off

#### Automated

- [ ] 4.1 `cdk synth` succeeds with both menu flows' referenced Lambda ARNs resolvable
- [ ] 4.2 Full test suite passes: repo-wide test command
- [ ] 4.3 Linting and type checking pass repo-wide

#### Manual

- [ ] 4.4 Keypad: both entry points (main menu `4`, authenticated menu `3`) reach cancel correctly
      for both auth states
- [ ] 4.5 Keypad: empty-list caller hears the empty message and returns to the authenticated menu
- [ ] 4.6 Keypad: full select → confirm → cancel flow succeeds and the slot is verifiably rebookable
- [ ] 4.7 Keypad: `0`/`*`/`#` and the 3-attempt give-up behave per L-05 at both input steps
- [ ] 4.8 Speech: authenticated caller completes `CancelIntent` end-to-end
- [ ] 4.9 Speech: unauthenticated caller is routed through the existing auth loop-back
- [ ] 4.10 A mock outage at any step, either variant, transfers to an agent rather than erroring
