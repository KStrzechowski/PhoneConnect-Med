# English Keypad Locale (Variant A) Implementation Plan

## Overview

Roadmap slice S-10 (FR-009, FR-012), scoped to Variant A only: an English-speaking caller
completes facility-info and booking by keypad, selecting the language with a DTMF prompt at the
start of the call. The speech variant's automatic language detection is a separate, blocked
thread (`lex-language-detection-spike`, F-04) and is explicitly out of scope here.

## Current State Analysis

Every existing keypad flow is Polish-only, both in its literal caller-facing prompt text and, for
booking, in the day-label/message text the `Booking` Lambda builds. `@pcm/appointment` (the truly
shared package used by every variant and by the agent-appointment Lambda) hardcodes `pl-PL` in
`formatDayLabel` (`lambdas/appointment/index.ts:58-62`) and must not change — S-10's own roadmap
entry states plainly that the finding evaporates if the shared logic changes.

`facility-info` (`lambdas/facility-info/index.ts`) already returns entirely locale-neutral data
(`name`, `address`, `opensAt`, `closesAt`, `openDays`) — the Polish sentence is built entirely by
`keypad-facility-info-main-menu-flow.json`'s own literal prompt text (`"Nasz adres to
$.External.address..."`). Facility info needs zero Lambda changes for English.

Booking is not locale-neutral. `keypad-booking-flow.json` sends `specialty` (e.g. `kardiolog`) and
`timeOfDay` (e.g. `rano`) to `lambdas/booking/index.ts` as Polish literal keys that flow straight
into `@pcm/appointment` — these keys can stay exactly as-is for English calls; only their
caller-facing menu captions need translating. But `lambdas/booking/index.ts` itself builds
caller-facing text that cannot be spoken to an English caller unmodified: `day1`/`day2`/`day3`
(via `formatDayLabel`, Polish weekday/month names) and the `confirm` step's `message` field
(`` `Umawiam wizytę: ${specialty}, ${formatDayLabel(date)}, godzina ${time}.` ``, with `specialty`
still the Polish word).

Booking is gated behind authentication (`keypad-authenticate-flow.json` →
`keypad-authenticated-menu-flow.json` → `keypad-booking-flow.json`), so an English booking path
needs English duplicates of the authenticate and authenticated-menu flows too, not just the
booking flow itself.

### Key Discoveries:

- `lambdas/booking/index.ts` is keypad-only — the speech variant's `BookingIntent` in
  `lambdas/facility-info-speech/index.ts` calls `@pcm/appointment` directly and never invokes this
  Lambda. A `locale` parameter added here cannot affect the speech variant.
- The Polish neural voice `Ola` is set explicitly via `UpdateContactTextToSpeechVoice`
  (`keypad-booking-flow.json:92`, `keypad-authenticated-menu-flow.json:25`) — every English flow
  needs its own `UpdateContactTextToSpeechVoice` block with an English neural voice, or English
  text gets read aloud by a Polish voice.
- `openDays`'s seed value is already the English literal `'monday-friday'`
  (`his/src/migrations/1756500000000-CreateFacility.ts:20`) — a pre-existing quirk (the current
  Polish flow already speaks this English fragment mid-sentence) that happens to need no fix for
  English and is not this plan's concern to correct for Polish.
- `#` (return to main menu) and every flow-transfer `ContactFlowId` inside an English flow must
  point at the English sibling of the Polish target, never the Polish flow — see Critical
  Implementation Details.
- No naming convention exists yet for a locale variant of a flow file;
  `connect-flow-templates/README.md`'s convention covers only the `keypad`/`speech` variant axis.

## Desired End State

A caller dials in, hears a short bilingual prompt, and presses 1 for Polish (unchanged behavior)
or 2 for English. An English caller reaches an all-English main menu, can hear the facility's
address and hours, and — after an all-English PESEL/phone identity capture on the caller-ID
shortcut path — can book an appointment by specialty and time of day through an all-English
multi-step menu, ending on an English confirmation. The underlying booking data and business
rules are identical to the Polish path; only prompt language differs.

**Verification:** place a real call, select English, complete a facility-info lookup and a full
booking (including a no-availability retry and a declined confirmation), and confirm the booked
slot against the mock's data the same way S-05's own manual verification already does. Then place
a second call, select Polish, and confirm the existing Polish flows are byte-identical in
behavior (regression check on the untouched files).

### Key Discoveries:

(see Current State Analysis above — kept there since they're grounded in specific files rather
than being forward-looking specs)

## What We're NOT Doing

- No changes to `@pcm/appointment`, `lambdas/facility-info`, `lambdas/authenticate`,
  `lambdas/appointment-list`, `lambdas/appointment-cancel`, `lambdas/appointment-reschedule`, or
  `lambdas/agent-appointment` — this plan's only Lambda change is `lambdas/booking/index.ts`.
- No English appointment-list, cancel, or reschedule flows — the roadmap's own S-10 outcome names
  only "the facility-information and booking tasks." An authenticated English caller who wants to
  list/cancel/reschedule has no English path yet; this is a recorded scope limitation, not an
  oversight, and a natural next slice if picked up later.
- No English OTP flow or OTP module. `keypad-otp-verify-module.json` and the SMS/demo-code texts
  in `keypad-authenticate-flow.json` stay Polish. An English caller who fails the caller-ID
  shortcut (unrecognized number) falls into the existing Polish OTP challenge — a residual UX gap,
  recorded here, not fixed by this plan.
- No translation of `transferReason` attribute values — this text is agent-facing only (shown on
  the agent's own screen-pop, never spoken to the caller) and the agent is Polish-speaking per the
  project's baseline; every English flow's transfer-trigger points reuse the exact same Polish
  `transferReason` literals the Polish flows already use.
- No repointing of the Connect number's entry contact flow inside this plan's automated work — it
  is a manual console step (Phase 5) requiring the user's own AWS access, consistent with the
  project's standing "user runs deploys/console changes themselves" practice.
- No changes to the speech variant (Variant B) in any respect — English support there is blocked
  on `lex-language-detection-spike` (F-04) reaching a verdict and is explicitly a separate roadmap
  item.

## Implementation Approach

A new top-of-call flow (`keypad-language-select-flow.json`) becomes the number's entry point,
gated on a single DTMF digit, and transfers into either the existing (unmodified) Polish main menu
or a new, fully English sibling tree: main menu → authenticate → authenticated menu → booking.
Every English flow is a structural duplicate of its Polish counterpart — same block graph, same
attribute names, same digit-to-value mappings for `specialty`/`timeOfDay` — with only literal
`Text`/`lastMessageText` strings translated and TTS voice switched to an English neural voice.
`lambdas/booking/index.ts` gains a `locale` parameter (default `'pl'`, so the Polish flow's
existing `Details.Parameters` payload — which never sends `locale` — produces byte-identical
output to today) that branches only presentation formatting already local to this Lambda
(day-label text, specialty display name, the `message` template), never touching
`@pcm/appointment`.

## Critical Implementation Details

- **Locale-scoped transfer targets.** Every `TransferToFlow`/`#`-digit target inside an English
  flow must resolve to that flow's English sibling, not the Polish original — e.g. English
  `keypad-authenticate-flow-en.json`'s post-auth transfer goes to
  `REPLACE_WITH_AUTHENTICATED_MENU_FLOW_EN_ARN`, and English `keypad-booking-flow-en.json`'s `#`
  digit goes to `REPLACE_WITH_MAIN_MENU_FLOW_EN_ARN`. A flow that accidentally points back at a
  Polish sibling would silently strand an English caller back in a Polish menu mid-call.
- **TTS voice per flow.** Every English flow needs its own `UpdateContactTextToSpeechVoice` action
  near its start (mirroring `voice` in `keypad-booking-flow.json`/`keypad-authenticated-menu-flow.json`)
  set to an English neural voice (e.g. `Joanna` or `Matthew`) — copy the block, change only
  `TextToSpeechVoice`. `keypad-facility-info-main-menu-flow.json` and `keypad-authenticate-flow.json`
  have no explicit voice block today (they inherit the Connect instance's default), so their
  English siblings need one added, not merely changed.
- **Specialty and time-of-day display-name table**, used only inside `lambdas/booking/index.ts`'s
  new English branch (the wire values sent by the flow stay the Polish keys below — only the
  Lambda's own text output changes):

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

- **New file-naming convention for locale variants.** No existing convention covers this axis.
  Adopt `<polish-filename-without-extension>-en.json` (e.g. `keypad-booking-flow-en.json`) —
  append `-en`, don't invent a new prefix — so every English file sits alphabetically next to its
  Polish sibling and the existing `<variant>-<name>-<flow|module>` prefix rule is undisturbed.
  Recorded as a new bullet in `connect-flow-templates/README.md` in Phase 5.

## Phase 1: Locale branch in the booking Lambda

### Overview

`lambdas/booking/index.ts` gains a `locale` parameter, defaulting to `'pl'`, that branches its own
day-label formatting, specialty display name, and confirmation-message template — the only Lambda
change this plan makes.

### Changes Required:

#### 1. Locale-aware presentation layer

**File**: `lambdas/booking/index.ts`

**Intent**: Read `locale` from `event.Details.Parameters` (default `'pl'`). Add a small
English-only day-label formatter (mirrors `formatDayLabel`'s shape but with `'en-US'` passed to
`Intl.DateTimeFormat` instead of `'pl-PL'` — a duplicate, not a shared import, per this plan's
"don't touch `@pcm/appointment`" constraint) and the specialty display-name table from Critical
Implementation Details. When `locale === 'en'`, `day1`/`day2`/`day3` (the `days` step) and the
`message` template (the `confirm` step) use the English formatter/table/template
(`` `Booking: ${specialtyDisplayName}, ${dayLabel}, at ${time}.` ``); every other locale value
(including absent) preserves today's exact Polish output byte-for-byte.

**Contract**: New optional `Details.Parameters.locale` (`'pl' | 'en'`, default `'pl'`). No change
to any other output field name, to the `times`/`book` steps' outputs, or to any `@pcm/appointment`
call signature.

#### 2. Unit tests

**File**: `lambdas/booking/index.test.ts`

**Intent**: Add English-locale cases alongside the existing Polish ones for the `days` and
`confirm` steps (English day label, English specialty name, English message template), and one
case confirming that omitting `locale` entirely still produces today's exact Polish output.

**Contract**: Extend the existing `node --test` file; no new test file.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test` in `lambdas/booking`
- Type checking passes: `npx tsc --noEmit` (or the repo's existing typecheck script) covers the
  updated file
- Full test suite passes: repo-wide test command

#### Manual Verification:

- None — pure Lambda logic, fully covered by the automated tests above; Phase 4's manual
  verification is where this is exercised end-to-end over a real call

---

## Phase 2: Language-select entry flow + English facility-info

### Overview

The new entry point and the simplest of the four English flows — facility-info needs no Lambda
locale awareness at all, so this phase proves the duplication pattern before the harder
authenticate/booking phases.

### Changes Required:

#### 1. Language-select flow

**File**: `connect-flow-templates/flows/keypad-language-select-flow.json` (new)

**Intent**: A short, single-turn `GetParticipantInput` playing a bilingual prompt ("Naciśnij
jeden, aby kontynuować po polsku. Press two to continue in English.") with `1` transferring to
`keypad-facility-info-main-menu-flow.json` (unmodified) and `2` transferring to
`keypad-facility-info-main-menu-flow-en.json` (Phase 2's other new file). No-input/invalid-input
retries transfer to the agent queue after 3 attempts (L-05), mirroring
`keypad-facility-info-main-menu-flow.json`'s own `MainMenu`/`IncrementFailedAttempts` pattern.
`0` and `*` are meaningless before a language is chosen (nothing has been said yet to repeat, and
transfer-to-agent needs a `transferReason` in a language the agent already reads regardless) — so
this block intentionally does not wire the two reserved global digits, the one flow in the system
exempted from L-05's "every menu wires 0/repeat" rule because no prior message exists to repeat
and the call hasn't reached any caller-selected task yet.

**Contract**: New standalone Contact Flow, `keypad-` prefixed per the naming convention (it is a
DTMF flow, not tied to either locale). This flow becomes the Connect number's new entry point
(Phase 5, manual).

#### 2. English facility-info main menu flow

**File**: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow-en.json` (new)

**Intent**: Structural duplicate of `keypad-facility-info-main-menu-flow.json` — same block graph,
same `InvokeFacilityInfo` call (unmodified `FacilityInfo` Lambda, still `variant: keypad`) — with
every literal `Text`/`Attributes.lastMessageText` string translated to English and an added
`UpdateContactTextToSpeechVoice` block (English neural voice). Menu digits `3`/`4`/`5`
(list/cancel/reschedule) are omitted from the prompt text and the menu's `Conditions` entirely
(out of scope per What We're NOT Doing) — an English caller pressing one of those digits falls
through to the same invalid-input retry path as any other unmapped digit. Digit `2` (book) keeps
its `CheckAuthForBooking` branch, transferring to `keypad-authenticate-flow-en.json` (Phase 3) or
`keypad-booking-flow-en.json` (Phase 4) depending on `$.Attributes.authenticated` — both are later
phases' output, so this file's two corresponding `ContactFlowId` placeholders stay
`REPLACE_WITH_*_EN_ARN` until Phase 5's fill-arns pass.

**Contract**: New standalone Contact Flow, filename per the new `-en` suffix convention (Critical
Implementation Details).

### Success Criteria:

#### Automated Verification:

- None — hand-built console artifacts, no automated check (same acknowledgment every prior
  slice's flow-authoring phase carries)

#### Manual Verification:

- Both flows import into the Connect console without validation errors
- Calling the test number, selecting `1`, reaches the unmodified Polish main menu exactly as
  before (regression check — Polish path is byte-identical)
- Selecting `2` reaches the English main menu; pressing `1` there plays the facility's address and
  hours in English, using the same underlying data as the Polish path

---

## Phase 3: English authenticate + authenticated-menu flows

### Overview

Duplicates the caller-ID-shortcut identity path in English, stopping at the boundary this plan
draws around OTP (Polish, unchanged).

### Changes Required:

#### 1. English authenticate flow

**File**: `connect-flow-templates/flows/keypad-authenticate-flow-en.json` (new)

**Intent**: Structural duplicate of `keypad-authenticate-flow.json` — identical PESEL/phone
capture logic, identical `InvokeExternalResource` call to the unmodified `Authenticate` Lambda,
identical attempt-counter and `checkAuth`/`setAuthAttrs` branches — with every caller-facing
`Text`/`lastMessageText` literal translated (PESEL/phone prompts, the confirm-your-details
read-back, `confirmMsg`'s "identity confirmed" line) and an added English
`UpdateContactTextToSpeechVoice` block. `transferReason` literals are copied verbatim, unchanged
(What We're NOT Doing). The `storeOtpChallenge`/OTP branch is copied unchanged (still invoking the
Polish `keypad-otp-verify-module.json` and Polish SMS/demo text) — an English caller who reaches
this branch hears Polish, a recorded limitation, not a bug to fix here. On success, transfers to
`keypad-authenticated-menu-flow-en.json` (this phase's other file), not the Polish original.

**Contract**: New standalone Contact Flow, `-en` suffix convention.

#### 2. English authenticated-menu flow

**File**: `connect-flow-templates/flows/keypad-authenticated-menu-flow-en.json` (new)

**Intent**: Structural duplicate of `keypad-authenticated-menu-flow.json`, but the menu only
offers `1` (book) — digits `2`/`3`/`4` (list/cancel/reschedule) are omitted from both the prompt
text and the `Conditions` list, matching Phase 2's facility-info-menu treatment of the same
out-of-scope operations. Digit `1` transfers to `keypad-booking-flow-en.json` (Phase 4). `#`
transfers to `keypad-facility-info-main-menu-flow-en.json` (Phase 2), never the Polish main menu
(Critical Implementation Details). Added English TTS voice block.

**Contract**: New standalone Contact Flow, `-en` suffix convention.

### Success Criteria:

#### Automated Verification:

- None — hand-built console artifacts

#### Manual Verification:

- Both flows import into the Connect console without validation errors
- On the English path, entering a PESEL/phone pair matching a seeded patient's caller-ID-shortcut
  record reaches the English authenticated menu and hears the English confirmation line
- Pressing `#` from the English authenticated menu returns to the English main menu, not the
  Polish one

---

## Phase 4: English booking flow

### Overview

The heaviest phase — the full specialty/time-of-day/day/time/confirm sequence, translated, wired
to Phase 1's locale-aware Lambda.

### Changes Required:

#### 1. English booking flow

**File**: `connect-flow-templates/flows/keypad-booking-flow-en.json` (new)

**Intent**: Structural duplicate of `keypad-booking-flow.json` — identical block graph, identical
`specialty`/`timeOfDay` attribute values set per digit (Critical Implementation Details table:
wire values unchanged, only menu captions translated), identical retry/attempt-counter/no-
availability handling — with every literal `Text`/`lastMessageText` string translated (both
specialty menu pages, the time-of-day menu, the days/times/confirm prompts, success/failure
messages) and an added English TTS voice block (this flow already has one for Polish — change
`TextToSpeechVoice` only). Every `InvokeExternalResource` call to the `Booking` Lambda
(`invokeDays`, `invokeTimes`, `invokeConfirm`, `invokeBook`) adds `"locale": "en"` to its
`LambdaInvocationAttributes`, alongside the existing `specialty`/`timeOfDay`/`dayChoice`/
`timeChoice`/`authenticated`/`patientId` parameters. `#` transfers to
`keypad-facility-info-main-menu-flow-en.json`, not the Polish main menu.

**Contract**: New standalone Contact Flow, `-en` suffix convention. Every `InvokeExternalResource`
block's `LambdaInvocationAttributes` map gains exactly one new key (`locale`) versus its Polish
counterpart; no other parameter changes.

### Success Criteria:

#### Automated Verification:

- None — hand-built console artifact; Phase 1 already covers the Lambda side this flow calls into

#### Manual Verification:

- The flow imports into the Connect console without validation errors
- A full English booking (specialty → time-of-day → day → time → confirm → success) reads back
  every dynamic value in English and books the correct slot, verified against the mock's data the
  same way S-05's own manual verification already checks it
- A no-availability outcome and a declined confirmation both replay in English and behave
  identically in structure to the Polish path (same retry/give-up counters)

---

## Phase 5: Contract documentation + naming convention + end-to-end verification

### Overview

Registers the new contract surface and naming convention, then runs the full manual matrix across
both languages on a real call.

### Changes Required:

#### 1. Contract surfaces registration

**File**: `docs/reference/contract-surfaces.md`

**Intent**: New `##` entry for `Details.Parameters.locale` (Set by: the four `InvokeExternalResource`
calls in `keypad-booking-flow-en.json`; Read by: `lambdas/booking/index.ts`; Why it matters: a
hand-built Invoke block that forgets this parameter silently falls back to Polish output for an
English caller — same class of gap as every other hand-built-flow parameter already documented).

**Contract**: One new `##` entry, following the file's existing Set by / Read by / Why it matters
format exactly.

#### 2. Naming convention documentation

**File**: `connect-flow-templates/README.md`

**Intent**: Add the `-en` suffix convention from Critical Implementation Details as a new bullet
under `## Naming`.

**Contract**: One new sentence/bullet; no restructuring of the existing section.

### Success Criteria:

#### Automated Verification:

- None new — covered by Phase 1's tests

#### Manual Verification:

- **Language selection**: calling the (repointed) test number plays the bilingual prompt; `1`
  reaches the unchanged Polish main menu, `2` reaches the English main menu
- **English facility-info**: address and hours heard correctly in English
- **English booking, full matrix**: happy path; a no-availability day/time outcome re-offered from
  a fresh search; a declined confirmation returning to the day picker with specialty/time-of-day
  retained; three failed PESEL/phone attempts transferring to the agent queue
- **Polish regression**: the unmodified Polish path (main menu → authenticate → authenticated menu
  → booking) behaves identically to before this plan, end to end
- **Entry point repointed**: the claimed test number's entry contact flow is
  `keypad-language-select-flow.json`, done manually in the console (this plan does not automate
  console configuration)

---

## Testing Strategy

### Unit Tests:

- `lambdas/booking/index.test.ts`: English-locale cases for `days` and `confirm` steps, plus a
  no-`locale`-supplied case asserting unchanged Polish output (Phase 1).

### Integration Tests:

- None beyond the existing HIS/mock test suite — no HIS or `@pcm/appointment` change in this plan.

### Manual Testing Steps:

1. Import all five new flow files (Phase 2-4's four `-en` flows plus the language-select flow) via
   `fill-arns.mjs` per `connect-flow-templates/README.md`.
2. Repoint the claimed number's entry contact flow to `keypad-language-select-flow.json`.
3. Run Phase 5's full manual matrix, both languages.

## Performance Considerations

None beyond the existing per-Lambda timeout already applied to `lambdas/booking` — the `locale`
branch is a synchronous string-formatting choice with no new downstream call.

## Migration Notes

None — no schema, entity, or endpoint change. `Details.Parameters.locale` is additive and
optional; every existing caller (the Polish flow) is unaffected by its addition.

## References

- Roadmap S-10 entry and Open Roadmap Question 2: `context/foundation/roadmap.md`
- Prior planning-discussion notes: `context/changes/english-locale/change.md`
- Blocked speech-variant thread: `context/changes/lex-language-detection-spike/change.md`
- Precedent Polish flows: `connect-flow-templates/flows/keypad-facility-info-main-menu-flow.json`,
  `keypad-authenticate-flow.json`, `keypad-authenticated-menu-flow.json`,
  `keypad-booking-flow.json`
- Shared logic (untouched): `lambdas/appointment/index.ts` (`@pcm/appointment`)
- Lambda to change: `lambdas/booking/index.ts`
- Naming/import conventions: `connect-flow-templates/README.md`
- Contract surfaces: `docs/reference/contract-surfaces.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Locale branch in the booking Lambda

#### Automated

- [x] 1.1 Unit tests pass: `npm test` in `lambdas/booking`
- [x] 1.2 Type checking passes
- [x] 1.3 Full test suite passes: repo-wide test command

### Phase 2: Language-select entry flow + English facility-info

#### Manual

- [ ] 2.1 Both flows import into the Connect console without validation errors
- [ ] 2.2 Selecting `1` reaches the unmodified Polish main menu (regression check)
- [ ] 2.3 Selecting `2` reaches the English main menu and plays facility info in English

### Phase 3: English authenticate + authenticated-menu flows

#### Manual

- [ ] 3.1 Both flows import into the Connect console without validation errors
- [ ] 3.2 Caller-ID-shortcut authentication succeeds in English, reaching the English authenticated
      menu
- [ ] 3.3 `#` from the English authenticated menu returns to the English main menu

### Phase 4: English booking flow

#### Manual

- [ ] 4.1 Flow imports into the Connect console without validation errors
- [ ] 4.2 Full English booking completes and books the correct slot, verified against mock data
- [ ] 4.3 No-availability and declined-confirmation outcomes behave correctly in English

### Phase 5: Contract documentation + naming convention + end-to-end verification

#### Manual

- [ ] 5.1 Language selection routes correctly to Polish (`1`) and English (`2`)
- [ ] 5.2 English facility-info verified
- [ ] 5.3 English booking full matrix verified (happy path, no-availability, declined confirm,
      three-failed-attempts transfer)
- [ ] 5.4 Polish path regression-verified end to end, unchanged
- [ ] 5.5 Claimed number's entry contact flow repointed to `keypad-language-select-flow.json`
