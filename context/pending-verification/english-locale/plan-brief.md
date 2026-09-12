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
| **Flow architecture (revised 2026-09-06)** | **One shared flow per menu, locale read from `$.Attributes.locale`, prompts from native Amazon Connect Data Tables** | **The original "-en duplicate flow" design measured how the flows happened to be built, not anything inherent to keypad IVR. A Lambda-backed version was built first, then replaced with native Data Tables (no Lambda) once found — see `change.md`'s two revision notes.** |
| Counting rule (Open Roadmap Q2) | Revised: one-time locale-infrastructure cost vs. per-language content added after | The duplicated-file counting rule no longer fits the shared-flow design; not yet locked in — see `change.md`. |
| Language-selection entry point | New DTMF entry flow ahead of the main menu, now setting `$.Attributes.locale` instead of branching to a different flow | Consistent with Variant A being fully digit-driven; mirrors Variant B's detection gate. |
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

One new entry flow gates on a DTMF digit and sets `$.Attributes.locale` (`"pl"`/`"en"`) before
transferring into the single, shared main-menu flow — no separate English flow tree. Every
locale-aware flow (main menu, authenticate, authenticated-menu, booking) runs a Data Table
Evaluate query once near its start (no Lambda), copies the returned columns into persisted
contact attributes, and picks its TTS voice with a `Compare` on `$.Attributes.locale`. Wire values
(`specialty`, `timeOfDay` stay Polish keys like `kardiolog`/`rano`) are unchanged. The one Lambda
that builds its own caller-facing text (`lambdas/booking`) gains a `locale` parameter (default
`'pl'`, so an absent/unknown locale is byte-identical to today) that branches only its own
day-label/specialty-name/message-template formatting — never touching the shared `@pcm/appointment`
package. Rationale for the shared-flow design and the Data-Table-over-Lambda choice:
`change.md`'s two revision notes.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Booking Lambda locale branch | `locale` param, English day-label/specialty/message formatting | Must not change Polish output when `locale` is absent |
| 2. Data Tables (schema + content) | Four hand-built Data Tables backing every locale-aware flow's text | The Data Table block has no importable JSON form — a real, narrower gap than this repo's usual "hand-built but fully JSON'd" flows |
| 3. Language-select + locale-aware facility-info menu | Entry flow sets `locale`; main menu made locale-aware in place | List/cancel/reschedule must stay blocked for English, not just untranslated |
| 4. Locale-aware authenticate + authenticated-menu | Caller-ID-shortcut identity path speaks the caller's language | OTP fallback intentionally stays Polish — must not silently over-scope |
| 5. Locale-aware booking flow | Full specialty/time-of-day/day/time/confirm sequence | Composite messages must weave live Lambda output with prompt text before `$.External.*` goes stale |
| 6. Docs + end-to-end verification | Contract-surfaces entries, full manual matrix | Manual console repointing of the live number's entry flow |

**Prerequisites:** none blocking — independent of the F-04 spike since it's keypad-only.
**Estimated effort:** ~1-2 sessions across 6 phases; Phase 5 is the largest single piece.

## Open Risks & Assumptions

- English callers who fail the caller-ID shortcut hit a Polish OTP challenge — a known, accepted
  gap, not a defect to chase down later unless the scope is deliberately widened.
- Data Table Query Name/column names are hand-typed literals with no compiler check against a
  flow's `copyPrompts` references — a typo fails silently (empty text), not a build error.
- The Data Table block itself must be added by hand in the console every time a flow is
  re-imported — AWS hasn't published a Flow Language JSON schema for it.

## Success Criteria (Summary)

- An English caller can complete facility-info and a full booking (including edge cases) entirely
  in English, verified against real mock data on a real call.
- The Polish path is verified unchanged (regression check) since none of its files are modified.
