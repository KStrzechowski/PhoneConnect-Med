# Appointment Cancel — Plan Brief

> Full plan: `context/changes/appointment-cancel/plan.md`

## What & Why

An authenticated caller cancels one of their scheduled appointments, releasing the slot, in both
the keypad and natural-language variants (FR-014). This is roadmap slice S-07 — a MUST in the
source thesis, sequenced after S-06 (appointment list) because the caller needs to hear which
appointments exist before naming one to cancel.

## Starting Point

S-05's `Slot` row already models cancellation as booking's inverse (`taken=false, patientId=null`
frees a slot). S-06 (`appointment-list`, currently in `context/pending-verification/`) built
`findAppointmentsForPatient`/`listAppointments` and the day-label formatter this plan reuses
directly, and established the two-entry-point (main menu + authenticated menu), auth-gated menu
pattern this plan repeats for a third time.

## Desired End State

A caller who asks to cancel an appointment, in either variant, hears their upcoming appointments,
picks one by number, hears it read back, confirms, and hears it was cancelled — with the slot
verifiably free and rebookable afterward. Zero appointments, an invalid selection, a declined
confirmation, and a downstream failure each have a clear, non-dead-end outcome.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Which appointment | Caller selects by position (1/2/3) from a fresh list, resolved server-side — never a raw ID | Matches booking's `dayChoice`/`timeChoice` precedent and L-03; a discarded earlier design (`.reference/legacy-src`) spoke real appointment IDs and was rejected for this reason. |
| Confirmation before cancelling | Yes — read back + explicit 1/2 (keypad) or yes/no (speech) turn | Cancel is more consequential than booking, which already gets a confirm step; user confirmed. |
| Single appointment | Still requires a digit press, no auto-select | Keeps one code path regardless of count, matching booking's day/time menus; user confirmed. |
| Post-confirm cancel failure (stale/race) | Say it failed, return to the authenticated menu — no retry loop | Simpler than booking's retry-on-taken-slot loop; a caller's own appointment going stale mid-call is much rarer than a public slot being taken; user confirmed. |
| Contact-flow shape | Standalone flow with its own listing step, not chained through the existing list flow | One hop instead of two; the list flow's fixed announce-and-exit shape doesn't carry a selection menu, and reusing it would need more wiring than the small formatter duplication it avoids; user confirmed. |
| Scope | Caller-side cancel only, both variants, both entry points, no cuts | Matches the roadmap's own sequencing (reschedule/agent-cancel are separate, later slices) and FR-014's MUST status; user confirmed. |
| Speech confirmation mechanism | Lex's native `intentConfirmationSetting`, not the documented-but-unimplemented `ConfirmationIntent`/`DenyIntent` intents | `BookingIntent` already resolved this exact question the same way; nothing in `infra-stack.ts` uses the standalone intents. |

## Scope

**In scope:**
- New HIS `POST /appointment/cancel` endpoint + `AppointmentService.cancel()`
- New `resolveAppointment`/`cancelAppointment` functions in `@pcm/appointment`
- New keypad Lambda (`lambdas/appointment-cancel`, 3 steps: list/confirm/cancel)
- New `CancelIntent` Lex intent + dialog/fulfillment handling in `facility-info-speech`
- New contact flow (`keypad-appointment-cancel-flow.json`) + two new menu digits
- `contract-surfaces.md` registration

**Out of scope:**
- Rescheduling (FR-015 / S-08)
- Agent-workspace cancellation (FR-017 / S-12)
- Any new entity, migration, or persistence change
- Exposing a real slot/appointment database ID anywhere caller-facing

## Architecture / Approach

Same shape as every prior slice: thin mock endpoint → thin `@pcm/appointment` wrapper → a keypad
Lambda and a speech-intent branch calling identical shared functions, never resolving domain data
themselves (L-03). The keypad Lambda is step-based like `lambdas/booking` (3 steps instead of 4 —
no search-parameter phase, just the caller's own list). The speech side mirrors `BookingIntent`'s
dialog-code-hook stage machine almost exactly, with one fewer stage.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared business logic | Mock cancel endpoint + `AppointmentService.cancel` + `@pcm/appointment` functions | Low — pure inverse of an existing, tested `book` method |
| 2. Keypad Lambda | `lambdas/appointment-cancel` + infra registration | Low — direct structural copy of `lambdas/booking`'s step dispatch |
| 3. Speech intent | `CancelIntent` + dialog/fulfillment handlers | Low-Medium — new stage machine, but a close mirror of `BookingIntent`'s already-verified one |
| 4. Contact flow & hand-off | New flow file, two menu digits, contract-surfaces update, real-call verification | Hand-built flows are outside IaC and unverified until a real call is placed — same residual risk every prior slice's final phase carries |

**Prerequisites:** S-06 (`appointment-list`, currently in `context/pending-verification/`) must
be deployed and its manual verification confirmed — this plan reuses its query and formatting
functions directly.
**Estimated effort:** ~1 session, similar to S-06's own estimate — one fewer Lambda step, one
fewer speech stage, but a net-new mutation endpoint and a genuine (if small) confirm-step design.

## Open Risks & Assumptions

- Assumes S-06's `listAppointments`/`findAppointmentsForPatient` behave as documented — S-06 is
  still in `context/pending-verification/` at the time this plan was written, not yet confirmed
  against a real call.
- Contact flows are hand-built and outside IaC; Phase 4 accumulates the same
  "not reproducible from the repo alone" limitation already recorded for booking and list.

## Success Criteria (Summary)

- An authenticated caller, either variant, selects, confirms, and cancels one of their own
  upcoming appointments, and the released slot is verifiably rebookable afterward.
- An unauthenticated caller reaching for cancel is transparently routed through authentication
  first, in both variants, without a dead end.
- A caller with no appointments, an out-of-range selection, a declined confirmation, or a
  downstream failure each reach a clear, non-dead-end outcome rather than an error or silent drop.
