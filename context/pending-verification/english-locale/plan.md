# English Keypad Locale (Variant A) Implementation Plan

## Overview

Roadmap slice S-10 (FR-009, FR-012), scoped to Variant A only: an English-speaking caller
completes facility-info and booking by keypad, selecting the language with a DTMF prompt at the
start of the call. The speech variant's automatic language detection is a separate, blocked
thread (`lex-language-detection-spike`, F-04) and is explicitly out of scope here.

**Revised twice on 2026-09-06** (see `change.md`'s two revision notes):

1. The original design duplicated every keypad flow into a `-en` sibling file. Rebuilt into a
   shared-flow design — one flow file per menu, locale-driven at runtime — because the duplicated
   design measured how the flows happened to be built rather than anything inherent to a
   DTMF/keypad system.
2. The shared-flow design was first built with a `lambdas/prompts/` Lambda + in-code data table.
   Rebuilt again onto Amazon Connect's own native Data Tables feature — no Lambda at all — since
   it does the same lookup natively. This document describes the final, Data-Table-backed design.

## Current State Analysis

Every existing keypad flow was Polish-only, both in its literal caller-facing prompt text and, for
booking, in the day-label/message text the `Booking` Lambda builds. `@pcm/appointment` (the truly
shared package used by every variant and by the agent-appointment Lambda) hardcodes `pl-PL` in
`formatDayLabel` (`lambdas/appointment/index.ts:58-62`) and must not change — S-10's own roadmap
entry states plainly that the finding evaporates if the shared logic changes.

`facility-info` (`lambdas/facility-info/index.ts`) already returns entirely locale-neutral data
(`name`, `address`, `opensAt`, `closesAt`, `openDays`) — the Polish sentence was built entirely by
the flow's own literal prompt text. Facility info needed zero Lambda changes for English.

Booking is not locale-neutral. `keypad-booking-flow.json` sends `specialty` (e.g. `kardiolog`) and
`timeOfDay` (e.g. `rano`) to `lambdas/booking/index.ts` as Polish literal keys that flow straight
into `@pcm/appointment` — these keys stay exactly as-is for English calls; only their caller-facing
menu captions need translating. But `lambdas/booking/index.ts` itself builds caller-facing text
that cannot be spoken to an English caller unmodified: `day1`/`day2`/`day3` (via `formatDayLabel`,
Polish weekday/month names) and the `confirm` step's `message` field.

Booking is gated behind authentication (`keypad-authenticate-flow.json` →
`keypad-authenticated-menu-flow.json` → `keypad-booking-flow.json`), so English booking needed
English-capable authenticate and authenticated-menu flows too, not just the booking flow itself.

Amazon Connect Contact Flows have no built-in *locale* mechanism — no "flow locale" resource that
gives a flow multiple languages the way an Amazon Lex V2 bot's `BotLocale` does. They do have a
native *lookup-table* primitive (Data Tables) that a hand-built flow can use to avoid duplicating
prompt text per language, without needing a Lambda to hold it. That's the mechanism this plan uses.

### Key Discoveries:

- `lambdas/booking/index.ts` is keypad-only — the speech variant's `BookingIntent` in
  `lambdas/facility-info-speech/index.ts` calls `@pcm/appointment` directly and never invokes this
  Lambda. A `locale` parameter added here cannot affect the speech variant.
- The Polish neural voice `Ola` is set explicitly via `UpdateContactTextToSpeechVoice` in the
  flows that had one; the others inherited the Connect instance's default. Every flow now sets its
  own voice explicitly via a `Compare` on `$.Attributes.locale` (`Ola` for `pl`, `Joanna` for
  `en`), so voice selection no longer depends on which flows happened to have an explicit block.
- `openDays`'s seed value is already the English literal `'monday-friday'`
  (`his/src/migrations/1756500000000-CreateFacility.ts:20`) — a pre-existing quirk (the current
  Polish flow already speaks this English fragment mid-sentence) that happens to need no fix for
  English and is not this plan's concern to correct for Polish.
  **Update 2026-09-11:** fixed outside this plan, reported as a real-call bug — the seed value is
  now the Polish literal `'poniedziałek-piątek'`. This flipped the quirk: Polish became correct,
  English became the gap. **Closed same day**, also outside this plan: `@pcm/facility` gained
  `openDaysEn` (mirroring `specialtyDisplayNamesEn`'s shape); `facility-info` now reads a `locale`
  Lambda parameter and translates when `'en'`; `facility-info-speech`'s `InfoIntent` now reads
  `event.bot.localeId` directly (Lex already tells the Lambda which locale matched — no session
  attribute needed) and builds the whole English sentence, not just this one field. **Still open:**
  `keypad-facility-info-main-menu-flow.json`'s `InvokeFacilityInfo` block passes no parameters at
  all to the Lambda — add `"locale": "$.Attributes.locale"` to its `LambdaInvocationAttributes`, or
  the keypad English variant keeps hearing Polish `openDays` regardless of the Lambda fix.
- **Amazon Connect Data Tables and the Data Table flow block have no published Flow Language JSON
  schema** (checked against AWS's Contact actions / Interactions / Flow control actions /
  Participant actions references — it's in none of them). Every other block in this repo's flow
  JSON is fully described and importable; this one block, in every locale-aware flow, cannot be —
  it must be added by hand in the console designer after import, per that flow's own `description`
  field and `connect-flow-templates/data-tables.md`.
- A Data Table Evaluate query's result (`$.DataTables.<QueryName>.<Column>`) is scoped to the flow
  that ran the query — it does not survive a `TransferToFlow` into a different flow. Every
  locale-aware flow therefore runs its own query near its start, exactly mirroring the earlier
  Lambda design's per-flow invoke.
- `$.External.*` (a Lambda invoke's response) is only valid until the *next* Lambda invoke on the
  same contact; contact attributes (`$.Attributes.*`) persist for the rest of the call. This is
  why every flow copies its Data Table query's result into same-named `$.Attributes.*` immediately
  (`copyPrompts`), and why messages that must weave in a *later* Lambda's live output (booking's
  day/time/confirm messages) compose a persisted prompt fragment with the fresh `$.External.*`
  value in the same `UpdateContactAttributes` block that follows that later invoke.
- `#` (return to main menu) and every flow-transfer `ContactFlowId` already resolve to a single,
  locale-neutral ARN per target flow — there is no English sibling ARN to keep in sync.

## Desired End State

A caller dials in, hears a short bilingual prompt, and presses 1 for Polish (unchanged behavior)
or 2 for English. Either way, the caller reaches the *same* main-menu flow, which speaks in the
chosen language because `$.Attributes.locale` drives a Data Table lookup for its prompts and a
`Compare` for its TTS voice. An English caller can hear the facility's address and hours, and —
after an all-English PESEL/phone identity capture on the caller-ID shortcut path — can book an
appointment by specialty and time of day through an all-English multi-step menu, ending on an
English confirmation. The underlying booking data and business rules are identical to the Polish
path; only prompt language differs.

**Verification:** place a real call, select English, complete a facility-info lookup and a full
booking (including a no-availability retry and a declined confirmation), and confirm the booked
slot against the mock's data the same way S-05's own manual verification already does. Then place
a second call, select Polish, and confirm the existing Polish flows still behave identically
(regression check — same files, now locale-branched, must produce byte-identical Polish output).

## What We're NOT Doing

- No changes to `@pcm/appointment`, `lambdas/facility-info`, `lambdas/authenticate`,
  `lambdas/appointment-list`, `lambdas/appointment-cancel`, `lambdas/appointment-reschedule`, or
  `lambdas/agent-appointment` — this plan's only Lambda change is `lambdas/booking/index.ts`
  (Phase 1). There is no Prompts Lambda — that mechanism is a Data Table, not code.
- No English appointment-list, cancel, or reschedule — the roadmap's own S-10 outcome names only
  "the facility-information and booking tasks." An authenticated English caller who wants to
  list/cancel/reschedule is blocked at the menu (a `Compare` guard on `$.Attributes.locale`, not a
  missing menu option) and falls into the same invalid-input retry path as any other unmapped
  digit. Their target flows have no English prompts; this is a recorded scope limitation, not an
  oversight, and a natural next slice if picked up later.
- No English OTP flow or OTP module. `keypad-otp-verify-module.json` and the SMS/demo-code texts
  in `keypad-authenticate-flow.json` stay Polish. An English caller who fails the caller-ID
  shortcut (unrecognized number) falls into the existing Polish OTP challenge — a residual UX gap,
  recorded here, not fixed by this plan.
- No translation of `transferReason` attribute values — this text is agent-facing only (shown on
  the agent's own screen-pop, never spoken to the caller) and the agent is Polish-speaking per the
  project's baseline; every transfer-trigger point keeps the same Polish `transferReason` literal
  regardless of caller locale.
- No repointing of the Connect number's entry contact flow inside this plan's automated work — it
  is a manual console step (Phase 5) requiring the user's own AWS access, consistent with the
  project's standing "user runs deploys/console changes themselves" practice.
- No changes to the speech variant (Variant B) in any respect — English support there is blocked
  on `lex-language-detection-spike` (F-04) reaching a verdict and is explicitly a separate roadmap
  item.
- No per-locale flow files, and no Lambda in the text-lookup path. Every keypad flow menu is one
  file, locale-branched at runtime via a Data Table — see Implementation Approach.

## Implementation Approach

A new top-of-call flow (`keypad-language-select-flow.json`) becomes the number's entry point,
gated on a single DTMF digit, and sets `$.Attributes.locale` (`"pl"` or `"en"`) before
transferring into the single, shared main-menu flow — it does not branch to different flow trees.

Four Amazon Connect Data Tables (`FacilityInfoPrompts`, `AuthenticatePrompts`,
`AuthenticatedMenuPrompts`, `BookingPrompts` — schema and content in
`connect-flow-templates/data-tables.md`) hold every caller-facing string that varies by locale, one
row per locale (`pl`/`en`) with `locale` as the sole Primary Attribute and one column per prompt
key. Each locale-aware flow runs one Data Table Evaluate query near its start (Primary Attribute
`locale` = `$.Attributes.locale`, Query Attributes = every column for that table), then copies the
result into persisted contact attributes (`copyPrompts`). Every place that used to hardcode Polish
literal text now references `$.Attributes.<key>` instead. A `Compare` on `$.Attributes.locale`
right after `copyPrompts` picks the TTS voice (`Ola` / `Joanna`).

**The Data Table block itself cannot be committed as importable JSON** — see Key Discoveries. Each
locale-aware flow's JSON therefore starts at `copyPrompts` (a placeholder `StartAction`) with an
explicit instruction in its `description` field: add the Data Table block by hand, then repoint
`StartAction` at it and its success transition at `copyPrompts`.

Messages that must combine a live Lambda response with locale text (the booking flow's
day-choice, time-choice, and confirmation messages) compose the already-persisted prompt
fragment(s) with the fresh `$.External.*` value(s) in the same `UpdateContactAttributes` block
that immediately follows that Lambda invoke — see Key Discoveries above for why this ordering
matters.

`lambdas/booking/index.ts` (Phase 1, unaffected by either pivot) still gains a `locale` parameter,
defaulting to `'pl'`, that branches only presentation formatting already local to this Lambda
(day-label text, specialty display name, the `message` template), never touching
`@pcm/appointment`. Every `InvokeExternalResource` call to `Booking` forwards
`"locale": "$.Attributes.locale"` in its `LambdaInvocationAttributes`.

List/cancel/reschedule stay unavailable to English callers: `keypad-facility-info-main-menu-flow.json`
(digits 3/4/5) and `keypad-authenticated-menu-flow.json` (digits 2/3/4) each route the matching
digit through a small `Compare` guard on `$.Attributes.locale` before transferring — `en` treats
the digit as invalid input (same retry path as an unmapped digit), anything else proceeds as
before. This is a two-branch guard per digit, not a duplicated flow.

## Critical Implementation Details

- **The Data Table block has no importable JSON form — this is a real, narrower gap than this
  project's usual "hand-built but fully described in JSON" flow convention.** Every other action
  in every flow in this repo round-trips through committed JSON; this one action, in all four
  locale-aware flows, must be added by hand in the console designer every time the flow is
  re-imported from scratch. `connect-flow-templates/data-tables.md` and each flow's `description`
  field are the durable, git-versioned instructions for doing that correctly.
- **Query Name / column-name typos fail silently.** There is no compiler checking that a flow's
  Data Table block query is actually named `BookingPrompts` (matching what `copyPrompts`
  references as `$.DataTables.BookingPrompts.*`) or that its Query Attributes list matches the
  table's actual columns. An unmatched reference resolves to empty text, per AWS's documented
  Evaluate-action behavior — not an error.
- **The `$.External.*` freshness window.** A Lambda invoke's response is only addressable as
  `$.External.*` until the *next* Lambda invoke on the same contact overwrites it. The three
  composite booking messages (`setDaysMsg`, `setTimesMsg`, `setConfirmMsg`) run immediately after
  `invokeDays`/`invokeTimes`/`invokeConfirm` respectively and reference *both*
  `$.Attributes.<promptFragment>` (persisted, from the earlier Data Table query) and
  `$.External.<liveValue>` (fresh, from the invoke that just ran) in one string — this is the same
  "compose in the same breath as the invoke" idiom the original Polish flow already used for its
  hardcoded literal text; only the fragments are now table-driven instead of hardcoded.
- **TTS voice per flow.** Every locale-aware flow has a `Compare` on `$.Attributes.locale` right
  after `copyPrompts`, transitioning to `setVoiceEn` (`Joanna`, Neural) on an `"en"` match and
  `setVoicePl` (`Ola`, Neural) on anything else (`NoMatchingCondition` and `NoMatchingError` both
  route to `setVoicePl`, so a missing/unexpected locale value defaults to Polish, matching every
  other locale-read default in this plan).
- **Specialty and time-of-day display-name table**, used only inside `lambdas/booking/index.ts`'s
  English branch (the wire values sent by the flow stay the Polish keys below — only the Lambda's
  own text output changes):

  | Wire value | Polish menu caption | English display name |
  | --- | --- | --- |
  | `kardiolog` | kardiolog | Cardiology |
  | `dermatolog` | dermatolog | Dermatology |
  | `okulista` | okulista | Ophthalmology |
  | `laryngolog` | laryngolog | ENT |
  | `neurolog` | neurolog | Neurology |
  | `ortopeda` | ortopeda | Orthopedics |
  | `internista` | internista | Internal Medicine |
  | `ginekolog` | ginekolog | Gynecology |
  | `pediatra` | pediatra | Pediatrics |
  | `endokrynolog` | endokrynolog | Endocrinology |
  | `chirurg` | chirurg | Surgery |
  | `urolog` | urolog | Urology |
  | `psychiatra` | psychiatra | Psychiatry |
  | `alergolog` | alergolog | Allergology |
  | `reumatolog` | reumatolog | Rheumatology |
  | `rano` | rano | Morning |
  | `przed południem` | przed południem | Late morning |
  | `po południu` | po południu | Afternoon |
  | `wieczorem` | wieczorem | Evening |

## Phase 1: Locale branch in the booking Lambda

### Overview

`lambdas/booking/index.ts` gains a `locale` parameter, defaulting to `'pl'`, that branches its own
day-label formatting, specialty display name, and confirmation-message template.

### Changes Required:

#### 1. Locale-aware presentation layer

**File**: `lambdas/booking/index.ts` — done, unaffected by either architecture pivot.

**Contract**: `Details.Parameters.locale` (`'pl' | 'en'`, default `'pl'`). No change to any other
output field name, to the `times`/`book` steps' outputs, or to any `@pcm/appointment` call
signature.

#### 2. Unit tests

**File**: `lambdas/booking/index.test.ts` — done.

### Success Criteria:

#### Automated Verification:

- [x] Unit tests pass: `npm test` in `lambdas/booking`
- [x] Type checking passes
- [x] Full test suite passes: repo-wide test command

## Phase 2: Data Tables (schema + content)

### Overview

The mechanism every later phase depends on: four Amazon Connect Data Tables holding every
caller-facing string that varies by locale. No Lambda, no CDK — hand-built, like the flows
themselves.

### Changes Required:

#### 1. Data table schema and content

**File**: `connect-flow-templates/data-tables.md` (new)

**Intent**: For each of `FacilityInfoPrompts`, `AuthenticatePrompts`, `AuthenticatedMenuPrompts`,
`BookingPrompts`: the full column list and the exact `pl`/`en` row content, ready to hand-enter in
**Routing → Data tables → Create data table**, `locale` marked as the sole Primary Attribute.
Composite messages (address answer, booking's day/time/confirm lines) are split into
prefix/fragment/suffix columns so a flow can weave in a live Lambda value between them (see
Critical Implementation Details).

**Contract**: No importable format — this file is a build-by-hand instruction sheet, the same
role `data-tables.md`'s sibling flow JSON files play for flows, minus the JSON.

### Success Criteria:

#### Automated Verification:

- None — no code, no schema to type-check.

#### Manual Verification:

- [ ] All four tables created and published in the console with every column and both locale rows
      from `data-tables.md`

## Phase 3: Language-select entry flow + locale-aware facility-info menu

### Overview

The entry point plus the simplest locale-aware flow — facility-info needs no Lambda locale
awareness beyond its own Data Table lookup.

### Changes Required:

#### 1. Language-select flow

**File**: `connect-flow-templates/flows/keypad-language-select-flow.json`

**Intent**: Unchanged bilingual `GetParticipantInput` prompt; `1`/`2` now set
`$.Attributes.locale` to `"pl"`/`"en"` (`setLocalePl`/`setLocaleEn`) before both branches transfer
to the same `keypad-facility-info-main-menu-flow.json` ARN — no more separate English target.

#### 2. Facility-info main menu flow

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`

**Intent**: Rewritten in place (no new file). `copyPrompts` is the file's placeholder
`StartAction` — a Data Table block (table `FacilityInfoPrompts`) must be added by hand in front of
it per the flow's `description` field, then `checkLocaleForVoice` → `setVoiceEn`/`setVoicePl`
follow as before. Every literal `Text`/`lastMessageText` now references a `$.Attributes.<key>`
prompt; the address answer composes `addrPrefix`/`addrFrag2`/`addrFrag3`/`addrFrag4`/`addrSuffix`
fragments around `InvokeFacilityInfo`'s live `$.External.address`/`opensAt`/`closesAt`/`openDays`.
Digits 3/4/5 (list/cancel/reschedule) each route through a
`GuardListEn`/`GuardCancelEn`/`GuardRescheduleEn` `Compare` on `$.Attributes.locale` before their
existing auth-check transfer, treating `en` as invalid input. `transferReason` literals are
untouched (What We're NOT Doing).

### Success Criteria:

#### Automated Verification:

- None — hand-built console artifacts, no automated check.

#### Manual Verification:

- [ ] The `FacilityInfoPrompts` Data Table block is added and wired per the flow's description
- [ ] Both flows import into the Connect console without validation errors
- [ ] Calling the test number, selecting `1`, reaches the main menu in Polish exactly as before
      (regression check)
- [ ] Selecting `2` reaches the same main menu in English; pressing `1` plays the facility's
      address and hours in English, using the same underlying data as the Polish path
- [ ] Pressing `3`, `4`, or `5` after selecting English is treated as invalid input, not a working
      menu option

## Phase 4: Locale-aware authenticate + authenticated-menu flows

### Overview

Makes the caller-ID-shortcut identity path locale-aware, stopping at the boundary this plan draws
around OTP (Polish, unchanged).

### Changes Required:

#### 1. Authenticate flow

**File**: `connect-flow-templates/flows/keypad-authenticate-flow.json`

**Intent**: Rewritten in place. `copyPrompts` is the placeholder `StartAction`; a Data Table block
(table `AuthenticatePrompts`) goes in front of it per the flow's description. PESEL/phone prompts,
the confirm-your-details read-back (`confirmPrefix` + `$.Attributes.pesel` + `confirmMiddle` +
`$.Attributes.phone` + `confirmSuffix` — all persisted attributes, safe to combine anywhere,
unlike the `$.External.*` case), the "identity confirmed" line, and the give-up-on-auth message
all become `$.Attributes.<key>` references. The `storeOtpChallenge`/OTP branch is untouched and
stays Polish (What We're NOT Doing) — the shared `confirmMsg` block it also transitions into now
plays the locale-driven `identityConfirmed` text regardless of which path reached it, matching the
original design's own behavior (the OTP branch was already documented as an English caller's
residual Polish experience before either pivot).

#### 2. Authenticated-menu flow

**File**: `connect-flow-templates/flows/keypad-authenticated-menu-flow.json`

**Intent**: Rewritten in place. Same pattern — a Data Table block (table
`AuthenticatedMenuPrompts`) in front of the placeholder `StartAction`. Digits 2/3/4
(list/cancel/reschedule) each route through a
`GuardListEn`/`GuardCancelEn`/`GuardRescheduleEn` `Compare`, mirroring Phase 3's
facility-info-menu treatment.

### Success Criteria:

#### Automated Verification:

- None — hand-built console artifacts.

#### Manual Verification:

- [ ] The `AuthenticatePrompts` and `AuthenticatedMenuPrompts` Data Table blocks are added and
      wired per each flow's description
- [ ] Both flows import into the Connect console without validation errors
- [ ] On the English path, entering a PESEL/phone pair matching a seeded patient's
      caller-ID-shortcut record reaches the authenticated menu and hears the English confirmation
      line
- [ ] Pressing `#` from the authenticated menu returns to the main menu in the same language
- [ ] Pressing `2`, `3`, or `4` after selecting English is treated as invalid input

## Phase 5: Locale-aware booking flow

### Overview

The heaviest phase — the full specialty/time-of-day/day/time/confirm sequence, now table-driven
and wired to Phase 1's locale-aware Lambda.

### Changes Required:

#### 1. Booking flow

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Rewritten in place. Same pattern — a Data Table block (table `BookingPrompts`, 18
Query Attributes) in front of the placeholder `StartAction`. Both specialty menu pages, the
time-of-day menu, and the give-up/no-availability/error/success/fail messages become
`$.Attributes.<key>` references. `setDaysMsg`, `setTimesMsg`, and `setConfirmMsg` compose
persisted prompt fragments with the immediately-preceding invoke's `$.External.*` output (Critical
Implementation Details). Every `InvokeExternalResource` call to the `Booking` Lambda (`invokeDays`,
`invokeTimes`, `invokeConfirm`, `invokeBook`) forwards `"locale": "$.Attributes.locale"` in its
`LambdaInvocationAttributes`, alongside the existing `specialty`/`timeOfDay`/`dayChoice`/
`timeChoice`/`authenticated`/`patientId` parameters.

### Success Criteria:

#### Automated Verification:

- None new — hand-built console artifact; Phase 1 already covers the Lambda side this flow calls
  into, Phase 2 covers the data.

#### Manual Verification:

- [ ] The `BookingPrompts` Data Table block is added and wired per the flow's description
- [ ] The flow imports into the Connect console without validation errors
- [ ] A full English booking (specialty → time-of-day → day → time → confirm → success) reads back
      every dynamic value in English and books the correct slot, verified against the mock's data
      the same way S-05's own manual verification already checks it
- [ ] A no-availability outcome and a declined confirmation both replay in English and behave
      identically in structure to the Polish path (same retry/give-up counters)
- [ ] A full Polish booking still behaves identically to before this plan (regression check)

## Phase 6: Contract documentation + end-to-end verification

### Overview

Registers the new contract surfaces, then runs the full manual matrix across both languages on a
real call.

### Changes Required:

#### 1. Contract surfaces registration

**File**: `docs/reference/contract-surfaces.md` — done. `$.Attributes.locale` and
`$.DataTables.<QueryName>.<Column>` entries added, replacing the original
`Details.Parameters.locale (S-10)` entry (duplicated-flow design) and the later Prompts-Lambda
entry (superseded by this Data Table version).

#### 2. Naming convention documentation

**File**: `connect-flow-templates/README.md` — done. The `-en` suffix convention bullet is
replaced with a note that locale is not a filename axis, a `data-tables.md` layout entry is added,
and the Naming section notes the Data Table block's hand-wiring requirement.

### Success Criteria:

#### Automated Verification:

- None new — covered by Phases 1 and 2.

#### Manual Verification:

- [ ] **Language selection**: calling the (repointed) test number plays the bilingual prompt; `1`
      and `2` both reach the same main menu, speaking the chosen language
- [ ] **English facility-info**: address and hours heard correctly in English
- [ ] **English booking, full matrix**: happy path; a no-availability day/time outcome re-offered
      from a fresh search; a declined confirmation returning to the day picker with
      specialty/time-of-day retained; three failed PESEL/phone attempts transferring to the agent
      queue
- [ ] **Polish regression**: the same four flows, unselected (locale=`pl`), behave identically to
      before this plan, end to end
- [ ] **Entry point repointed**: the claimed test number's entry contact flow is
      `keypad-language-select-flow.json`, done manually in the console (this plan does not
      automate console configuration)

## Testing Strategy

### Unit Tests:

- `lambdas/booking/index.test.ts`: English-locale cases for `days` and `confirm` steps, plus a
  no-`locale`-supplied case asserting unchanged Polish output (Phase 1). No other unit tests apply
  — the Data Table mechanism (Phase 2) is not code.

### Integration Tests:

- None beyond the existing HIS/mock test suite — no HIS or `@pcm/appointment` change in this plan.

### Manual Testing Steps:

1. Create the four Data Tables from `connect-flow-templates/data-tables.md`.
2. Import the five flow files (the four rewritten flows plus `keypad-language-select-flow.json`)
   via `fill-arns.mjs` per `connect-flow-templates/README.md`, then hand-add each locale-aware
   flow's Data Table block per its `description` field.
3. Repoint the claimed number's entry contact flow to `keypad-language-select-flow.json`.
4. Run Phase 6's full manual matrix, both languages.

## Performance Considerations

One additional Data Table Evaluate query per locale-aware flow, beyond the existing per-Lambda
timeouts each flow already has. No Lambda cold start or invocation cost in the text-lookup path at
all — likely faster than the earlier Lambda-backed version, though this hasn't been measured.

## Migration Notes

None — no schema, entity, or endpoint change. `$.Attributes.locale` and the four Data Tables are
additive; a flow that somehow never sets `locale` (a bug elsewhere, not an expected path) defaults
every read to `'pl'`, matching today's Polish-only behavior.

## References

- Roadmap S-10 entry and Open Roadmap Question 2: `context/foundation/roadmap.md`
- Prior planning-discussion notes and both architecture-pivot rationales:
  `context/pending-verification/english-locale/change.md`
- Blocked speech-variant thread: `context/changes/lex-language-detection-spike/change.md`
- Locale-aware flows: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`,
  `keypad-authenticate-flow.json`, `keypad-authenticated-menu-flow.json`,
  `keypad-booking-flow.json`, `keypad-language-select-flow.json`
- Data Tables schema and content: `connect-flow-templates/data-tables.md`
- Shared logic (untouched): `lambdas/appointment/index.ts` (`@pcm/appointment`)
- Lambda changed: `lambdas/booking/index.ts`
- Naming/import conventions: `connect-flow-templates/README.md`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Locale branch in the booking Lambda

#### Automated

- [x] 1.1 Unit tests pass: `npm test` in `lambdas/booking` — f1a1028
- [x] 1.2 Type checking passes — f1a1028
- [x] 1.3 Full test suite passes: repo-wide test command — f1a1028

### Phase 2: Data Tables (schema + content)

#### Automated

- [x] 2.1 `data-tables.md` written with all four tables' schema and content

#### Manual

- [ ] 2.2 All four tables created and published in the console

### Phase 3: Language-select entry flow + locale-aware facility-info menu

#### Manual

- [ ] 3.1 `FacilityInfoPrompts` Data Table block added and wired
- [ ] 3.2 Both flows import into the Connect console without validation errors
- [ ] 3.3 Selecting `1` reaches the main menu in Polish (regression check)
- [ ] 3.4 Selecting `2` reaches the same main menu in English
- [ ] 3.5 Digits `3`/`4`/`5` are invalid input on the English path

### Phase 4: Locale-aware authenticate + authenticated-menu flows

#### Manual

- [ ] 4.1 `AuthenticatePrompts` and `AuthenticatedMenuPrompts` Data Table blocks added and wired
- [ ] 4.2 Both flows import into the Connect console without validation errors
- [ ] 4.3 Caller-ID-shortcut authentication succeeds in English, reaching the authenticated menu
      in English
- [ ] 4.4 `#` from the authenticated menu returns to the main menu in the same language
- [ ] 4.5 Digits `2`/`3`/`4` are invalid input on the English path

### Phase 5: Locale-aware booking flow

#### Manual

- [ ] 5.1 `BookingPrompts` Data Table block added and wired
- [ ] 5.2 Flow imports into the Connect console without validation errors
- [ ] 5.3 Full English booking completes and books the correct slot, verified against mock data
- [ ] 5.4 No-availability and declined-confirmation outcomes behave correctly in English
- [ ] 5.5 Full Polish booking regression-verified, unchanged

### Phase 6: Contract documentation + end-to-end verification

#### Manual

- [ ] 6.1 Language selection routes correctly to Polish (`1`) and English (`2`)
- [ ] 6.2 English facility-info verified
- [ ] 6.3 English booking full matrix verified (happy path, no-availability, declined confirm,
      three-failed-attempts transfer)
- [ ] 6.4 Polish path regression-verified end to end, unchanged
- [ ] 6.5 Claimed number's entry contact flow repointed to `keypad-language-select-flow.json`
