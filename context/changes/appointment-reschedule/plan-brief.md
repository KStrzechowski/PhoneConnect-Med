# Appointment Reschedule — Plan Brief

> Full plan: `context/changes/appointment-reschedule/plan.md`

## What & Why

An authenticated caller moves one of their scheduled appointments to a new date/time for the same
specialty, releasing the old slot, in both the keypad and natural-language variants (FR-015). This
is roadmap slice S-08 — the roadmap itself calls it "structurally cancel-then-book... nearly free
once they exist," since both prerequisites (S-05 booking, S-07 cancel) are code-complete.

## Starting Point

`@pcm/appointment` already has every primitive this needs: `resolveAppointment` (position digit →
one of the caller's own appointments), `resolveDay`/`resolveTime` (position digit → actual
date/time), `bookAppointment`, `cancelAppointment`. No HIS entity, endpoint, or migration exists to
add — this slice is pure composition of already-built, already-tested mutations.

## Desired End State

A caller who wants to reschedule, in either variant, hears their upcoming appointments, picks one,
states a time-of-day preference, hears up to three days then up to three times, hears a combined
old+new read-back, confirms, and hears it was rescheduled — with the old slot verifiably free and
the new one verifiably booked. Zero appointments, no availability, a stale selection, a declined
confirmation, and a downstream failure each have a clear, non-dead-end outcome.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Mutation order | Book the new slot first, then cancel the old one | If the new slot isn't available, nothing has changed yet and the caller just retries; the alternative (cancel-first) can strand a caller with zero appointments if the new booking then fails. User confirmed. |
| Partial-failure handling | Accepted residual risk, no special recovery code | If the old-slot cancel fails after a successful new booking (rare), the caller briefly holds two appointments — same class of accepted risk as S-05's booking race condition; not worth new engineering. User confirmed. |
| Specialty scope | Same specialty only — no specialty menu in this flow | Matches FR-015's wording ("move an appointment to a new slot"); a caller wanting a different specialist already has cancel-then-book. User confirmed. |
| Confirmation decline | Loop back to day offering (old appointment + time-of-day preference kept) | Matches `BookingIntent`'s own decline precedent; reuses its "stage aliasing" trick so no new state machine branch is needed. User confirmed. |
| Stale old-appointment resolution | Retry the selection, capped at 3, then give up | Exact existing precedent from `CancelIntent`'s `resolveAppointment` returning null. User confirmed. |
| Single appointment | Still requires a digit press, no auto-select | Matches `appointment-cancel`'s identical decision — one code path regardless of list length, comparable turn counts across sibling slices. User confirmed. |
| HIS changes | None — no new entity, endpoint, or migration | `bookAppointment`/`cancelAppointment` already exist and are already tested; reschedule composes them client-side in `@pcm/appointment`. |

## Scope

**In scope:**
- New `rescheduleAppointment` function in `@pcm/appointment` (composes existing book + cancel)
- New keypad Lambda (`lambdas/appointment-reschedule`, 5 steps: list/days/times/confirm/reschedule)
- New `RescheduleIntent` Lex intent + dialog/fulfillment handling in `facility-info-speech`
- New contact flow (`keypad-appointment-reschedule-flow.json`) + two new menu digits
- `contract-surfaces.md` registration

**Out of scope:**
- Changing specialty during a reschedule
- Agent-workspace rescheduling (FR-017 / S-12)
- Any new HIS entity, migration, endpoint, or atomic transaction
- Exposing a real slot/appointment database ID anywhere caller-facing
- Auto-selecting a caller's sole appointment

## Architecture / Approach

Same shape as every prior appointment slice: a thin shared-layer composition function, a
step-based keypad Lambda, and a speech-intent branch, all reaching identical business logic
(L-03). The keypad Lambda is `appointment-cancel`'s list-and-resolve step glued to `booking`'s
days/times/confirm shape, with `reschedule` replacing `book`. The speech side is a four-stage
dialog machine combining `CancelIntent`'s position-resolution stage with `BookingIntent`'s
day/time search stages — including reusing `BookingIntent`'s exact decline-aliasing trick so a
declined confirmation redoes the day search without a new code path.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared business logic | `rescheduleAppointment` composing existing book+cancel | Very low — no new HTTP endpoint, pure composition of tested functions |
| 2. Keypad Lambda | `lambdas/appointment-reschedule` + infra registration | Low — direct structural merge of two already-built Lambdas' step shapes |
| 3. Speech intent | `RescheduleIntent` + dialog/fulfillment handlers | Medium — the trickiest part is reusing `selectedSlot` a third time and getting the decline-reentry alias right (documented in the plan's Critical Implementation Details) |
| 4. Contact flow & hand-off | New flow file, two menu digits, contract-surfaces update, real-call verification | Hand-built flows are outside IaC and unverified until a real call is placed — same residual risk every prior slice's final phase carries |

**Prerequisites:** S-05 (`appointment-booking-both-variants`) and S-07 (`appointment-cancel`), both
currently in `context/pending-verification/`, must be deployed and manually confirmed — this plan
calls their shared functions directly.
**Estimated effort:** the roadmap's own risk note calls this "nearly free" once its prerequisites
exist; expect a shorter session than either prerequisite, since Phase 1 needs no new HIS code at
all and Phases 2–3 are structural recombinations of already-verified patterns.

## Open Risks & Assumptions

- Assumes S-05's and S-07's shared functions behave as documented — both are still in
  `context/pending-verification/` at the time this plan was written, not yet confirmed against a
  real call.
- Accepts a small residual race window: if the new slot books successfully but freeing the old one
  then fails, the caller briefly holds two appointments with no automatic reconciliation. Same
  class of limitation already accepted for S-05's own booking race condition.
- Contact flows are hand-built and outside IaC; Phase 4 accumulates the same "not reproducible from
  the repo alone" limitation already recorded for booking, list, and cancel.

## Success Criteria (Summary)

- An authenticated caller, either variant, selects an appointment, picks a new day/time for the
  same specialty, confirms, and the reschedule is verifiable (old slot free, new slot booked).
- An unauthenticated caller reaching for reschedule is transparently routed through authentication
  first, in both variants, without a dead end.
- A caller with no appointments, no availability, a stale selection, a declined confirmation, or a
  downstream failure each reach a clear, non-dead-end outcome rather than an error or silent drop.
