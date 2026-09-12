---
change_id: dynamic-specialty-menu
title: Build the keypad specialty menu and its digit mapping from one Lambda catalog
status: planned
created: 2026-09-08
updated: 2026-09-08
archived_at: null
---

## Notes

`keypad-booking-flow.json` currently hardcodes the 15-specialty catalog three times:
`lambdas/booking/index.ts`'s `specialtyDisplayNamesEn` map, the spoken menu sentences in
`data-tables.md`'s `BookingPrompts` table, and the flow's 15 `setSpecialtyN` actions
(digit -> literal Polish specialty string).

Goal: collapse this to one source of truth — the Lambda's catalog — following the pattern
already used in this same flow for `setDaysMsg`/`setTimesMsg`/`setConfirmMsg` (Lambda returns
dynamic values, flow concatenates them with static locale fragments from the data table).

Shape of the fix:
- Lambda gains an ordered specialty catalog and builds the locale-aware menu list text itself
  (e.g. "1 - kardiolog, 2 - dermatolog, ..."), returned as a single external value per page.
- `BookingPrompts` data table shrinks to just the static wrapper text (intro + outro
  instructions), no specialty names.
- Flow concatenates wrapper + dynamic list (same 3-part pattern as `setConfirmMsg`).
- A Lambda step also resolves digit+page -> specialty key, replacing the flow's 15
  `setSpecialtyN` branches with one invoke + one `UpdateContactAttributes`.

Known cost: this adds a new Lambda round-trip before the specialty menu is even played
(nothing currently calls the Lambda that early), and moves sentence-building responsibility
into the Lambda. Flow is still in `context/pending-verification/appointment-booking-both-variants/`
and unverified, so this is a good time to make the change before it locks in.
