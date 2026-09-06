# English Keypad Locale (Variant A) — Plan Brief

> Full plan: `context/changes/english-locale/plan.md`

## What & Why

Roadmap slice S-10, scoped to the keypad variant only: an English-speaking caller selects English
with a DTMF digit at the start of the call and completes facility-info and booking entirely in
English. The speech variant's automatic language detection is a separate, blocked thread
(`lex-language-detection-spike`, F-04) and is out of scope here.

## Starting Point

Every keypad flow today is Polish-only. Facility-info is already locale-neutral at the Lambda
level (the flow builds 100% of the spoken text itself from raw data) — but booking is not: the
`Booking` Lambda builds Polish day labels and a Polish confirmation sentence internally, and
booking sits behind an authenticate step that also speaks Polish.

## Desired End State

Dial in, hear a short bilingual prompt, press 1 for Polish (unchanged) or 2 for English. An
English caller gets an all-English main menu, facility-info lookup, PESEL/phone identity capture,
and a full specialty/time-of-day/day/time booking flow ending on an English confirmation — over
the exact same booking data and rules the Polish path uses.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Operation scope | Facility-info + booking only | Matches the roadmap's own stated S-10 outcome; list/cancel/reschedule stay Polish-only for now. |
| Locale plumbing | Add a `locale` param to `lambdas/booking`, branch internally | Keeps one Lambda, one CDK registration; `@pcm/appointment` stays byte-for-byte unchanged. |
| Counting rule (Open Roadmap Q2) | Caller-facing text units (duplicated flow/Lambda strings vs. added Lex utterances), shared-logic diff = zero | Already the recommendation on record in `change.md`. |
| Language-selection entry point | New DTMF entry flow ahead of the main menu | Consistent with Variant A being fully digit-driven; mirrors Variant B's detection gate. |
| Specialty display names | Standard English medical terms, translated directly | Unambiguous, no extra research needed. |
| Agent-facing `transferReason` text | Stays Polish for every locale | Agent workspace and agent are Polish; not caller-facing. |

## Scope

**In scope:**
- New language-select entry flow (DTMF, 1=Polish/2=English)
- English facility-info main menu (no Lambda change)
- English authenticate + authenticated-menu flows (caller-ID shortcut path only)
- English booking flow + `locale` param on `lambdas/booking/index.ts`
- Contract-surfaces + naming-convention doc updates

**Out of scope:**
- Speech variant (Variant B) — blocked on F-04
- English appointment-list, cancel, reschedule
- English OTP flow/module (falls back to Polish for unrecognized numbers)
- Translating `transferReason` (agent-facing, stays Polish)
- Repointing the live number's entry flow (manual console step, Phase 5)

## Architecture / Approach

One new entry flow gates on a DTMF digit and transfers into either the existing Polish tree
(untouched) or a new English tree that structurally mirrors it block-for-block: main menu →
authenticate → authenticated menu → booking. Every English flow keeps the exact same wire values
(`specialty`, `timeOfDay` stay Polish keys like `kardiolog`/`rano`) and only translates
caller-facing prompt text plus the TTS voice. The one Lambda that builds its own caller-facing text
(`lambdas/booking`) gains a `locale` parameter (default `'pl'`, so the Polish flow's behavior is
byte-identical to today) that branches only its own day-label/specialty-name/message-template
formatting — never touching the shared `@pcm/appointment` package.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Booking Lambda locale branch | `locale` param, English day-label/specialty/message formatting | Must not change Polish output when `locale` is absent |
| 2. Language-select + English facility-info | New entry flow; simplest English duplicate proves the pattern | `#`/transfer targets must point at English siblings, not Polish |
| 3. English authenticate + authenticated-menu | Caller-ID-shortcut identity path in English | OTP fallback intentionally stays Polish — must not silently over-scope |
| 4. English booking flow | Full specialty/time-of-day/day/time/confirm sequence | Heaviest phase; translation coverage across ~20 menu items |
| 5. Docs + end-to-end verification | Contract-surfaces entry, naming convention, full manual matrix | Manual console repointing of the live number's entry flow |

**Prerequisites:** none blocking — independent of the F-04 spike since it's keypad-only.
**Estimated effort:** ~1-2 sessions across 5 phases; Phase 4 is the largest single piece.

## Open Risks & Assumptions

- English callers who fail the caller-ID shortcut hit a Polish OTP challenge — a known, accepted
  gap, not a defect to chase down later unless the scope is deliberately widened.
- The `-en` filename suffix convention is new; if a later slice needs a third locale, revisit
  whether suffix or a subdirectory scales better.

## Success Criteria (Summary)

- An English caller can complete facility-info and a full booking (including edge cases) entirely
  in English, verified against real mock data on a real call.
- The Polish path is verified unchanged (regression check) since none of its files are modified.
