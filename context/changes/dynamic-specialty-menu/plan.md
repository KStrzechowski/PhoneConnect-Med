# Dynamic specialty menu (keypad booking flow) Implementation Plan

## Overview

`keypad-booking-flow.json` hardcodes the 15-specialty catalog three times: the spoken menu
sentences in `data-tables.md`'s `BookingPrompts` table, the flow's 15 `setSpecialtyN` actions
(digit -> literal Polish specialty string), and `lambdas/booking/index.ts`'s
`specialtyDisplayNamesEn` map (English display names only). We collapse this to one source of
truth — an ordered catalog in the Lambda — following the pattern this same flow already uses for
`setDaysMsg`/`setTimesMsg`/`setConfirmMsg` (Lambda returns dynamic values, flow concatenates them
with static locale fragments from the data table). This also brings the flow in line with
`context/foundation/lessons.md` L-03: resolving a pressed digit into domain data belongs in the
shared layer, never in the contact flow.

Scope is strictly `keypad-booking-flow.json`, `lambdas/booking/`, and `data-tables.md` (the
BookingPrompts wiring doc this flow depends on). No other flow, module, or Lambda changes.

## Current State Analysis

- `lambdas/booking/index.ts:11-27` holds `specialtyDisplayNamesEn`, a Polish-key -> English-name
  map used only by the `confirm` step's read-back message (line 91). No ordering information; not
  used as a full catalog.
- `keypad-booking-flow.json:748-1184` defines 15 `setSpecialtyN` actions, each a literal
  `UpdateContactAttributes` setting `specialty` to a hardcoded Polish string, reached via
  `specialtyMenuPage1`/`specialtyMenuPage2`'s digit `Conditions` (lines 612-745, 936-1051).
- `data-tables.md`'s `BookingPrompts` table (lines 63-68) has `specialtyPage1`/`specialtyPage2`
  columns holding full pre-written sentences (intro + all specialty names + outro) per locale.
- `copyPrompts` (`keypad-booking-flow.json:476-510`) copies `specialtyPage1`/`specialtyPage2`
  verbatim into contact attributes; `setMsgSpecialtyPage1`/`setMsgSpecialtyPage2`
  (lines 593-610, 917-934) copy that attribute straight into `lastMessageText` with no
  concatenation.
- `specialtyMenuPage1`/`specialtyMenuPage2` (`GetParticipantInput`) currently have
  `"StoreInput": "False"` — the raw digit is discarded once a `Conditions` branch matches.
- Every `GetParticipantInput`'s `Errors` (`NoMatchingCondition`, `InputTimeLimitExceeded`,
  `NoMatchingError`) across the *entire* flow — not just the specialty menus — routes to the
  shared `bumpInputAttempts` counter, which on its first two strikes loops back through
  `setInputAttempts1`/`setInputAttempts2` to `setMsgSpecialtyPage1` (lines 2273-2309). This means
  an invalid digit at, say, `daysMenu` redisplays specialty page 1, reusing whatever
  `lastMessageText`-feeding attributes are already cached — it does not require rebuilding the
  menu text from the Lambda again.
- `keypad-authenticate-flow.json:390-421` establishes the precedent for combining digit capture
  with routing: `peselPrompt` sets `"StoreInput": "True"` and the next action reads
  `$.StoredCustomerInput` — proof this mechanism already round-trips in this codebase.
- `docs/reference/contract-surfaces.md` (`## Details.Parameters.step / .specialty / ...`)
  documents that `specialty` is a Polish key regardless of caller locale — confirmed by
  `lambdas/booking/index.test.ts`'s `confirm step returns an English message and specialty name
  when locale is en` test, which passes `specialty: 'kardiolog'` even for `locale: 'en'`.

## Desired End State

- `lambdas/booking/index.ts` owns one ordered 15-item specialty catalog. Two new `step` values —
  `specialtyList` (builds both pages' locale-aware menu text) and `specialty` (resolves a page +
  digit into a specialty key) — are the only place that catalog is read.
- `data-tables.md`'s `BookingPrompts` no longer lists any specialty name; it holds only the
  static wrapper text (intro before the list, outro after it) per page per locale.
- `keypad-booking-flow.json` contains zero literal specialty names. The flow fetches both pages'
  list text once near the top of the call, and resolves a chosen digit via one shared
  invoke-and-set path per page.
- Caller-facing behavior is unchanged in shape (same menu structure, paging, reserved digits);
  minor wording differences in the specialty-list phrasing are acceptable (confirmed with user).

### Key Discoveries:

- The specialty list text splits cleanly into **intro + comma-joined item list + outro** for both
  locales and both pages — unlike the days/times messages, there's no fragment-per-item
  interleaving needed, since every item uses the same per-locale template (`"N - name"` for
  Polish, `"N for Name"` for English).
- `StoreInput: "True"` + `Conditions` can coexist on the same `GetParticipantInput` action
  (already implicitly proven by mixing patterns in this codebase; explicit combination is new
  here but uses only documented Flow Language fields).
- Because `setMsgSpecialtyPage1`/`setMsgSpecialtyPage2` are shared retry-landing targets from
  multiple predecessors, fetching the list text once (eager) and caching it in contact attributes
  avoids re-invoking the Lambda on every unrelated retry elsewhere in the flow.

## What We're NOT Doing

- Not touching `speech-bookingintent-fragment.md`, any other keypad flow, or
  `lambdas/facility-info-speech/index.ts` — the speech variant resolves specialty via Lex slot
  value, not a digit menu, so it has no equivalent duplication.
- Not touching `@pcm/appointment` or the `his`/mock-HIS backend — the specialty catalog stays a
  literal in `lambdas/booking/index.ts`, matching how `specialtyDisplayNamesEn` already lives
  there today.
- Not guaranteeing byte-identical spoken wording to today's text — minor rewording is
  acceptable (user decision) as long as the sentence structure and reserved digits are preserved.
- Not adding bounds/validation error handling for out-of-range digit or page values in the new
  Lambda steps — `GetParticipantInput`'s own `Conditions` already restrict which digits reach the
  new invoke actions, so a defensive check would guard against a state the flow already excludes
  (L-02).

## Implementation Approach

Build the Lambda side first (independently testable), then the data-table wrapper text it will be
concatenated with, then rewire the flow to call both new steps and remove the hardcoded
per-digit actions.

## Phase 1: Lambda catalog and two new steps

### Overview

Add the ordered specialty catalog and two new `step` branches to `lambdas/booking/index.ts`, with
unit test coverage in `lambdas/booking/index.test.ts`.

### Changes Required:

#### 1. Ordered specialty catalog

**File**: `lambdas/booking/index.ts`

**Intent**: Replace the implicit ordering baked into the flow's 15 `setSpecialtyN` actions with
one explicit ordered array, positions 0-7 for page 1 (digits 1-8) and 8-14 for page 2 (digits
1-7). Keep `specialtyDisplayNamesEn` as-is; both new steps reuse it for English text.

**Contract**: `const specialtyCatalog: string[]` — 15 Polish keys in the exact order the current
15 `setSpecialtyN` actions use (`kardiolog, dermatolog, okulista, laryngolog, neurolog, ortopeda,
internista, ginekolog, pediatra, endokrynolog, chirurg, urolog, psychiatra, alergolog,
reumatolog`), defined alongside `specialtyDisplayNamesEn`.

#### 2. `specialtyList` step

**File**: `lambdas/booking/index.ts`

**Intent**: Build the locale-aware, comma-joined item list for each page from the catalog, so the
flow only needs to wrap it with static intro/outro text.

**Contract**: New `step === 'specialtyList'` branch, added alongside the existing `days`/`times`/
`confirm`/`book` branches (no `patientId`/`specialty`/`timeOfDay` needed — only `locale`). Returns
`{ reachable: 'true', list1, list2 }` where `list1`/`list2` are built by mapping
`specialtyCatalog.slice(0, 8)` / `.slice(8)` to `` `${n} - ${key}` `` (pl) or
`` `${n} for ${specialtyDisplayNamesEn[key] ?? key}` `` (en), 1-indexed, joined with `', '`. No
`downstream()` wrapping — this is a pure computation, not an external call.

#### 3. `specialty` step

**File**: `lambdas/booking/index.ts`

**Intent**: Resolve a page + 1-indexed digit choice into the specialty key at that catalog
position, replacing what the flow's `setSpecialtyN` actions did with a literal.

**Contract**: New `step === 'specialty'` branch, reading new destructured params `page` and
`choice` (both default `''`). Returns `{ reachable: 'true', specialty: specialtyCatalog[(page ===
'2' ? 8 : 0) + Number(choice) - 1] ?? '' }`.

#### 4. Unit tests

**File**: `lambdas/booking/index.test.ts`

**Intent**: Cover both new steps the same way existing steps are covered — one assertion per
locale for `specialtyList`, boundary positions for `specialty`.

**Contract**: Add tests: `specialtyList` step returns pl text containing `'1 - kardiolog'` and
`'1 - pediatra'` (list2); `specialtyList` step with `locale: 'en'` returns text containing
`'1 for Cardiology'`; `specialty` step with `page: '1', choice: '1'` resolves to `kardiolog`,
`page: '1', choice: '8'` resolves to `ginekolog`, `page: '2', choice: '1'` resolves to `pediatra`,
`page: '2', choice: '7'` resolves to `reumatolog`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test -w lambdas/booking` (or repo's equivalent test command)
- Type checking passes: `npm run typecheck` (or repo's equivalent)
- Linting passes: `npm run lint` (or repo's equivalent)

#### Manual Verification:

- None required for this phase — pure Lambda logic, fully covered by automated tests.

---

## Phase 2: Data table restructure

### Overview

Replace `BookingPrompts`' full-sentence specialty columns with wrapper-only columns, so the
Lambda-built list can be concatenated in between.

### Changes Required:

#### 1. `BookingPrompts` table schema and content

**File**: `connect-flow-templates/data-tables.md`

**Intent**: Drop `specialtyPage1`/`specialtyPage2` (full sentences including every specialty
name) and add four new columns holding only the static wrapper text, so the data table no longer
lists specialties at all.

**Contract**: In the `BookingPrompts` table (the row currently spanning lines 65-68), replace the
`specialtyPage1`/`specialtyPage2` columns with `specialtyPage1Intro`, `specialtyPage1Outro`,
`specialtyPage2Intro`, `specialtyPage2Outro`, for both `pl` and `en` rows. Content (minor
rewording from today's sentences is acceptable):

| locale | specialtyPage1Intro | specialtyPage1Outro | specialtyPage2Intro | specialtyPage2Outro |
| --- | --- | --- | --- | --- |
| pl | Wybierz specjalizację. Naciśnij | . Naciśnij 9, aby usłyszeć kolejne specjalizacje. Naciśnij 0, aby połączyć się z konsultantem. Naciśnij gwiazdkę, aby powtórzyć. Naciśnij krzyżyk, aby wrócić do menu głównego. | Kolejne specjalizacje. Naciśnij | . Naciśnij 0, aby połączyć się z konsultantem. Naciśnij gwiazdkę, aby powtórzyć. Naciśnij krzyżyk, aby wrócić do menu głównego. |
| en | Choose a specialty. Press | . Press 9 to hear more specialties. Press 0 to speak with an agent. Press star to repeat. Press pound to return to the main menu. | More specialties. Press | . Press 0 to speak with an agent. Press star to repeat. Press pound to return to the main menu. |

`specialtyPage1Intro`/`specialtyPage2Intro` need a trailing space (they're immediately followed
by the Lambda's `"1 - kardiolog, ..."` text with no separator); `specialtyPage1Outro`/
`specialtyPage2Outro` need a leading period+space, matching the existing convention documented for
`confirmSuffix` at the bottom of this file.

Also update the "Wiring a table into its flow" instructions' implicit column list (the "every
column listed for that table" instruction in the general section already covers this
automatically — no separate edit needed there) and this file's own line noting `confirmSuffix`'s
leading-space convention to also mention the four new specialty columns need the same care.

### Success Criteria:

#### Automated Verification:

- None — this is a documentation/config-reference file with no automated consumer.

#### Manual Verification:

- Reviewer confirms the new column content reads naturally in both locales when substituted
  mentally with a sample list (e.g., intro + "1 - kardiolog, 2 - dermatolog" + outro forms a
  coherent sentence).

---

## Phase 3: Flow rewiring

### Overview

Wire `keypad-booking-flow.json` to fetch both pages' list text once near the top of the call, and
resolve a chosen digit via one shared invoke-and-set action per page, removing all 15 literal
`setSpecialtyN` actions.

### Changes Required:

#### 1. `copyPrompts` attribute list

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Copy the four new wrapper columns instead of the two full-sentence columns.

**Contract**: In `copyPrompts`'s `Attributes` (lines 479-497), replace the `specialtyPage1`/
`specialtyPage2` entries with `specialtyPage1Intro`, `specialtyPage1Outro`, `specialtyPage2Intro`,
`specialtyPage2Outro`, each sourced from `$.DataTables.BookingPrompts.<column>`.

#### 2. Menu-list fetch, inserted after `initAttempts`

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Fetch both pages' list text once per call, before the specialty menu is first shown.

**Contract**: Change `initAttempts`'s `NextAction` (line 583) from `setMsgSpecialtyPage1` to a new
action `invokeSpecialtyList`. Add three new actions:
- `invokeSpecialtyList` (`InvokeLambdaFunction`, same ARN placeholder and
  `InvocationTimeLimitSeconds: "8"` convention as the other invokes): `LambdaInvocationAttributes`
  = `{ step: "specialtyList", locale: "$.Attributes.locale", authenticated:
  "$.Attributes.authenticated" }`. `NextAction`: `checkSpecialtyListReachable`. `Errors` ->
  `errorTransfer` (matches `invokeDays`/`invokeTimes`/`invokeConfirm`/`invokeBook`'s pattern —
  user decision).
- `checkSpecialtyListReachable` (`Compare` on `$.External.reachable`, same shape as
  `checkDaysReachable`): `true` -> `setSpecialtyListAttrs`; `NoMatchingCondition` -> `errorTransfer`.
- `setSpecialtyListAttrs` (`UpdateContactAttributes`): `{ specialtyList1: "$.External.list1",
  specialtyList2: "$.External.list2" }`. `NextAction`: `setMsgSpecialtyPage1`.

`playNoAvailability`, `setInputAttempts1`, and `setInputAttempts2` keep their existing
`NextAction: "setMsgSpecialtyPage1"` unchanged — they reuse the cached `specialtyList1`/
`specialtyList2` attributes rather than re-invoking the Lambda.

#### 3. `setMsgSpecialtyPage1` / `setMsgSpecialtyPage2` composition

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Concatenate the wrapper text with the cached Lambda list, same 3-part pattern as
`setConfirmMsg`.

**Contract**: `setMsgSpecialtyPage1`'s `lastMessageText` (line 597) becomes
`"$.Attributes.specialtyPage1Intro$.Attributes.specialtyList1$.Attributes.specialtyPage1Outro"`.
`setMsgSpecialtyPage2`'s (line 921) becomes
`"$.Attributes.specialtyPage2Intro$.Attributes.specialtyList2$.Attributes.specialtyPage2Outro"`.

#### 4. Digit capture and resolution, page 1

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Capture the raw digit via `StoredCustomerInput` and resolve it through the Lambda
instead of branching to a literal per digit.

**Contract**: `specialtyMenuPage1` (lines 612-745): set `"StoreInput": "True"` (was `"False"`).
Repoint the eight `Conditions` for `"1"`-`"8"` (currently targeting `setSpecialty1`...
`setSpecialty8`) to all target the same new action, `invokeSpecialtyChoicePage1`. The `"9"`,
`"0"`, `"*"`, `"#"` conditions and all `Errors` are unchanged. Delete the now-unused
`setSpecialty1`...`setSpecialty8` actions (lines 747-898) and `repeatSpecialtyPage1` stays as-is
(it re-plays `lastMessageText`, unaffected).

Add `invokeSpecialtyChoicePage1` (`InvokeLambdaFunction`): `LambdaInvocationAttributes` =
`{ step: "specialty", page: "1", choice: "$.StoredCustomerInput", authenticated:
"$.Attributes.authenticated" }`. `NextAction`: `checkSpecialtyChoiceReachable`. `Errors` ->
`errorTransfer`.

#### 5. Digit capture and resolution, page 2

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Same mechanism as page 1, for the second page's seven specialties.

**Contract**: `specialtyMenuPage2` (lines 936-1051): set `"StoreInput": "True"`. Repoint the seven
`Conditions` for `"1"`-`"7"` (currently targeting `setSpecialty9`...`setSpecialty15`) to
`invokeSpecialtyChoicePage2`. `"0"`, `"*"`, `"#"` conditions and `Errors` unchanged. Delete
`setSpecialty9`...`setSpecialty15` (lines 1053-1185).

Add `invokeSpecialtyChoicePage2` (`InvokeLambdaFunction`): `LambdaInvocationAttributes` =
`{ step: "specialty", page: "2", choice: "$.StoredCustomerInput", authenticated:
"$.Attributes.authenticated" }`. `NextAction`: `checkSpecialtyChoiceReachable`. `Errors` ->
`errorTransfer`.

#### 6. Shared resolution outcome

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: One shared reachable-check and attribute-set for both pages' digit resolution,
replacing what all 15 `setSpecialtyN` actions did individually.

**Contract**: Add `checkSpecialtyChoiceReachable` (`Compare` on `$.External.reachable`): `true` ->
`setSpecialty`; `NoMatchingCondition` -> `errorTransfer`. Add `setSpecialty`
(`UpdateContactAttributes`): `{ specialty: "$.External.specialty" }`. `NextAction`:
`setMsgTimeOfDay` (same target every `setSpecialtyN` action used).

#### 7. Flow description and metadata

**File**: `connect-flow-templates/flows/keypad-booking-flow.json`

**Intent**: Keep the flow's `description` field's Data Table wiring instructions accurate now
that `BookingPrompts`' columns changed.

**Contract**: Update the `Metadata.description` string's "Query Attributes = every column listed
in `connect-flow-templates/data-tables.md`'s BookingPrompts section" note — no change needed to
that sentence itself (it already says "every column," which still holds), but remove/add
`ActionMetadata` position entries for the deleted `setSpecialtyN` actions and new actions so the
designer canvas doesn't show orphaned or missing blocks.

### Success Criteria:

#### Automated Verification:

- Flow JSON is valid JSON: `node -e "JSON.parse(require('fs').readFileSync('connect-flow-templates/flows/keypad-booking-flow.json', 'utf8'))"`
- No remaining references to deleted action identifiers: `grep -c "setSpecialty[0-9]" connect-flow-templates/flows/keypad-booking-flow.json` returns `0`

#### Manual Verification:

- Import the flow in the Connect console designer; no orphaned or dangling-reference blocks
  shown.
- Re-create the `BookingPrompts` data table per the updated `data-tables.md` columns, wire the
  Data Table block per the flow's `description` field.
- Click through a full booking call in both locales: specialty page 1, press 9 for page 2, pick a
  specialty from page 2, complete day/time/confirm/book — verify the spoken specialty name at the
  confirmation step matches the digit originally pressed, in both `pl` and `en`.
- Verify `0`/`*`/`#` still work at both specialty menu pages exactly as before.
- Verify an invalid digit or timeout at a later step (e.g., `daysMenu`) still redisplays specialty
  page 1 correctly (reusing the cached list, no unexpected re-invoke or blank menu).

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding further.

---

## Testing Strategy

### Unit Tests:

- `specialtyList` step: pl and en locale text shape, both pages.
- `specialty` step: boundary digits (1 and 8 on page 1; 1 and 7 on page 2) resolve to the correct
  catalog entries.

### Integration Tests:

- None automatable — Connect flow behavior can only be verified via the console designer and a
  live/test call, per existing convention for this repo's flow files.

### Manual Testing Steps:

1. Import the updated flow, re-create the data table per Phase 2's columns.
2. Call through the booking flow in Polish: pick a specialty from page 1, confirm the read-back
   names the correct specialty.
3. Call through again, press 9 to reach page 2, pick a specialty there, confirm the read-back.
4. Repeat both in English (`locale = en`), confirm the read-back uses the English specialty name.
5. Trigger a retry (press an invalid digit) at `daysMenu`, confirm it lands back on specialty page
   1 with the correct (cached) list text, not a Lambda error or blank prompt.

## Performance Considerations

One additional `InvokeLambdaFunction` call per booking session (the `specialtyList` fetch), fired
once near the start of the flow. Digit resolution replaces a free in-flow branch with one Lambda
call per specialty selection — same `InvocationTimeLimitSeconds: "8"` budget already used
elsewhere in this flow.

## Migration Notes

The `BookingPrompts` data table must be re-created (or its columns edited) to match Phase 2's new
schema before the updated flow is imported — the flow's `copyPrompts` action will read undefined
values from the old column names otherwise. This is a manual, hand-built step outside IaC, same as
every other data table change in this repo.

## References

- Related change: `context/pending-verification/appointment-booking-both-variants/plan.md`
  (original S-05 booking flow plan)
- Pattern followed: `keypad-booking-flow.json`'s `setDaysMsg`/`setTimesMsg`/`setConfirmMsg`
  (lines 1490-1497, 1749-1756, 2009-2016)
- `StoreInput`/`StoredCustomerInput` precedent: `keypad-authenticate-flow.json:389-421`
- Lesson followed: `context/foundation/lessons.md` L-03

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Lambda catalog and two new steps

#### Automated

- [ ] 1.1 Unit tests pass
- [ ] 1.2 Type checking passes
- [ ] 1.3 Linting passes

### Phase 2: Data table restructure

#### Manual

- [ ] 2.1 Reviewer confirms new column content reads naturally in both locales

### Phase 3: Flow rewiring

#### Automated

- [ ] 3.1 Flow JSON is valid JSON
- [ ] 3.2 No remaining references to deleted action identifiers

#### Manual

- [ ] 3.3 Import the flow in the Connect console designer; no orphaned/dangling blocks
- [ ] 3.4 Re-create BookingPrompts data table per updated columns, wire Data Table block
- [ ] 3.5 Click through full booking call in both locales, verify confirmation names correct specialty
- [ ] 3.6 Verify 0/*/# still work at both specialty menu pages
- [ ] 3.7 Verify invalid digit/timeout later in flow still redisplays specialty page 1 correctly
