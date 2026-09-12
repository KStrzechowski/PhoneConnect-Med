---
change_id: english-locale
title: English locale over unchanged shared business logic
status: impl_reviewed
created: 2026-09-05
updated: 2026-09-08
archived_at: null
---

## Notes

Roadmap S-10. Picked up in place of `intent-accuracy-measurement` (see that change's Notes) because
it is implementation work — new intents, duplicated keypad menus — rather than measurement that
depends on manual verification of already-built flows.

Open Roadmap Question 2 is unresolved: what exactly is counted to express the multilingualism
comparison (menu blocks/prompts duplicated for keypad vs. language artefacts added for speech, with
shared logic shown unchanged). The roadmap says to decide the counting rule before building this
slice, so the count is recorded as the work happens rather than reconstructed afterwards.
Recommended: caller-facing text units (strings duplicated in keypad flows vs. utterances/prompts
added to the Lex locale), with shared-logic diff shown as zero — decided during planning
discussion, not yet written into a plan.

Decisions made during planning discussion (2026-09-05), not yet in a written plan:
- **Language selection differs by variant.** Keypad (Variant A): DTMF-based selection, consistent
  with A being fully digit-driven already. Speech (Variant B): automatic detection from the
  caller's first utterance — chapter 3, §3.2.2 states this explicitly and twice, naming it as
  Variant B's key distinguishing claim versus A's menu structure. This is genuinely load-bearing,
  not a nice-to-have.
- **Blocked on `lex-language-detection-spike`.** No native AWS mechanism does first-utterance
  language routing for Lex V2; the mechanism must be assembled (Transcribe streaming
  `IdentifyLanguage` + a `RecognizeText` handoff so the first utterance's content, which may
  already carry a full booking request per chapter 3's worked example, isn't wasted). This is
  real, unproven platform risk — see that change's notes — spiked first, mirroring F-03's
  precedent, before this plan is written.
- Booking edge-case parity, global-command translation scope, and the exact counting-rule writeup
  were not fully settled before the conversation moved to spiking the language-detection mechanism.
  Revisit when picking this back up.

## Architecture pivot (2026-09-06): shared flows + a Prompts table, not duplicated flow trees

The plan below was originally built and partially implemented (Phase 1 merged, Phases 2-4 flow
files drafted) as five duplicated Polish/English flow file pairs, one `-en` sibling per menu — the
literal reading of chapter 3's comparison table claim that keypad "requires separate menu trees for
each language." Revisited before Phase 2-4's manual verification: duplicating whole flow trees to
prove that claim measures how the flows happened to be built, not something inherent to a
DTMF/keypad system — a naive implementation choice, not a finding.

**What changed:** `keypad-facility-info-main-menu-flow.json`, `keypad-authenticate-flow.json`,
`keypad-authenticated-menu-flow.json`, and `keypad-booking-flow.json` were rewritten in place to
serve both locales from one file each, reading `$.Attributes.locale` (set once by
`keypad-language-select-flow.json`) to pick prompts (via a new `lambdas/prompts/` Lambda + data
table, `docs/reference/contract-surfaces.md` → `Details.Parameters.flow` / `.locale`) and TTS
voice at runtime. The four `-en` flow files are deleted; `connect-flow-templates/README.md`'s `-en`
naming-convention bullet is removed (locale is no longer a filename axis). List/cancel/reschedule
stay blocked for `locale=en` via a small `Compare` guard per digit, preserving the original scope
decision (those downstream flows are still Polish-only) without needing a separate file to express
it.

**The sharper version of chapter 3's claim, and what still holds under it:** Amazon Lex V2 has a
native multi-locale concept (`BotLocale` per language, sharing intent/slot structure) — the
platform gives Variant B multilingual support. Amazon Connect Contact Flows have no equivalent —
there is no "flow locale" or built-in prompt-resource mechanism; the Prompts Lambda + data table
*is* that mechanism, and Variant A had to have it built for it, from nothing. That asymmetry is
real and survives good engineering; "keypad requires N duplicated flow files" does not. This is a
deviation from chapter 3's literal wording (§3.2, the "Wielojęzyczność" row), joining the other
recorded deviations — see Open Roadmap Question 3.

**Consequence for Open Roadmap Question 2** (what's counted for the multilingualism comparison):
the original candidate — "caller-facing text units duplicated in keypad flows vs. Lex
utterances/prompts added" — assumed duplication as the unit of comparison and no longer fits.
Revised candidate, not yet locked in: locale-infrastructure engineering built once (per the
mechanism below, one-time cost) vs. per-language content added after that infrastructure exists
(data-table rows for keypad; a new `BotLocale` with its own trained utterances for speech) — with
the qualitative note that keypad's added-content step is a straight translation with no
correctness dimension, while the bot's is also an NLU-accuracy question the intent-accuracy
measurement work already covers. Still needs a final decision before S-10's number is written up.

## Second revision (2026-09-06, same day): native Amazon Connect Data Tables, not a Lambda

The mechanism above was first built as a `lambdas/prompts/` Lambda + in-code data table (`data.ts`)
invoked from each flow. Amazon Connect has its own native Data Tables feature — console-managed
structured rows, queried directly from a flow's Data Table block (Evaluate action) at
`$.DataTables.<QueryName>.<Column>` — which does the same job with no Lambda at all. Switched to
it: `lambdas/prompts/` is deleted; every locale-aware flow now reads
`$.DataTables.<QueryName>.<Column>` straight from a Data Table instead of an `InvokeLambdaFunction`
response. Schema and content for the four tables (`FacilityInfoPrompts`, `AuthenticatePrompts`,
`AuthenticatedMenuPrompts`, `BookingPrompts`) live in `connect-flow-templates/data-tables.md`.

**One real gap, not papered over:** Amazon Connect Data Tables and the Data Table flow block have
no published Flow Language JSON schema (checked against AWS's own Contact actions / Interactions
/ Flow control actions / Participant actions references — the block isn't in any of them). Every
other block in every flow in this repo is fully described in committed, importable JSON; this one
block, in all four locale-aware flows, cannot be. Each flow's `description` field and
`data-tables.md` carry exact by-hand wiring instructions instead. This is a new, narrower kind of
"hand-built, not codified" gap than the existing one (flows themselves are hand-imported but fully
described in JSON) — worth naming explicitly if Open Roadmap Question 3's reconciliation list
grows a line for it.

**Why this is still the right call over the Lambda version:** the whole point of the earlier pivot
was demonstrating that AWS gives Lex V2 native multi-locale support but gives Contact Flows
nothing equivalent — using a hand-rolled Lambda to fill that gap was already the honest
demonstration of "you have to build this yourself." Discovering Connect *does* have a native
mechanism for exactly this (data tables, not locale-aware flows) sharpens the same point rather
than undermining it: Contact Flows still have no native *locale* concept, but they do have a
native *lookup-table* primitive that a hand-built flow can lean on instead of writing a Lambda —
a smaller, more honest "what does this cost to build" number than before.

## Scope expansion (2026-09-08): appointment list/cancel/reschedule made bilingual too

The recorded S-10 scope limitation above — list/cancel/reschedule blocked for `locale=en` because
their target flows were Polish-only — is deliberately reversed. Those three flows
(`keypad-appointment-list-flow.json`, `keypad-appointment-cancel-flow.json`,
`keypad-appointment-reschedule-flow.json`) are now rewritten in place using the same mechanism as
the other four locale-aware flows: a Data Table block per flow (`AppointmentListPrompts`,
`AppointmentCancelPrompts`, `AppointmentReschedulePrompts` in `data-tables.md`), a `checkLocaleForVoice`
TTS switch, and `locale` forwarded to their Lambdas. The `GuardListEn`/`GuardCancelEn`/
`GuardRescheduleEn` `Compare` blocks are removed from both `keypad-facility-info-main-menu-flow.json`
and `keypad-authenticated-menu-flow.json`; their digit dispatch now routes straight to the
`CheckAuthForAppointment*` blocks for every locale.

**Why the Lambdas needed changes too, not just the flows:** `appointment-list`, `appointment-cancel`,
and `appointment-reschedule` each build their own spoken appointment summary
(`${specialty}, ${formatDayLabel(date)}, godzina ${time}`) — Polish day/month names and the literal
word "godzina" baked into the string the flow reads back verbatim, plus the raw Polish specialty
key never translated. `keypad-booking-flow.json`'s Lambda already solved this (`locale` param,
`formatDayLabelEn`, a `specialtyDisplayNamesEn` map) — the same two helpers are now shared from
`@pcm/appointment` (previously private to `lambdas/booking/index.ts`) and reused by all three
newly-bilingual Lambdas instead of duplicating them again.

This changes the S-10 outcome recorded in the roadmap and in `plan-brief.md`/`plan.md` (both still
read "Facility-info + booking only" / list-cancel-reschedule "stay Polish-only") — those documents
are left as the historical record of what was originally planned and built; this note is the
current state. `AuthenticatedMenuPrompts`' and `FacilityInfoPrompts`' `en` rows are updated in
`data-tables.md` to mention the appointment list/cancel/reschedule digits, matching the `pl` rows'
existing parity.
