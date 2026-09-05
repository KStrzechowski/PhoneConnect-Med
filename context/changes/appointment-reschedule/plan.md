# Appointment Reschedule Implementation Plan

## Overview

An authenticated caller moves one of their scheduled appointments to a new date/time for the
same specialty, releasing the old slot, in both the keypad and natural-language variants
(roadmap slice S-08, FR-015). Both variants reach identical business logic (L-03): a single new
`rescheduleAppointment` function in `@pcm/appointment` that composes the already-existing
`bookAppointment` and `cancelAppointment` — booking the new slot first, then releasing the old
one. No new HIS entity, endpoint, or migration is needed; every mutation this slice performs
already exists on the mock.

## Current State Analysis

- `his/src/appointment/appointment.service.ts` already exposes `book` and `cancel` as exact
  mirror-image mutations on the same `Slot` row (`taken`/`patientId` flipped one way or the
  other). Reschedule needs no new HIS-side method — it is a client-side composition of the two
  existing mock endpoints.
- `lambdas/appointment/index.ts` (`@pcm/appointment`) already has every primitive this plan reads
  from: `resolveAppointment` (position digit → the caller's own appointment, re-fetched fresh
  every call), `resolveDay`/`resolveTime` (position digit → actual date/time, re-derived from a
  fresh search every call), `bookAppointment`, `cancelAppointment`.
- `lambdas/booking/index.ts` is the direct precedent for the new keypad Lambda's step shape: a
  `days` → `times` → `confirm` → (here: `reschedule` instead of `book`) progression, each step
  re-deriving date/time from the caller's raw digit choices rather than trusting anything passed
  across steps except the digits themselves.
- `lambdas/appointment-cancel/index.ts` is the direct precedent for resolving "which of the
  caller's own appointments" from a position digit via `resolveAppointment`, re-resolved fresh on
  every step rather than cached.
- `lambdas/facility-info-speech/index.ts`'s `handleBookingDialog`/`handleBookingFulfillment` and
  `handleCancelDialog`/`handleCancelFulfillment` are the two dialog-code-hook precedents this
  slice combines: booking's multi-turn day/time search-and-confirm stage machine, and cancel's
  "resolve which record from a position digit, re-elicit on a stale resolution" stage. Notably,
  `handleBookingDialog`'s decline path reuses its very first stage block (`stage === '' ||
  stage === 'confirm'`) to redo the day search from scratch on a declined confirmation — the same
  trick this plan reuses for its own decline handling (see Critical Implementation Details).
- `infra/lib/infra-stack.ts` already declares `BookingIntent` and `CancelIntent` with the exact
  CDK shape (`dialogCodeHook`, `fulfillmentCodeHook`, `intentConfirmationSetting` with a native
  yes/no turn, `declinationNextStep` resetting a slot via `slotValueOverride: {}`) this plan's new
  `RescheduleIntent` follows.
- `context/foundation/lex-sample-utterances.md` already has a `RescheduleIntent` utterance list
  (8 phrases). Its documented slot shape (`appointmentId`, `newTimeOfDay`, `newSlot`) predates the
  position-based pattern booking/cancel actually settled on — this plan reuses the utterance text
  verbatim but not the documented slots, the same way `ConfirmationIntent`/`DenyIntent` were
  documented but superseded by Lex's native `intentConfirmationSetting`.
- `keypad-facility-info-main-menu-flow.json` currently wires digits `1`–`4` (facility info, book,
  list, cancel); `keypad-authenticated-menu-flow.json` wires `1`–`3` (book, list, cancel). The
  next free digit is `5` at the main menu, `4` at the authenticated menu.
- `keypad-booking-flow.json`'s confirm menu (digit `1` = confirm → `invokeBook`, digit `2` =
  decline → `invokeDays`, re-running the days search from scratch) is the exact mechanic this
  plan's own confirm menu reuses for its decline branch.

## Desired End State

An authenticated caller who wants to reschedule, in either variant, hears their upcoming
appointments, picks one, states a time-of-day preference, hears up to three days then up to three
times within the chosen day, hears a combined read-back naming both the old and new slot, and —
on confirming — hears that it was rescheduled, with the old slot verifiably free and the new one
verifiably booked. An unauthenticated caller is transparently routed through authentication first,
exactly as booking/list/cancel already handle it. A caller with no upcoming appointments, or no
availability for the new slot, hears a clear message and can retry or is transferred, never left
at a dead end. A downstream failure at any step transfers the caller to an agent.

### Key Discoveries:

- No new HIS mutation is needed: `rescheduleAppointment` in `@pcm/appointment` composes
  `bookAppointment` then `cancelAppointment` client-side. This is leaner than either sibling slice
  (`appointment-cancel` needed a new HIS endpoint; this one needs none) because the two mutations
  it needs already exist and are already independently tested.
- Reusing `selectedSlot` a third time (old-appointment position, then day, then time — extending
  the dual-purpose pattern `contract-surfaces.md` already documents for `BookingIntent`) means the
  old-appointment digit is gone from the Lex slot by the time later stages run. It must be
  persisted separately (`rescheduleApptSelection` session attribute) the first time it resolves,
  exactly as cancel never stores a resolved *date*, only the *position digit*, across a call
  boundary — see Critical Implementation Details.
- Specialty is never stored anywhere in session/contact state for this slice. Every stage that
  needs it re-resolves the old appointment via `resolveAppointment` on demand — matching cancel's
  own "re-derive from a fresh list, never trust a stored value" rule, applied here to specialty
  instead of date/time.

## What We're NOT Doing

- Allowing the caller to change specialty during a reschedule — the new slot search is scoped to
  the old appointment's own specialty; a caller wanting a different specialist uses the existing
  cancel-then-book path.
- Agent-workspace rescheduling (FR-017 / roadmap S-12) — a separate slice with its own
  prerequisites, this one included.
- Any new HIS entity, migration, endpoint, or persistence change.
- A single atomic HIS-side reschedule transaction — the two mutations are composed client-side in
  the shared layer (see Implementation Approach for the accepted residual risk this implies).
- Exposing a real appointment/slot database ID anywhere in a flow, prompt, or session attribute.
- Auto-selecting a caller's sole appointment when only one exists — a digit press is still
  required, matching `appointment-cancel`'s identical decision.

## Implementation Approach

Same shape as every prior appointment slice: a thin `@pcm/appointment` composition function, a
step-based keypad Lambda, and a speech-intent dialog/fulfillment pair, all three calling the
identical shared functions (L-03). `rescheduleAppointment` books the new slot first, then cancels
the old one. If booking the new slot fails (no longer available), nothing has changed and the
caller can simply retry, matching booking's own retry precedent. If booking succeeds but freeing
the old slot then fails — a rare race — the caller briefly holds two appointments; this is an
accepted residual risk, the same class already accepted for S-05's read-back-to-confirm booking
window, not something this plan builds special recovery for (L-02: no defensive engineering for a
failure mode this project already accepts elsewhere).

The keypad Lambda gets five steps (`list`, `days`, `times`, `confirm`, `reschedule`) — cancel's
`list` step prepended to booking's `days`/`times`/`confirm` shape, with `reschedule` replacing
`book`. The speech side's dialog code hook is a four-stage machine (`''` → `select` → `day` →
`time`, confirmed via Lex's native `intentConfirmationSetting`) — cancel's `select` stage
(resolve a position digit, retry on a stale resolution) followed by booking's `day`/`time` search
stages. The contact flow is a new standalone flow, entered from both menus, following
`keypad-appointment-cancel-flow.json`'s listing-step shape merged with `keypad-booking-flow.json`'s
time-of-day/day/time menu shape.

## Critical Implementation Details

**State sequencing — reusing `selectedSlot` a third time.** `BookingIntent` already reuses one
`AMAZON.Number` slot for two different meanings (day choice, then time choice), tracked by
`bookingStage`. `RescheduleIntent` reuses the same slot for a *third* meaning first (old-appointment
position), which creates a real gotcha: by the time the dialog hook reaches the `day`/`time`
stages, `slots.selectedSlot` no longer holds the appointment position — it holds whatever the
caller most recently said. The old-appointment digit must be captured into a `rescheduleApptSelection`
session attribute the first time it resolves, and every later stage (including fulfillment) must
read from that attribute, never from `slots.selectedSlot`, to identify which appointment is being
rescheduled. Concretely, the stage that resolves the old appointment reads it this way so the same
branch also works cleanly on a declined-confirmation reentry (see next point):

```ts
const apptChoice = incoming.rescheduleApptSelection
  ? Number(incoming.rescheduleApptSelection)
  : Number(slots.selectedSlot?.value?.interpretedValue ?? '');
```

**Decline reuses the day-search stage, not a fresh start.** Per the confirmed decision, declining
the final read-back must keep the old-appointment selection and time-of-day preference, resetting
only the day/time choice. `BookingIntent`'s own decline mechanism achieves this cheaply by aliasing
`stage === 'confirm'` onto the same code path as `stage === ''`/`stage === 'select'` (whichever
does the day search) — `declinationNextStep` never touches `rescheduleStage`, so the next dialog
hook invocation still sees `rescheduleStage: 'confirm'`, and the dispatcher must route that value
into the day-search branch identically to a first-time entry, using the `rescheduleApptSelection`-first
lookup above instead of re-listing appointments or re-asking time-of-day. The keypad flow gets the
same behavior for free by pointing the confirm menu's decline digit at `invokeDays` directly
(mirroring `keypad-booking-flow.json`'s own confirm-menu decline target), since the keypad side has
no analogous "stage" concept — contact attributes (`selectedSlot`, `timeOfDay`) are simply still
set from the earlier steps.

## Phase 1: Shared business logic

### Overview

Add the one new shared-layer function both variants call: compose the existing `bookAppointment`
and `cancelAppointment` into a single reschedule operation.

### Changes Required:

#### 1. `@pcm/appointment` — reschedule composition

**File**: `lambdas/appointment/index.ts`

**Intent**: Add the function both variants call to actually perform a reschedule: book the new
slot, then — only if that succeeds — free the old one.

**Contract**:

```ts
export const rescheduleAppointment = async (
  patientId: number,
  oldDate: string,
  oldTime: string,
  specialty: string,
  timeOfDay: string,
  newDate: string,
  newTime: string,
  signal: AbortSignal,
): Promise<{ rescheduled: boolean; oldSlotReleased: boolean }> => {
  const booked = await bookAppointment(specialty, timeOfDay, newDate, newTime, patientId, signal);
  if (!booked) return { rescheduled: false, oldSlotReleased: false };
  const oldSlotReleased = await cancelAppointment(oldDate, oldTime, patientId, signal);
  return { rescheduled: true, oldSlotReleased };
};
```

No new HTTP call shape — this is pure composition of the two functions already defined in this
file. `oldSlotReleased` is returned for callers/tests that want to observe the rare partial-failure
case; the Lambda and speech handlers in Phases 2–3 report caller-facing success from `rescheduled`
alone (see Implementation Approach's accepted residual risk).

#### 2. `@pcm/appointment` tests

**File**: `lambdas/appointment/index.test.ts`

**Intent**: Cover `rescheduleAppointment`'s three outcomes, following this file's existing mocked
`fetch` pattern: new-slot booking fails (returns `{rescheduled: false, oldSlotReleased: false}`,
and `cancelAppointment`'s endpoint is never called — assert `fetch` was invoked exactly once);
booking succeeds and the old-slot cancel succeeds (`{rescheduled: true, oldSlotReleased: true}`);
booking succeeds but the old-slot cancel fails (`{rescheduled: true, oldSlotReleased: false}`).

### Success Criteria:

#### Automated Verification:

- `@pcm/appointment` unit tests pass: `cd lambdas/appointment && npm test`
- Type checking passes
- Linting passes

#### Manual Verification:

- None required for this phase — pure business logic, fully covered by automated tests.

---

## Phase 2: Keypad Lambda

### Overview

A new step-based Lambda (`lambdas/appointment-reschedule`), combining `lambdas/appointment-cancel`'s
list-and-resolve step with `lambdas/booking`'s days/times/confirm step shape, exposing `list` /
`days` / `times` / `confirm` / `reschedule` steps for the new contact flow to drive.

### Changes Required:

#### 1. Keypad Lambda

**File**: `lambdas/appointment-reschedule/index.ts`

**Intent**: One `measured('appointment-reschedule', ...)` handler, dispatching on
`event.Details.Parameters.step`.

**Contract**:

- Every step short-circuits with `{ needsAuth: 'true' }` when `authenticated !== 'true'`, matching
  every existing appointment Lambda.
- `step: 'list'` — identical to `lambdas/appointment-cancel`'s `list` step: calls
  `listAppointments`, returns `{ reachable, hasAppointments, appt1, appt2, appt3 }` (formatter
  duplicated locally, per that step's own established precedent of small per-Lambda duplication).
- `step: 'days'` — input `selectedSlot` (old-appointment position digit) and `timeOfDay`. Resolves
  the old appointment via `resolveAppointment(patientId, Number(selectedSlot), signal)`; `null` →
  `{ reachable, found: 'false' }`. Otherwise searches `findAvailableDays(appointment.specialty,
  timeOfDay, signal)`; empty → `{ reachable, found: 'true', available: 'false' }`; otherwise
  `{ reachable, found: 'true', available: 'true', day1, day2, day3 }` (same formatting as
  booking's `days` step).
- `step: 'times'` — input `selectedSlot`, `timeOfDay`, `dayChoice`. Re-resolves the old appointment
  and re-derives the day via `resolveDay(appointment.specialty, timeOfDay, Number(dayChoice),
  signal)` — `found: 'false'` / `available: 'false'` on the same two failure branches as `days`.
  On success, `findAvailableTimes` and return `{ reachable, found: 'true', available: 'true',
  date, time1, time2, time3 }`.
- `step: 'confirm'` — input `selectedSlot`, `timeOfDay`, `dayChoice`, `timeChoice`. Re-resolves the
  old appointment, re-derives day then time via `resolveDay`/`resolveTime`. On success, returns
  `{ reachable, found: 'true', available: 'true', date, time, message: '<old specialty>, <old day
  label>, godzina <old time>, na <new day label>, godzina <new time>' }` — a combined read-back
  naming both the appointment being changed and its replacement.
- `step: 'reschedule'` — same inputs as `confirm`. Re-resolves the old appointment and the new
  day/time one more time (matching booking's `book` step re-deriving from raw digits rather than
  trusting anything passed between steps), then calls `rescheduleAppointment(patientId,
  appointment.date, appointment.time, appointment.specialty, timeOfDay, date, time, signal)`.
  Returns `{ reachable, found: 'true', available: 'true', rescheduled: String(result.rescheduled) }`
  — `oldSlotReleased` is not surfaced to the flow; the caller-facing outcome is `rescheduled` alone
  (see Implementation Approach).
- All steps: any thrown error → `record.outcome = 'error'`, `{ reachable: 'false', error:
  message }`, matching every existing Lambda's try-catch shape.

#### 2. Event fixture

**File**: `lambdas/appointment-reschedule/event.sample.json`

**Intent**: Base fixture for tests, following `lambdas/appointment-cancel/event.sample.json`'s
shape.

#### 3. Keypad Lambda tests

**File**: `lambdas/appointment-reschedule/index.test.ts`

**Intent**: Cover each step's success/edge/error paths, following
`lambdas/appointment-cancel/index.test.ts`'s `mock.method(globalThis, 'fetch', ...)` pattern: auth
gate on every step; `list` empty/populated; `days`/`times`/`confirm` each with a stale
`selectedSlot` (`found: 'false'`) and with no availability (`available: 'false'`); `reschedule`
success, new-slot-booking failure, and the old-slot-cancel-fails-after-successful-booking case; a
mock-unreachable error on each step.

#### 4. Package scaffolding

**Files**: `lambdas/appointment-reschedule/package.json`, `lambdas/appointment-reschedule/tsconfig.json`

**Intent**: Copy `lambdas/appointment-cancel`'s scaffolding verbatim (same dependencies:
`@pcm/measure`, `@pcm/appointment`).

#### 5. Infra registration

**File**: `infra/lib/infra-stack.ts`

**Intent**: Register the new Lambda following the `appointmentCancel` `NodejsFunction` block
immediately above it verbatim (same `vpc`, `environment`, `timeout`, `logGroup` shape), plus its
`ConnectInvoke` permission and `CfnIntegrationAssociation`.

**Contract**: `functionName: 'phoneconnect-med-appointment-reschedule'` (L-04), entry
`lambdas/appointment-reschedule/index.ts`.

### Success Criteria:

#### Automated Verification:

- Keypad Lambda unit tests pass: `cd lambdas/appointment-reschedule && npm test`
- `cdk synth` succeeds with the new function and integration association
- Type checking and linting pass

#### Manual Verification:

- None required for this phase in isolation — the Lambda has no contact-flow entry point yet.
  Covered end-to-end in Phase 4.

---

## Phase 3: Speech intent

### Overview

A new `RescheduleIntent` in the Lex bot definition and a matching dialog/fulfillment branch in
`lambdas/facility-info-speech/index.ts`, combining `CancelIntent`'s position-resolution stage with
`BookingIntent`'s day/time search stages.

### Changes Required:

#### 1. Lex intent definition

**File**: `infra/lib/infra-stack.ts`

**Intent**: Add `RescheduleIntent` to the bot's `intents` array, immediately after `CancelIntent`,
using the `RescheduleIntent` sample utterances already documented in `lex-sample-utterances.md`
(the utterance text only — not that document's stale slot shape).

**Contract**: `dialogCodeHook: { enabled: true }`, `fulfillmentCodeHook: { enabled: true }`, two
slots: `timeOfDay` (type `TimeOfDay`, required, elicited normally by Lex slot filling — same
prompt as `BookingIntent`'s `timeOfDay` slot) and `selectedSlot` (type `AMAZON.Number`, reused
three ways by the dialog code hook, exactly as `BookingIntent` reuses its own `selectedSlot` for
two meanings). A native `intentConfirmationSetting` for the final yes/no turn, with
`declinationNextStep` resetting `selectedSlot` via `slotValueOverride: {}` — matching
`BookingIntent`'s own decline handling exactly (see Critical Implementation Details for why this
is sufficient without touching `rescheduleStage`).

#### 2. Sample utterances constant

**File**: `infra/lib/infra-stack.ts` (wherever `bookingUtterances`/`cancelUtterances` are declared)

**Intent**: Add a `rescheduleUtterances` constant from `lex-sample-utterances.md`'s
`RescheduleIntent` list.

#### 3. Dialog code hook

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: A `handleRescheduleDialog` function combining `handleCancelDialog`'s position-resolution
stage with `handleBookingDialog`'s day/time search stages.

**Contract**: A `rescheduleStage` session attribute (`''` / `'select'` / `'day'` / `'time'`):

- Auth-gate check first (`needsAuth`), matching every other intent.
- If `timeOfDay` isn't yet filled, `delegate('RescheduleIntent', slots, incoming)` so Lex elicits
  it via its own slot prompt (mirroring `handleBookingDialog`'s initial delegate for
  `specialty`/`timeOfDay`).
- `stage === ''`: call `listAppointments`; empty → `close` with the "no appointments" message;
  otherwise elicit `selectedSlot` with the numbered list, set `rescheduleStage: 'select'`.
- `stage === 'select'` or `stage === 'confirm'` (the decline-reentry alias — see Critical
  Implementation Details): resolve the appointment position via the `rescheduleApptSelection`-first
  lookup, call `resolveAppointment`; `null` → retry-elicit `selectedSlot` (bounded by a
  `rescheduleAttempts` counter, giving up and transferring after the limit, mirroring
  `CANCEL_ATTEMPT_LIMIT`'s shape as a new `RESCHEDULE_ATTEMPT_LIMIT = 3`). On success, store
  `rescheduleApptSelection`, search `findAvailableDays(appointment.specialty, timeOfDay)`; empty →
  bounded retry re-eliciting `timeOfDay` (`slotValueOverride: {}` on `timeOfDay` only —
  `rescheduleApptSelection` stays set); otherwise elicit `selectedSlot` for the day choice, set
  `rescheduleStage: 'day'`, reset `rescheduleAttempts: '0'`.
- `stage === 'day'`: re-resolve the appointment via `rescheduleApptSelection`, resolve the day via
  `resolveDay`; `null` → bounded retry. On success, `findAvailableTimes`, elicit `selectedSlot` for
  the time choice, set `rescheduleStage: 'time'`, `rescheduleDate: date`, reset attempts.
- `stage === 'time'` (trailing default, mirroring `handleBookingDialog`'s structure): re-resolve
  the appointment, resolve the time via `resolveTime`; `null` → bounded retry. On success, build
  the combined old+new read-back message and `confirmIntent(...)` with `rescheduleStage: 'confirm'`,
  `rescheduleTime: time`.

#### 4. Fulfillment code hook

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: A `handleRescheduleFulfillment` function mirroring the structure of both
`handleBookingFulfillment` and `handleCancelFulfillment`: re-resolve the old appointment fresh from
`rescheduleApptSelection` (never trust a stored old date/time — matching `CancelIntent`'s
fulfillment precedent), read the new date/time from the stored `rescheduleDate`/`rescheduleTime`
session attributes (matching `BookingIntent`'s fulfillment precedent for its own search result),
call `rescheduleAppointment`, and close with success or the "could not reschedule" message.

#### 5. Dispatch wiring

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: Add a `RescheduleIntent` branch to `dispatch`, following the existing `BookingIntent`/
`CancelIntent` branches' `invocationSource` check verbatim.

### Success Criteria:

#### Automated Verification:

- Speech Lambda unit tests pass (new tests covering `RescheduleIntent`'s dialog stages — including
  the decline-reentry alias and the stale-old-appointment retry — and fulfillment, following the
  file's existing `BookingIntent`/`CancelIntent` test patterns)
- `cdk synth` succeeds with the new Lex intent
- Type checking and linting pass

#### Manual Verification:

- None required for this phase in isolation — the intent has no contact-flow wiring yet. Covered
  end-to-end in Phase 4.

---

## Phase 4: Contact flow & hand-off

### Overview

A new keypad contact flow reachable from both menus (matching booking's/cancel's two-entry-point
precedent), the two new menu digits, `contract-surfaces.md` documentation, and real-call
verification of both variants.

### Changes Required:

#### 1. New keypad flow

**File**: `connect-flow-templates/flows/keypad-appointment-reschedule-flow.json`

**Intent**: A self-contained flow combining `keypad-appointment-cancel-flow.json`'s listing/
selection shape at the top with `keypad-booking-flow.json`'s time-of-day → day → time → confirm
shape underneath (minus the specialty menu, since specialty is fixed to the selected appointment).

**Contract**: Three shared attempt counters, all reset at flow entry and capped at 3 (L-05):

- `rescheduleInputAttempts` — bumped on `NoMatchingCondition`/`InputTimeLimitExceeded` across every
  `GetParticipantInput` block in this flow (selection menu, time-of-day menu, day menu, time menu,
  confirm menu) — one shared counter across all of them, matching `keypad-booking-flow.json`'s
  single `bookingInputAttempts`.
- `rescheduleSelectionAttempts` — bumped when a step returns `found: 'false'` (the old-appointment
  selection turned out stale), looping back to the selection menu — mirrors
  `cancelSelectionAttempts`.
- `rescheduleAvailabilityAttempts` — bumped when a step returns `available: 'false'` (no slot found
  for the searched specialty/time-of-day/day), looping back to the time-of-day menu — mirrors
  `availabilityAttempts`.

Every `GetParticipantInput` block wires `0` (transfer), `*` (repeat), and `#` (return to main
menu), matching every existing deep sub-menu. The selection menu unconditionally wires `1`/`2`/`3`
to `selectedSlot`, exactly as `keypad-appointment-cancel-flow.json`'s own selection menu does — an
out-of-range choice is caught downstream by `found: 'false'`, not by the menu itself. The
time-of-day menu is a direct copy of `keypad-booking-flow.json`'s own `timeOfDayMenu` (digits
`1`–`4` → `rano`/`przed południem`/`po południu`/`wieczorem`). The confirm menu's digit `1`
(confirm) invokes the `reschedule` step; digit `2` (decline) transfers directly back to the `days`
invoke step — reusing the already-set `selectedSlot`/`timeOfDay` contact attributes exactly as
`keypad-booking-flow.json`'s own confirm menu re-invokes `invokeDays` on decline (Critical
Implementation Details).

#### 2. Main menu digit

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`

**Intent**: Add digit `5` ("Naciśnij 5, aby przełożyć wizytę"), gated by the same
`Compare`-on-`$.Attributes.authenticated` pattern as `CheckAuthForAppointmentCancel` — an
unauthenticated caller routes through `keypad-authenticate-flow.json` first; an authenticated
caller transfers straight into `keypad-appointment-reschedule-flow.json`.

**Contract**: New `CheckAuthForAppointmentReschedule` compare block, new prompt text digit,
following `CheckAuthForAppointmentCancel` verbatim.

#### 3. Authenticated menu digit

**File**: `connect-flow-templates/flows/keypad-authenticated-menu-flow.json`

**Intent**: Add digit `4` ("Naciśnij 4, aby przełożyć wizytę"), transferring straight into
`keypad-appointment-reschedule-flow.json`.

#### 4. `contract-surfaces.md` update

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Document the new menu digits (mirroring the existing "Keypad digits: main menu `4`,
authenticated menu `3` (S-07)" entry), the new Lambda output fields (`found`/`available`/
`rescheduled`, mirroring the existing `found`/`cancelled`/`message` entry), and the extended
`selectedSlot` reuse — a new entry extending the existing "`selectedSlot`'s dual-purpose reuse
(S-05, speech only)" one, documenting the third reuse and the `rescheduleApptSelection` persistence
gotcha from Critical Implementation Details.

### Success Criteria:

#### Automated Verification:

- `cdk synth` succeeds with both menu flows' referenced Lambda ARNs resolvable
- Full test suite passes: repo-wide test command
- Linting and type checking pass repo-wide

#### Manual Verification:

- A real call, keypad variant: from the main menu, digit `5` as an unauthenticated caller routes
  through authentication and lands able to reach reschedule from the authenticated menu; as an
  authenticated caller, digit `5` (main menu) and digit `4` (authenticated menu) both reach the
  reschedule flow directly.
- A real call, keypad variant: a caller with zero appointments hears the empty message and returns
  to the authenticated menu without a dead end.
- A real call, keypad variant: a caller with one or more appointments selects one, states a
  time-of-day preference, picks a day and a time, hears the combined old+new read-back, confirms,
  hears success — and the old slot is verifiably free while the new one is verifiably booked.
- A real call, keypad variant: declining the confirm menu (digit `2`) returns to the day-offering
  step with the same appointment and time-of-day preference still in effect, not a full restart.
- A real call, keypad variant: pressing `0`/`*`/`#` at each input step behaves per L-05; 3 invalid
  presses on each of the selection/availability/input counters each transfer to an agent.
- A real call, speech variant: an authenticated caller says a `RescheduleIntent` utterance, states a
  time-of-day preference, picks an appointment, a day, and a time by number, hears the combined
  read-back, confirms with "tak", and hears success.
- A real call, speech variant: declining the read-back ("nie") returns to the day offering with the
  same appointment and time-of-day preference intact, not a full restart.
- A real call, speech variant: an unauthenticated caller reaching for `RescheduleIntent` is routed
  through the same `needsAuth`/`AuthIntent` loop-back booking and cancel already established.
- A mock outage at any step, either variant, transfers the caller to an agent rather than erroring
  the call.

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding further. Flows are hand-built outside IaC (L-06) — commit the generated JSON alongside
the code that wires it, per L-06.

---

## Testing Strategy

### Unit Tests:

- `@pcm/appointment`'s `rescheduleAppointment`: new-slot booking failure (no cancel attempted),
  full success, and the booked-but-old-slot-cancel-fails partial case.
- Keypad Lambda: auth gate on all five steps; `list` empty/populated; `days`/`times`/`confirm` each
  with a stale `selectedSlot` and with no availability; `reschedule` success and new-slot-booking
  failure; mock-unreachable error on each step.
- Speech handler: `RescheduleIntent` dialog stages (list-and-elicit, resolve-and-search-days,
  day-search, time-search) including the decline-reentry alias and the stale-resolution retry, plus
  fulfillment (success/failure), auth gate, attempt-limit give-up.

### Integration Tests:

- End-to-end HIS test: book a slot, reschedule it via the new `@pcm/appointment` composition,
  confirm the old slot reappears as available and the new one is taken (mirrors the existing
  book/cancel/rebook pattern in `appointment.service.spec.ts`, exercised here at the
  `lambdas/appointment` layer since no new HIS method exists to test directly).

### Manual Testing Steps:

See Phase 4's Manual Verification — this is where all end-to-end call behavior is actually
exercised, since flows are hand-built outside IaC.

## Performance Considerations

None beyond the existing per-Lambda `AbortSignal.timeout(1000)` convention every downstream call in
this codebase already uses. `rescheduleAppointment` makes two sequential downstream calls
(book, then cancel) rather than one — each still bounded by its own signal, matching how
`lambdas/booking`'s `book` step already makes two sequential calls (`resolveDay` then
`resolveTime`) before its mutation.

## Migration Notes

None — no schema change, no new HIS endpoint.

## References

- Sibling slices: `context/pending-verification/appointment-cancel/plan.md` (S-07, the position-
  resolution precedent), `context/pending-verification/appointment-booking-both-variants/plan.md`
  (S-05, the day/time-search precedent)
- Roadmap slice: `context/foundation/roadmap.md` → "S-08: Rescheduling an appointment"
- PRD requirement: `context/foundation/prd.md` → FR-015
- Utterances: `context/foundation/lex-sample-utterances.md` → `RescheduleIntent`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Shared business logic

#### Automated

- [x] 1.1 `@pcm/appointment` unit tests pass: `cd lambdas/appointment && npm test` — 5e5077c
- [x] 1.2 Type checking passes — 5e5077c
- [x] 1.3 Linting passes — 5e5077c

### Phase 2: Keypad Lambda

#### Automated

- [x] 2.1 Keypad Lambda unit tests pass: `cd lambdas/appointment-reschedule && npm test` — 2a1a49a
- [x] 2.2 `cdk synth` succeeds with the new function and integration association — 2a1a49a
- [x] 2.3 Type checking and linting pass — 2a1a49a

### Phase 3: Speech intent

#### Automated

- [x] 3.1 Speech Lambda unit tests pass (new `RescheduleIntent` coverage)
- [x] 3.2 `cdk synth` succeeds with the new Lex intent
- [x] 3.3 Type checking and linting pass

### Phase 4: Contact flow & hand-off

#### Automated

- [ ] 4.1 `cdk synth` succeeds with both menu flows' referenced Lambda ARNs resolvable
- [ ] 4.2 Full test suite passes: repo-wide test command
- [ ] 4.3 Linting and type checking pass repo-wide

#### Manual

- [ ] 4.4 Keypad: both entry points (main menu `5`, authenticated menu `4`) reach reschedule
      correctly for both auth states
- [ ] 4.5 Keypad: empty-list caller hears the empty message and returns to the authenticated menu
- [ ] 4.6 Keypad: full select → time-of-day → day → time → confirm → reschedule flow succeeds; old
      slot verifiably free, new slot verifiably booked
- [ ] 4.7 Keypad: declining the confirm menu returns to day offering, not a full restart
- [ ] 4.8 Keypad: `0`/`*`/`#` and the 3-attempt give-up behave per L-05 at every input step
- [ ] 4.9 Speech: authenticated caller completes `RescheduleIntent` end-to-end
- [ ] 4.10 Speech: declining the read-back returns to day offering, not a full restart
- [ ] 4.11 Speech: unauthenticated caller is routed through the existing auth loop-back
- [ ] 4.12 A mock outage at any step, either variant, transfers to an agent rather than erroring
