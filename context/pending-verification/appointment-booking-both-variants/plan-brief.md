# Appointment Booking, Both Variants — Plan Brief

> Full plan: `context/changes/appointment-booking-both-variants/plan.md`

## What & Why

Roadmap **S-05**, the project's north star: an authenticated caller books a visit by specialty and
preferred time of day, offered up to three available days then times within the chosen day, in
both the keypad variant and the natural-language variant over one shared business-logic layer.
This is the first slice that produces the comparison evidence the thesis exists to gather — every
slice before it (facility info, authentication) was infrastructure or a one-keypress task that
favours the keypad by construction.

## Starting Point

`his/` has `facility` and `patient` domains, no scheduling data at all. The keypad-Lambda and
speech-single-dispatcher patterns are well-established from S-01–S-04, and `authenticated` /
`patientId` session/contact state already exists from S-03 for any later slice to read.
`context/foundation/lex-sample-utterances.md` already authored `BookingIntent`'s full NLU surface
(slots, a 15-value specialty vocabulary, a 4-value time-of-day vocabulary) ahead of this planning
session.

## Desired End State

A caller reaches a specialty + time-of-day preference, hears up to three days, picks one, hears up
to three times that day, hears a read-back, confirms, and a real slot in `his/` is marked booked.
No availability (no doctor, or no free slot) is announced identically either way and recoverable
by choosing again, capped at three attempts like every other safety net in this system. An
unauthenticated caller is walked through the existing authentication step first, automatically, in
both variants.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Slot storage | Precomputed slot rows (doctor, date, time, taken, patientId) | Matches the existing Postgres/TypeORM pattern and avoids runtime date arithmetic under a one-week clock |
| Specialty roster | 14 of 15 specialties seeded with a doctor; 1 left with none | User's explicit choice — exercises "no doctor" and "no availability" as two distinct, real edge cases rather than a thin curated list |
| Keypad specialty menu | Paged, 9 per screen, reserved digit for more | 14 items don't fit a flat one-digit menu; paging keeps it a genuine usable control-group menu rather than shrinking the roster to fit |
| Booking Lambda | One multi-step handler (`days`→`times`→`confirm`→`book`) | Mirrors `authenticate`'s existing multi-outcome shape; avoids tripling the CDK/IAM surface for a linear conversation |
| Turn-count measurement | Derived post-hoc from `InvocationRecord`s sharing a `contactId` | Reuses F-02's stated purpose exactly as designed; zero new session-attribute plumbing |
| Confirmation decline | Back to day offering, keeping specialty + time-of-day | Booking has 4 captured values vs. auth's 2 — a full restart on declining one offered slot is a real UX/turn-count cost S-03's precedent didn't have to pay |
| No-availability handling | Announce, re-elicit, cap at 3 attempts then transfer | Reuses the existing global attempt-counter safety mechanism instead of a new one |
| Shared-layer scope | Narrow — booking only, not shaped for S-06/S-07/S-08 | No speculative abstraction (L-02); those slices add their own operations when planned |
| Times-per-day cap | 3, no paging (plan-time decision, not asked) | Same reasoning already accepted for the days cap, applied identically for the same non-confounding reason |

## Scope

**In scope:** `his/` `Doctor` + `Slot` entities, migration + seed data (including both edge
cases), 3 REST endpoints; `@pcm/appointment` shared module; `lambdas/booking/` (keypad);
`BookingIntent` added to the existing `facility-info-speech` dispatcher, including a new dialog
code hook mechanism; infra wiring for the new function and Lex intent/slots; the keypad and speech
contact-flow console work; contract-surfaces documentation of the new attributes and the
turn-count counting convention.

**Out of scope:** listing, cancelling, rescheduling (S-06–S-08); intent-accuracy measurement
(S-09); English locale (S-10); doctor selection by the caller; any change to the existing
authenticate step beyond adding an entry path into it.

## Architecture / Approach

`@pcm/appointment` owns the one decision that must never diverge between variants: given a
specialty, a time-of-day preference, and a raw day/time choice, which specific date and time that
choice means — re-derived by re-running the same search every time rather than trusting anything
a contact flow or Lex session stored, the concrete form L-03 takes here. Both
`lambdas/booking/` (keypad) and the extended `facility-info-speech` (speech) call the same
functions and only render the result. The speech side's dialog code hook is the one genuinely new
platform mechanism in this codebase — nothing existing uses it — and its counterpart, the
auth-gate redirect for an unauthenticated caller reaching for booking, is flagged as this plan's
highest platform uncertainty, to be proven in Phase 6's manual verification rather than a separate
spike.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scheduling data model | `his/` `Doctor` + `Slot`, seed data with both edge cases built in | First new multi-table domain; getting the seed data genuinely exercising both edge cases |
| 2. `@pcm/appointment` module | Deterministic day/time resolution + booking | The single piece of logic both variants must never duplicate (L-03) |
| 3. Keypad Lambda | `lambdas/booking/`, 4-step dispatch | Handler legibility as branches grow to 4 |
| 4. Speech fulfillment | `BookingIntent` in the existing dispatcher | First use of a Lex dialog code hook in this codebase |
| 5. Infrastructure | New function + Connect association; `SpeechBot` gets `BookingIntent` | Dialog-hook + dynamic-confirmation CDK config is new surface |
| 6. Contact flow + hand-off | Console flows in both variants, contract-surfaces, full manual matrix | The auth-gate redirect and dialog-hook mechanics are unproven until a real call exercises them |

**Prerequisites:** S-03 (in progress, sitting in `context/pending-verification/`) code-complete —
this plan reads `authenticated`/`patientId` state S-03 sets. S-04 is not a prerequisite.
**Estimated effort:** the roadmap's own risk note calls this the heaviest slice; expect 3-4
sessions across 6 phases, with Phase 1 (data model + seed design) and Phase 6 (manual matrix +
unproven platform mechanics) the two that can't be rushed.

## Open Risks & Assumptions

- **The dialog-code-hook + auth-gate-redirect mechanism is unproven.** Unlike F-03's DTMF capture
  (which got its own spike before S-03 was planned), this plan reuses that now-confirmed mechanism
  in a new position without a separate spike — accepted because the underlying capability
  (in-conversation attribute carrying) is already proven, only its application here is new.
- **Seed data density (2+ times per time-of-day bucket per weekday) is a plan-time judgment call**,
  not user-specified — chosen so the times-within-a-day step has genuine, if modest, choice to
  offer; can be widened later with no code change if it proves too thin during manual testing.
- **No race-condition fix beyond "booking can fail" is built** for the read-back-to-confirm window
  where another caller could take the same slot — accepted as a residual limitation of a
  multi-turn phone call at this project's scale.

## Success Criteria (Summary)

- A real call books a real, verifiable slot end-to-end in both variants, including the
  single-utterance multi-slot case in speech that the hypothesis is actually about
- Both no-availability edge cases (no doctor, no free slot) are indistinguishable to the caller
- An unauthenticated caller reaching for booking is carried through authentication automatically
  in both variants, without a redesign of the existing authenticate step
