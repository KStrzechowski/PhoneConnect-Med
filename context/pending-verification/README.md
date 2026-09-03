# Pending Verification

Changes whose automated work is done but that still have manual verification steps
outstanding (the `#### Manual` rows in their `plan.md` `## Progress` section). Moved here
from `context/changes/<id>/` instead of being held open there, or archived before anyone
has actually checked the behavior on a real call.

A change living here sits between "implemented" and "archived": `change.md.status` stays
whatever it already was (`implemented` or `impl_reviewed`) — deliberately **not**
`archived` — and its matching roadmap item keeps whatever `/10x-implement` last set it to
(typically `in-progress`) — **not** `done`. `/10x-archive` is the only thing that stamps
`archived` and flips a roadmap item to `done`, and that flip is meant to mean "verified,"
not just "coded."

## Convention

- **Moving in.** Once every `#### Automated` Progress row is checked and only
  `#### Manual` rows remain, `git mv context/changes/<id> context/pending-verification/<id>`.
  `plan.md`'s Progress section stays the live checklist — check `- [ ]` → `- [x]` here as
  each manual step gets run, same as it would if the folder had never moved.
- **Finding a problem.** Rewrite the row as `- [x] <original text> — ISSUE: <what actually
  happened>` and raise it in conversation, rather than leaving it unchecked indefinitely.
- **Graduating out.** Once every Manual row is checked (or a remaining one is explicitly
  accepted as a known, deferred limitation — noted as such inline), `git mv` the folder
  back to `context/changes/<id>/` and run `/10x-archive` normally. That is the only path
  that stamps `archived` and closes the roadmap item — nothing here does that.

## Anti-pattern

Do not treat this as a second archive. Nothing sitting here is done — it's unverified.
Other 10x skills that refuse to write into `context/archive/` don't know about this
folder; it's a plain working folder relocated to make "code complete, verification
pending" visible at a glance, not a lifecycle state any skill enforces.
