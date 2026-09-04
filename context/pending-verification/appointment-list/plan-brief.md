# Appointment List — Plan Brief

> Full plan: `context/changes/appointment-list/plan.md`

## What & Why

An authenticated caller hears the list of their scheduled appointments, in both the
keypad and natural-language variants (FR-013). This is roadmap slice S-06 — "cheap
breadth" per the roadmap's own framing: since business logic is shared, the marginal
cost is one query, one menu digit, and one intent, not a new capability.

## Starting Point

S-05 (`appointment-booking-both-variants`, in-progress) introduced the data model this
slice reuses: a `Slot` row with `taken=true` and `patientId=<id>` *is* the appointment
record — there is no separate `Appointment` entity. `@pcm/appointment` currently only
has search-and-book functions; S-05's own plan explicitly deferred listing to this
slice. Caller identity (`patientId`) is already available via the `authenticated`
contract established in S-03.

## Desired End State

A caller who asks to hear their appointments (keypad digit or a natural utterance)
hears each one — specialty, day, time — soonest first, capped at three with a fixed
"more" line if applicable, or a clear "no appointments" message. An unauthenticated
caller is routed through authentication first, exactly as booking already handles it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Time scope | Upcoming only (`date >= today`) | Matches the natural meaning of "scheduled"; a system with no "completed" flag would otherwise mix stale past visits into the list. |
| List shape | Chronological, capped at 3, fixed overflow line | Mirrors S-05's own precedent (days capped at 3, no paging) — same safe-because-symmetric reasoning. |
| Menu entry | New main-menu digit with the same auth-gate `Compare` block booking already uses; speech reuses `BookingIntent`'s `needsAuth` loop-back (Lex can't switch intents mid-turn) | Reuses an existing, already-verified mechanism instead of inventing a second one. |
| Announcement content | Specialty + day label + time (no doctor name) | Reuses `formatDayLabel` and booking's existing vocabulary; doctor name would lengthen every line for marginal value. |
| Overflow detection | Query `LIMIT 4`, slice to 3 in the presentation layer | Detects "more exist" without a second `COUNT(*)` round trip. |
| `formatDayLabel` | Promoted from two independent local copies (`lambdas/booking`, `lambdas/facility-info-speech`) into `@pcm/appointment` | A third duplicate would make three independent copies of the same formatting logic. |

## Scope

**In scope:**
- New `findAppointmentsForPatient` query (mock) and `listAppointments` (shared module)
- New keypad Lambda (`lambdas/appointment-list`)
- New speech intent (`ListAppointmentsIntent`), handled inline like `InfoIntent`
- Two new contact-flow entry points (main menu, authenticated menu) + one new small flow
- `contract-surfaces.md` registration of the two new digits and output fields

**Out of scope:**
- Any new entity, migration, or persistence change
- Pagination beyond the fixed cap-plus-overflow-line
- Cancel/reschedule actions (S-07/S-08)
- Past/historical appointments

## Architecture / Approach

Same shape as every prior slice: a thin mock endpoint → a thin `@pcm/appointment`
wrapper → a keypad Lambda and a speech-intent branch that both call the identical
shared function, never resolving domain data themselves (L-03). The only new
mechanism is a small dedicated contact flow (`keypad-appointment-list-flow.json`)
reachable from two entry points, following booking's own two-entry-point pattern.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared business logic | Mock query + endpoint + `@pcm/appointment` function + `formatDayLabel` extraction | Low — pure query addition over an existing table |
| 2. Keypad Lambda | `lambdas/appointment-list` + infra registration | Low — mirrors `facility-info`'s simplest existing shape |
| 3. Speech intent | `ListAppointmentsIntent` inline branch + infra Lex intent | Low — no dialog, no new slot types |
| 4. Contact flow & hand-off | New flow file, two menu digits, contract-surfaces update, real-call verification | Hand-built flows are outside IaC and unverified until a real call is placed — same residual risk S-05's Phase 6 still carries |

**Prerequisites:** S-03 (`caller-id-authentication`) must be authenticating callers in practice for manual verification; S-05's `Slot`/`Doctor` schema must be deployed (already true per its Phase 1 automated checks).
**Estimated effort:** ~1 session, well under the north star's (S-05) effort — matches the roadmap's own "marginal cost is one operation plus one menu branch plus one intent" characterization.

## Open Risks & Assumptions

- Assumes S-05's `Slot`/`Doctor` schema in the deployed database matches what's in the migration file — S-05's own Phase 1 manual verification (querying `/appointment/days`) is still unchecked at the time this plan was written.
- Contact flows are hand-built and outside IaC; Phase 4 accumulates the same "not reproducible from the repo alone" limitation already recorded for booking.

## Success Criteria (Summary)

- A caller in either variant, once authenticated, hears an accurate, chronologically
  ordered list of their own upcoming appointments, correctly capped with an overflow
  line when applicable, or a clear empty-list message.
- An unauthenticated caller reaching for this option is transparently routed through
  authentication first, in both variants, without a dead end.
- A mock outage transfers the caller to an agent rather than erroring the call.
