# Dynamic specialty menu (keypad booking flow) — Plan Brief

> Full plan: `context/changes/dynamic-specialty-menu/plan.md`

## What & Why

`keypad-booking-flow.json` hardcodes the same 15-specialty catalog three times: the spoken menu
sentences in `data-tables.md`, the flow's 15 `setSpecialtyN` digit-to-name actions, and the
Lambda's English-name map. This plan collapses it to one source of truth — the Lambda — matching
the pattern this flow already uses for its day/time/confirm messages, and the project's own L-03
rule that resolving a pressed digit into domain data belongs in the shared layer, not the flow.

## Starting Point

Today, `specialtyMenuPage1`/`specialtyMenuPage2` branch on the pressed digit straight to one of 15
`UpdateContactAttributes` actions, each hardcoding a literal Polish specialty name. The spoken
menu text is a fully pre-written sentence per locale per page in the `BookingPrompts` data table.
Adding, removing, or reordering a specialty means editing three files in lockstep by hand.

## Desired End State

The flow contains zero literal specialty names. It fetches both pages' menu text from the Lambda
once per call and resolves whichever digit the caller presses through the same Lambda's catalog.
Adding or reordering a specialty becomes a one-file change in `lambdas/booking/index.ts`; the data
table and flow never need to change again for a catalog edit. Caller-facing behavior is
unchanged in shape; minor wording differences in the specialty-list phrasing are acceptable.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Menu-text timing | Eager — one Lambda call near flow start, both pages | Avoids re-invoking the Lambda on every unrelated retry elsewhere in the flow, since specialty-page-1 is a shared retry-landing target | Plan |
| Wording exactness | Minor rewording acceptable | User confirmed a byte-identical guarantee isn't required | Plan (user answer) |
| data-tables.md scope | Included in this change | It's the wiring doc for the columns this flow's Data Table block reads — leaving it stale contradicts its purpose | Plan (user answer) |
| New-invoke failure handling | Transfer to agent (`errorTransfer`) | Matches every other Lambda invoke in this flow — one consistent failure story | Plan (user answer) |
| Digit capture mechanism | `StoreInput: "True"` + `$.StoredCustomerInput` | Already proven in `keypad-authenticate-flow.json`'s PESEL capture; lets all per-page digits share one invoke action instead of one action per digit | Plan |

## Scope

**In scope:**
- `lambdas/booking/index.ts` — ordered specialty catalog, `specialtyList` and `specialty` steps
- `lambdas/booking/index.test.ts` — coverage for both new steps
- `connect-flow-templates/data-tables.md` — `BookingPrompts` column restructure
- `connect-flow-templates/flows/keypad-booking-flow.json` — invoke wiring, digit capture, removal
  of all 15 `setSpecialtyN` actions

**Out of scope:**
- Any other flow file (speech variant, other keypad flows)
- `@pcm/appointment` / mock-HIS backend
- Byte-identical wording guarantee

## Architecture / Approach

One new Lambda invoke (`specialtyList`) fires once near flow start and caches both pages' list
text as contact attributes — the flow concatenates cached wrapper text (from the data table) with
the cached list, same 3-part pattern already used for the day/time/confirm messages. When the
caller picks a digit, the two menu prompts now store the raw digit via `StoredCustomerInput` and
route it to one shared `specialty` invoke per page, replacing 15 literal-branch actions with 2
invoke actions + 2 shared follow-up actions.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Lambda catalog and two new steps | `specialtyList` + `specialty` steps, ordered catalog, unit tests | Low — pure logic, fully unit-tested |
| 2. Data table restructure | `BookingPrompts` wrapper-only columns, both locales | Low — doc-only, no automated consumer |
| 3. Flow rewiring | Flow fetches list text + resolves digits via Lambda; 15 literal actions removed | Medium — hand-edited JSON + manual Connect console verification; `StoreInput` + `Conditions` combination is new to this codebase |

**Prerequisites:** Phase 1 must land before Phase 3 (flow references the new Lambda steps);
Phase 2 must land before Phase 3 (flow reads the new data table columns).
**Estimated effort:** ~1 session across 3 phases — small, well-bounded file set.

## Open Risks & Assumptions

- Assumes Amazon Connect's Flow Language JSON supports `StoreInput: "True"` together with
  `Conditions` on the same `GetParticipantInput` action (not previously combined in this repo,
  though each half is independently proven). If the console rejects this combination on import,
  Phase 3 falls back to one intermediate `UpdateContactAttributes` per digit before the shared
  invoke — more actions than planned, but the same net architecture.
- This flow is still sitting in `context/pending-verification/appointment-booking-both-variants/`,
  unverified against a live Connect instance — this plan does not change that verification status,
  it only changes what gets verified.

## Success Criteria (Summary)

- No specialty name appears as a literal string anywhere in `keypad-booking-flow.json`.
- A caller can complete a booking in both locales, on both specialty pages, and hear the correct
  specialty name read back at confirmation.
- Adding a 16th specialty requires editing only `lambdas/booking/index.ts`.
