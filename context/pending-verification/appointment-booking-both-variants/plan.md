# Appointment Booking, Both Variants — Implementation Plan

## Overview

Roadmap **S-05**, the project's north star: an authenticated caller books a visit by naming a
specialty and a preferred time of day, is offered up to three available days, picks one, is
offered times within that day, hears a read-back, and confirms — in both the keypad variant and
the natural-language variant, over one shared business-logic layer. This is the first slice that
produces the comparison evidence the thesis exists to gather (PRD §Facility information: "the
measured comparison must run on booking").

## Current State Analysis

`his/` has two Postgres-backed domains today, `facility` and `patient` (`his/src/facility/*`,
`his/src/patient/*`), each following the same shape: TypeORM entity → service → controller, one
REST endpoint per operation. No scheduling data — no `Doctor`, no notion of a slot or an
appointment — exists anywhere in the mock.

Two integration patterns are established and this slice extends both:

- **Keypad**: a `NodejsFunction` per operation (`lambdas/facility-info`, `lambdas/authenticate`,
  `lambdas/send-otp`, `lambdas/otp-verify`), each a thin `measured()`-wrapped handler that calls a
  shared `@pcm/<domain>` package and returns `Record<string, string>` for the Contact Flow to
  read as output parameters. `authenticate` already shows the multi-outcome-in-one-handler shape
  this plan reuses for booking's four steps.
- **Speech**: one Lambda, `lambdas/facility-info-speech/index.ts`, fulfils every intent on the
  single `SpeechBot`. Each new intent (`InfoIntent`, `AuthIntent`, `OtpIntent`, …) is another
  branch in the same `dispatch()` function, calling the same shared `@pcm/<domain>` functions the
  keypad Lambdas call — never duplicating the decision.

`context/foundation/lex-sample-utterances.md` already authored the NLU surface this slice needs:
`BookingIntent` with slots `specialty`, `timeOfDay`, `selectedSlot`; a 15-value `specialty` slot
type with synonyms; a 4-value `timeOfDay` slot type with synonyms. This plan does not redesign
that vocabulary — it wires it to real data and real business logic.

`docs/reference/contract-surfaces.md` documents the session/contact-attribute contracts S-03 and
S-04 already established: `authenticated` / `patientId`, set once on successful auth and readable
by any later slice without re-verifying. Booking is Layer 3 (PRD §Access Control) and reads these
directly.

### Key Discoveries:

- `lambdas/authenticate/index.ts:1-36` — the multi-outcome-single-handler shape this plan's
  `lambdas/booking/index.ts` follows, one step per branch instead of one outcome per branch.
- `lambdas/facility-info-speech/index.ts:41-178` — the single growing `dispatch()` function every
  new intent (including `BookingIntent`) is added to; `AuthIntent`'s dynamic confirmation message
  (`Podano numer PESEL {pesel}...`) is the template pattern the booking read-back reuses.
- `infra/lib/infra-stack.ts:392-535` — `SpeechBot`'s intents are all static-slot,
  `fulfillmentCodeHook`-only today. `BookingIntent` is the first intent needing a
  **dialog code hook** (to generate the day/time options dynamically before the caller can answer)
  — a genuinely new mechanism in this codebase, not a copy of an existing block.
- `context/foundation/lex-sample-utterances.md:176-201` — `BookingIntent`'s slots are already
  named `specialty`, `timeOfDay`, `selectedSlot` (singular). `selectedSlot` is reused for both the
  day-choice and the time-choice via `slotValueOverride` resets, the same mechanic
  `AuthIntent`'s `declinationNextStep` already uses to reset `pesel`/`phone` on decline
  (`infra/lib/infra-stack.ts:483-495`).
- PRD §Business Logic's two-step selection and its **days capped at three, no paging** rule is
  the deliberate deviation from the thesis's flat "3 nearest slots" reading and applies
  identically to both variants — this plan applies the same reasoning to cap times-within-a-day
  at three, for the same reason (never read a caller a dozen consecutive slots) and because
  applying it identically to both variants keeps it non-confounding, matching the days precedent
  exactly.
- `docs/reference/contract-surfaces.md`'s `Details.Parameters.variant` and `authenticated` /
  `patientId` entries are the two contracts this slice's new Lambda and Lex config must honor
  without redefining.

## Desired End State

An authenticated caller on either variant says or presses their way to a specialty and a
time-of-day preference, hears up to three available days, picks one, hears up to three available
times that day, hears a spoken read-back of the specific day and time, confirms, and the
appointment is registered against a real slot in `his/`. Declining the read-back returns to the
day offering with the same specialty and time-of-day preference, not a full restart. A specialty
with no doctor, or a specialty/time-of-day combination with no free slots, is announced and the
caller is re-prompted for a different choice, capped at three attempts before transfer — the same
safety net FR-006 already uses everywhere else. A caller who is not yet authenticated when they
reach for booking is walked through the existing authentication step first, in both variants,
without a redesign of that step.

Verification: a real call on both variants, ending in a slot that is provably marked taken in
`his/`'s database, for at least one seeded specialty; the no-doctor and no-availability paths
each demonstrated once per variant; a declined confirmation demonstrated once; turn-count is
derivable from `handler: 'booking'` records sharing a `contactId` in CloudWatch.

## What We're NOT Doing

- Listing, cancelling, or rescheduling appointments (S-06, S-07, S-08) — `@pcm/appointment` is
  built narrowly for search-and-book, not shaped in advance for those operations (explicit
  decision this planning session: no speculative abstraction per L-02).
- "Press for more" paging beyond the three offered days or three offered times — parked at the
  roadmap level for days, and this plan applies the same cap-without-paging rule to times.
- A doctor-selection step for the caller — the caller books by specialty, day, and time; which
  doctor of that specialty fulfils it is resolved by the shared layer and never named to the
  caller, keeping the interaction shape unchanged from the thesis's own design.
- Persistent English-locale support (S-10) or the intent-accuracy measurement run (S-09) — both
  are sequenced after this slice on the roadmap.
- Rebuilding or redesigning the existing `authenticate`/`AuthIntent` step — this plan only adds an
  entry path into it from booking.
- A distinct SMS/S-04-style demo-account path for booking — booking has no messaging component.

## Implementation Approach

Two new `his/` entities (`Doctor`, `Slot`) back three REST endpoints. `@pcm/appointment` wraps
them with functions that **re-derive** which day or time a raw digit/number choice refers to on
every call, rather than trusting anything a contact flow or Lex session stored — this is the
concrete application of L-03's rule that resolving "the caller pressed 2" into an actual date must
happen in the shared layer. One keypad Lambda, `lambdas/booking/`, dispatches on a `step`
parameter (`days` → `times` → `confirm` → `book`), mirroring `authenticate`'s multi-outcome shape.
The speech variant adds `BookingIntent` to the existing `facility-info-speech` dispatcher, using a
Lex dialog code hook to generate the day and time options before eliciting `selectedSlot`, and
Lex's own `intentConfirmationSetting` for the read-back and decline handling — the same mechanism
`AuthIntent` already uses, extended to dynamic day/time text instead of static PESEL/phone text.

## Critical Implementation Details

### State sequencing — why every step re-queries instead of trusting stored labels

The `days` step returns up to three day labels for the flow/bot to speak, but it must **not**
also hand back an opaque `dayId` for the caller's next keypress to carry — that pattern would
let flow-level branching (`pressed 1` → `dayId=1`) stand in for date resolution, which is exactly
the leak L-03 forbids. Instead, `resolveDay(specialty, timeOfDay, dayChoice, signal)` re-runs the
same day search and re-derives `dayChoice - 1` as an array index, every time it's called. The same
pattern applies to `resolveTime`. The cost is one extra downstream call per step; the benefit is
that no domain decision — "which date does '2' mean" — ever lives outside `@pcm/appointment`.

### Timing & lifecycle — the auth-gate redirect is this slice's highest platform uncertainty

Booking requires `authenticated === 'true'` in session/contact state. For the keypad variant this
is a flow-level branch: `lambdas/booking` returns `needsAuth: 'true'` when the flag is absent, and
the Contact Flow (console, Phase 6) branches to the existing Authenticate Contact Flow Module
before re-entering booking — exactly the reuse S-03's plan-brief called out ("built as a reusable
Contact Flow Module... so S-05 can invoke the same auth step automatically later"). For the speech
variant, Lex V2 has no native "switch intent" dialog action; the intended mechanism is that
`BookingIntent`'s dialog code hook returns a `Close` response carrying `needsAuth: 'true'` in
session attributes, and the Contact Flow branches on it the same way, then re-invokes the bot with
`MainMenuIntent` or directly re-prompts for the booking utterance once authenticated. This is the
one piece of this plan not proven by an existing pattern in the codebase (unlike the DTMF-capture
question F-03 spiked ahead of S-03, this repeats a now-confirmed mechanism — in-conversation
attribute-carrying — in a new position, so it is flagged as a risk to confirm in Phase 6's manual
verification rather than a reason for a separate spike).

## Phase 1: Scheduling data model

### Overview

Adds `Doctor` and `Slot` to `his/`, seeded so both the "no doctor for this specialty" and "no free
slot for this specialty/time" edge cases are exercisable on a real call without contrivance.

### Changes Required:

#### 1. Doctor and Slot entities

**File**: `his/src/appointment/doctor.entity.ts`, `his/src/appointment/slot.entity.ts`

**Intent**: `Doctor` carries `specialty` (matching the 15 canonical values in
`lex-sample-utterances.md`), `firstName`, `lastName`. `Slot` is the appointment itself once taken
— a row per (doctor, date, time) with a `taken` flag and a nullable `patientId`, denormalizing a
`timeOfDay` column (`rano` | `przed południem` | `po południu` | `wieczorem`) set at seed time so
availability queries filter on it directly rather than doing time-range arithmetic per query.

**Contract**: `Slot.doctorId` FKs to `Doctor.id`. Booking a slot is `taken = true` +
`patientId = <id>` on an existing row — never an insert. No `Appointment` entity; the taken slot
row *is* the appointment record, per this session's data-model decision (precomputed rows, over
computing availability on the fly).

#### 2. Appointment service, controller, module

**File**: `his/src/appointment/appointment.service.ts`, `appointment.controller.ts`,
`appointment.module.ts`

**Intent**: Three operations mirroring `PatientService`'s shape: find up to three next distinct
dates with ≥1 free slot for a specialty + timeOfDay, find up to three free times on a given date
for that specialty + timeOfDay, and atomically claim one free slot for a patient.

**Contract**:
- `GET /appointment/days?specialty=&timeOfDay=` → `{ days: string[] }` (ISO dates, soonest first,
  empty when nothing matches — covers both "no doctor" and "no free slot" uniformly, since an
  unseeded specialty and a fully-booked one both resolve to zero matching rows).
- `GET /appointment/times?specialty=&timeOfDay=&date=` → `{ times: string[] }` (`HH:mm`, soonest
  first).
- `POST /appointment/book` body `{ specialty, timeOfDay, date, time, patientId }` →
  `{ booked: boolean }` — `false` only if the slot was taken between the read-back and the
  confirm (race condition across turns; accepted as a residual limitation of a multi-turn phone
  call, not fixed further in this slice).

#### 3. Register the module and add both entities to the data source

**File**: `his/src/app.module.ts`, `his/src/data-source.ts`

**Intent**: Same one-line registration `FacilityModule`/`PatientModule` already show.

#### 4. Migration: create tables and seed doctors + slots

**File**: `his/src/migrations/1788469015011-CreateAppointment.ts`

**Intent**: Creates `doctor` and `slot`, then seeds one doctor for 14 of the 15
`lex-sample-utterances.md` specialty values (the 15th is left with zero doctors — the "no doctor
for that specialty" edge case). For each of the 14 seeded doctors, generate slot rows across a
forward window of the next ten weekdays, with a small number of distinct times (at least two) per
`timeOfDay` bucket per day, so the times-within-a-day step has a genuine (if modest) choice to
offer. One of the 14 doctors has every generated slot pre-marked `taken = true` — a doctor who
exists but has no availability, distinct from the specialty with no doctor at all.

**Contract**: Insert-only migration (mirrors `CreatePatient`'s seed-on-up pattern); `down` drops
both tables.

### Success Criteria:

#### Automated Verification:

- `npm run test` inside `his/` passes, including new `appointment.service.spec.ts` cases for: a
  seeded specialty/timeOfDay with free slots, the unseeded specialty, and the fully-booked doctor
- `npm run migration:run` inside `his/` applies cleanly against a fresh database

#### Manual Verification:

- Querying `GET /appointment/days` for a seeded specialty against a running mock returns real
  future dates
- Querying it for the unseeded specialty and for the fully-booked doctor's specialty both return
  an empty array

---

## Phase 2: `@pcm/appointment` shared module

### Overview

The one piece of logic both variants must call identically: turning a specialty, a time-of-day
preference, and a raw day/time choice into a resolved date and time, and booking it.

### Changes Required:

#### 1. Shared appointment functions

**File**: `lambdas/appointment/index.ts`, `lambdas/appointment/package.json` (`@pcm/appointment`),
`lambdas/appointment/tsconfig.json`

**Intent**: `findAvailableDays`, `findAvailableTimes` — thin fetch wrappers to the two GET
endpoints, mirroring `fetchFacility`'s shape exactly. `resolveDay(specialty, timeOfDay, dayChoice,
signal)` and `resolveTime(specialty, timeOfDay, date, timeChoice, signal)` re-run the matching
search and index `choice - 1`, returning a `null` date/time when the choice is out of range or the
search comes back empty — the mechanism the Critical Implementation Details section above
describes. `bookAppointment(specialty, timeOfDay, date, time, patientId, signal)` wraps
`POST /appointment/book`.

**Contract**: `resolveDay`/`resolveTime` return `{ date: string } | { date: null }` (and the time
equivalent) rather than throwing on an out-of-range or empty case — the caller (the keypad Lambda
or the speech dispatcher) decides how to speak that outcome, matching how `beginOtpChallenge`
returns a discriminated result rather than throwing.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/appointment` passes, covering: a valid day/time resolution, an
  out-of-range choice, an empty search (unseeded specialty and fully-booked doctor both), and a
  successful book call

---

## Phase 3: Keypad Lambda

### Overview

`lambdas/booking/index.ts`, one handler dispatching on a `step` parameter, following
`authenticate`'s multi-outcome-in-one-handler shape.

### Changes Required:

#### 1. Booking handler

**File**: `lambdas/booking/index.ts`, `lambdas/booking/package.json`, `tsconfig.json`,
`event.sample.json`

**Intent**: Reads `step`, `specialty`, `timeOfDay`, and (from step 2 onward) `dayChoice` /
`timeChoice` from `Details.Parameters`, plus `patientId`/`authenticated` the flow already carries
as contact attributes. Returns `needsAuth: 'true'` immediately if not authenticated, before doing
any appointment work. Four steps: `days` (call `findAvailableDays`, return up to three speakable
day labels or an empty-result flag), `times` (re-derive the chosen day via `resolveDay`, call
`findAvailableTimes`, return up to three time labels), `confirm` (re-derive day and time via
`resolveDay`/`resolveTime`, return a read-back message, no write), `book` (re-derive again, call
`bookAppointment`, return the outcome).

**Contract**: Day labels are formatted (`poniedziałek, 8 września` style) inside this handler, not
the flow — the flow only ever plays back text it's handed, matching `lastMessageText`'s existing
convention (`docs/reference/contract-surfaces.md`).

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/booking` passes, covering: the `needsAuth` short-circuit, each of
  the four steps on the happy path, an empty-result outcome at the `days` step, and an
  out-of-range choice at `times`/`confirm`

---

## Phase 4: Speech fulfillment

### Overview

`BookingIntent` added to the existing `facility-info-speech` dispatcher, reusing `selectedSlot`
for both the day-choice and the time-choice elicitation via a dialog code hook.

### Changes Required:

#### 1. `BookingIntent` branch

**File**: `lambdas/facility-info-speech/index.ts`

**Intent**: Extends the `LexEvent` type to carry `invocationSource: 'DialogCodeHook' |
'FulfillmentCodeHook'` (currently hardcoded to fulfillment-only) and `dispatch()` to branch on it
for `BookingIntent`. On dialog-hook invocation with `specialty`/`timeOfDay` filled and
`selectedSlot` not yet meaningfully set for the current stage, calls `@pcm/appointment` (via the
same functions the keypad Lambda uses) to generate the day or time options, returns an `ElicitSlot`
response for `selectedSlot` with the options spoken in the prompt text, and resets
`selectedSlot`'s value the same way `AuthIntent`'s `declinationNextStep` already does. On
fulfillment (after Lex's own `intentConfirmationSetting` confirms), calls `bookAppointment` and
closes with the outcome. `needsAuth` is checked first, same as the keypad handler, returning a
`Close` with `needsAuth: 'true'` for the flow to branch on (see Critical Implementation Details).

**Contract**: The read-back confirmation text is a templated message
(`Umawiam Panią/Pana do {specialty} w {day} o {time}. Czy się zgadza?`) filled from session
attributes the dialog code hook set, the same templating `AuthIntent`'s
`Podano numer PESEL {pesel} oraz numer telefonu {phone}` already uses.

### Success Criteria:

#### Automated Verification:

- `npm test --workspace lambdas/facility-info-speech` passes, including new `BookingIntent` cases
  for: the `needsAuth` short-circuit, the dialog-hook day-elicitation response, the dialog-hook
  time-elicitation response, and fulfillment producing a booking call

---

## Phase 5: Infrastructure

### Overview

One new `NodejsFunction` plus Connect association for the keypad Lambda; `SpeechBot` gains
`BookingIntent` with its slots, dialog code hook, and dynamic confirmation.

### Changes Required:

#### 1. Booking function

**File**: `infra/lib/infra-stack.ts`

**Intent**: `Booking` `NodejsFunction`, same VPC/security-group/environment shape as
`FacilityInfo`/`Authenticate` (it reaches `his/`), with a Connect integration association.

**Contract**: `functionName: 'phoneconnect-med-booking'` per L-04.

#### 2. `BookingIntent` on `SpeechBot`

**File**: `infra/lib/infra-stack.ts`

**Intent**: Adds the `specialty` and `timeOfDay` custom slot types (values + synonyms from
`context/foundation/lex-sample-utterances.md`, verbatim — this plan does not re-author that
vocabulary) and a `selectedSlot` slot type. `BookingIntent` gets `dialogCodeHook: { enabled: true
}` in addition to `fulfillmentCodeHook`, slots `specialty` → `timeOfDay` → `selectedSlot` in that
priority, and an `intentConfirmationSetting` whose prompt text is dynamic
(`{specialty}`/templated day-time, following `AuthIntent`'s pattern) with a
`declinationNextStep` that resets only `selectedSlot`, keeping `specialty`/`timeOfDay` — the
decline-restart decision from this planning session.

### Success Criteria:

#### Automated Verification:

- `cdk synth` succeeds
- `infra/test/infra.test.ts`'s `Template.fromStack` assertions still pass, extended to assert the
  `Booking` function and `BookingIntent` exist with the expected names/config

---

## Phase 6: Contact flow + hand-off

### Overview

Console-only work (flows are hand-built and not committed, per project convention) plus the
documentation and roadmap bookkeeping every prior slice has done at this point, plus the full
manual verification matrix — the only place this slice's genuinely new platform mechanics
(dialog code hook, the auth-gate redirect) get proven end to end.

### Changes Required:

#### 1. Keypad booking menus

**Console work** (`connect-flow-templates/`, gitignored, personal working copy only): a main-menu
branch to "Book an appointment" that first checks the `authenticated` contact attribute and
invokes the existing Authenticate Contact Flow Module if absent, then a paged specialty menu (up
to 9 items per screen with a reserved digit for "more", per this session's keypad-paging
decision), a 4-item time-of-day menu, then three `Invoke AWS Lambda` calls into `Booking` for
`days` → `times` → `confirm`/`book`, reading back each menu from the Lambda's returned text.

**Intent**: Exercises Phase 3's four-step handler over a real call.

#### 2. Speech booking flow

**Console work**: extends the existing speech Contact Flow to route `BookingIntent` the same way
`AuthIntent`/`OtpIntent` already route, with the `needsAuth` branch added.

#### 3. Contract surfaces

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Documents the new `Details.Parameters` fields the keypad flow must pass to `Booking`
at each step, the `selectedSlot` dual-purpose reuse and its `slotValueOverride` reset, the
`needsAuth` attribute and which flow branch reads it, and — this slice's FR-012 measurement
requirement — the turn-count counting convention: *turns-to-completion for a booking session is
the count of `InvocationRecord`s with `handler: 'booking'` (keypad) or `handler:
'facility-info-speech'` carrying a `BookingIntent`-stage marker (speech) sharing one `contactId`*,
so no new schema field is needed on `InvocationRecord` itself.

#### 4. Roadmap sync

Handled by this skill's own Step 4 roadmap-sync (S-05 → `planning`); no separate edit here.

### Success Criteria:

#### Manual Verification:

- A real call, keypad variant: authenticate (or get auto-routed to authenticate first), book a
  seeded specialty/time-of-day with real availability, end-to-end to a confirmed booking, and the
  corresponding `slot` row is `taken = true` with the caller's `patientId` in `his/`'s database
- A real call, speech variant: same outcome, reached by a single utterance naming both specialty
  and time-of-day, confirming the multi-slot claim the hypothesis rests on
- A real call, either variant: request the unseeded specialty, hear the no-availability message,
  and successfully recover by choosing a different specialty
- A real call, either variant: request the fully-booked doctor's specialty/time-of-day, hear the
  same no-availability message (provably indistinguishable from the unseeded-specialty case)
- A real call, either variant: decline the read-back confirmation once, and land back at the day
  offering with specialty and time-of-day preserved (not re-asked)
- Three consecutive no-availability outcomes on the same variant transfer to the agent queue
- An unauthenticated caller reaching for booking is walked through authentication and lands back
  in the booking flow afterward, in both variants
- CloudWatch: a completed booking session's `handler: 'booking'` records, grouped by `contactId`,
  give a sane turn count (no missing or duplicated turns)

---

## Testing Strategy

### Unit Tests:

- `appointment.service.spec.ts` — day/time search correctness against seeded data, including both
  edge cases (unseeded specialty, fully-booked doctor)
- `@pcm/appointment` — resolution re-derivation is stable across repeated calls with the same
  inputs (a core L-03 guarantee, worth asserting explicitly, not just implying)
- `lambdas/booking` — all four steps, the `needsAuth` short-circuit, both edge cases
- `lambdas/facility-info-speech` — `BookingIntent`'s dialog-hook and fulfillment-hook branches

### Integration Tests:

- None beyond `cdk synth` and the existing `Template.fromStack` assertions — this project has no
  deployed integration test harness (established precedent from S-01–S-04); correctness rests on
  the manual call matrix.

### Manual Testing Steps:

See Phase 6 Manual Verification — this is where the real test plan for this slice lives.

## Performance Considerations

Four sequential Lambda invocations per booking session (days, times, confirm, book), each one a
fresh cold path to `his/` inside the 2-second p95 budget (NFR-12) that already governs every other
Lambda in this stack — no new performance surface, but four turns instead of one means the
handling-time comparison against the keypad's equivalent (also four turns, one per menu) is fair.

## Migration Notes

Additive only — new tables, no changes to `facility` or `patient`. `down` drops `slot` before
`doctor` (FK order).

## References

- Roadmap: `context/foundation/roadmap.md` → S-05
- PRD: `context/foundation/prd.md` → FR-012, §Business Logic, §Access Control
- NLU vocabulary: `context/foundation/lex-sample-utterances.md` → `BookingIntent`, `specialty`,
  `timeOfDay`
- Prior slice, closest precedent: `context/pending-verification/caller-id-authentication/plan.md`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Scheduling data model

#### Automated

- [x] 1.1 `npm run test` inside `his/` passes, including new `appointment.service.spec.ts` cases — b8624d7
- [x] 1.2 `npm run migration:run` inside `his/` applies cleanly against a fresh database — b8624d7

#### Manual

- [ ] 1.3 `GET /appointment/days` for a seeded specialty returns real future dates
- [ ] 1.4 `GET /appointment/days` for the unseeded specialty and the fully-booked doctor's
      specialty both return an empty array

### Phase 2: `@pcm/appointment` shared module

#### Automated

- [x] 2.1 `npm test --workspace lambdas/appointment` passes — e69738a

### Phase 3: Keypad Lambda

#### Automated

- [x] 3.1 `npm test --workspace lambdas/booking` passes — fa38597

### Phase 4: Speech fulfillment

#### Automated

- [x] 4.1 `npm test --workspace lambdas/facility-info-speech` passes, including new
      `BookingIntent` cases — d069cad

### Phase 5: Infrastructure

#### Automated

- [x] 5.1 `cdk synth` succeeds — 1e093a6
- [x] 5.2 `infra/test/infra.test.ts` assertions pass, extended for `Booking` and `BookingIntent` — 1e093a6

### Phase 6: Contact flow + hand-off

#### Manual

- [ ] 6.1 Real call, keypad: end-to-end booking against a seeded specialty, slot row confirmed
      `taken` in the database
- [ ] 6.2 Real call, speech: end-to-end booking from a single utterance naming both specialty and
      time-of-day
- [ ] 6.3 Real call, either variant: unseeded-specialty no-availability recovery
- [ ] 6.4 Real call, either variant: fully-booked-doctor no-availability, indistinguishable
      wording from 6.3
- [ ] 6.5 Real call, either variant: decline the read-back once, land back at day offering with
      specialty/time-of-day preserved
- [ ] 6.6 Three consecutive no-availability outcomes transfer to the agent queue
- [ ] 6.7 Unauthenticated caller reaching for booking is routed through authentication and back,
      both variants
- [ ] 6.8 CloudWatch turn-count check: `handler: 'booking'` records grouped by `contactId` give a
      sane count for a completed session
