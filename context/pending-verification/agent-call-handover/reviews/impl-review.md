<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Agent Call Handover

- **Plan**: context/pending-verification/agent-call-handover/plan.md
- **Scope**: Full plan (Phases 1-5)
- **Date**: 2026-09-06
- **Verdict**: REJECTED
- **Findings**: 1 critical, 2 warnings, 0 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Speech variant never writes identity onto the contact, so the agent never sees it

- **Severity**: CRITICAL
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: connect-flow-templates/flows/speech-facility-info-flow.json (whole file — no `UpdateContactAttributes` block ever writes `authenticated`/`patientId`/`firstName`/`lastName`; see `checkAuthTransfer` at line 131 and `checkOtpSuccess` at line 194 as the two points where the flow currently reads but discards these facts)
- **Detail**: The plan's Desired End State promises that a caller reaching any of the five transfer points, "in either variant," lands on a queue where the agent sees the caller's name/PESEL/phone if identity was established. For the keypad variant this holds: `setAuthAttrs` and `storeOtpChallenge` in `keypad-authenticate-flow.json` copy `firstName`/`lastName`/`patientId`/`pesel`/`phone` onto the contact as soon as identity is known, so every later transfer point (including the two unplanned ones added in Progress 3.8/3.9) already has them.

  The speech variant does none of this. `speech-facility-info-flow.json` only ever *reads* `$.Lex.SessionAttributes.otpRequired` / `.transfer` / `.authenticated` / `.fallbackCount` for branching — it never runs an `UpdateContactAttributes` block to persist `authenticated`, `patientId`, `firstName`, `lastName`, `pesel`, or `phone` onto the Connect contact. The agent-side View (`connect-flow-templates/views/agent-handover-view.md`) reads `$.Attributes.*` (contact attributes), not Lex session attributes, so for every one of the four transfer points this plan wired into the speech flow (`AgentTransferIntent`, three fallback turns, `checkAuthTransfer`'s downstream failure, three OTP mismatches) — including calls that *did* successfully authenticate via OTP before transferring — the agent will always see the "Tożsamość nie została jeszcze potwierdzona." placeholder, never the real identity.

  This slipped through because Phase 4's own Manual Verification checklist (plan lines 359-367) and Progress rows 4.1-4.5 only assert `transferReason` is present at each speech trigger point; none of them assert identity is present, so a human running the checklist as written would not catch this either.
- **Fix**: Add `UpdateContactAttributes` blocks in `speech-facility-info-flow.json` that copy `$.Lex.SessionAttributes.authenticated` / `.patientId` / `.firstName` / `.lastName` onto the contact at both points the flow currently learns identity was established — right after `elicit`/`elicitAgain` for the caller-ID-shortcut path (before falling into `checkOtpRequired`), and at `checkOtpSuccess`'s `true` branch for the OTP path — mirroring `keypad-authenticate-flow.json`'s `setAuthAttrs`/`storeOtpChallenge` pattern. `pesel`/`phone` aren't in the Lex session attributes at all today, so carrying those too needs `AuthIntent`/`OtpIntent` in `lambdas/facility-info-speech/index.ts` to start returning them, same as `patientId` already is.
  - Strength: Matches the exact pattern already proven correct in the keypad variant; no new mechanism to invent.
  - Tradeoff: Touches several transition points in an already-branchy flow file, and needs a follow-up Lambda change to surface `pesel`/`phone` if those are wanted too (the plan's own Desired End State asks for them).
  - Confidence: HIGH — verified by reading the full flow file; no `Attributes` write for any identity field exists anywhere in it.
  - Blind spot: Haven't verified whether `pesel`/`phone` are recoverable another way in the speech flow (e.g. already on the contact from an earlier flow) — if they are, the Lambda change may be unnecessary.
- **Decision**: FIXED — added `storeIdentityAttrs` (`UpdateContactAttributes`) between `checkOtpRequired` and `checkAuthTransfer` in `speech-facility-info-flow.json`, copying `authenticated`/`patientId`/`firstName`/`lastName`/`pesel`/`phone` from Lex session attributes onto the contact on every non-OTP-pending turn (idempotent; picks up the persisted values by the time any of the four transfer points fires). `pesel`/`phone` required a follow-up `facility-info-speech` Lambda change (`AuthIntent` now returns them as raw slot values) — done, see `follow-ups/review-fixes.md`.

### F2 — `AuthIntent` caller-ID-shortcut branch omits `firstName` from its own session attributes

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: lambdas/facility-info-speech/index.ts:661-673
- **Detail**: The plan's Phase 2 contract for this branch only asked to add `lastName` ("adds `lastName: result.lastName` to the session attributes it returns"), on the apparent assumption `firstName` was already being forwarded there. It wasn't, before or after this change — the branch has never included `firstName`, even though `result.firstName` is available (the OTP-pending branch two blocks down does forward it). The test added for this branch (`index.test.ts`, "AuthIntent confirms and sets session attributes...") only asserts `lastName`, so nothing caught the gap. Once F1 is fixed and a contact-attribute-copy step starts reading this session attribute, callers who authenticate via the caller-ID shortcut in the speech variant will show a blank first name to the agent even though their last name is present.
- **Fix**: Add `firstName: result.firstName` alongside the existing `lastName: result.lastName` at lambdas/facility-info-speech/index.ts:672, and extend the existing test to assert it.
- **Decision**: FIXED — added `firstName: result.firstName` to the response object and extended the "AuthIntent confirms and sets session attributes..." test to assert it. `tsc --noEmit` and `npm test` both pass (68/68).

### F3 — contract-surfaces.md's new `transferReason` entry misdescribes the actual delivery mechanism

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: docs/reference/contract-surfaces.md (new `## \`transferReason\` contact/session attribute (S-11)` section)
- **Detail**: This section says `transferReason` is "Read by: the agent-side handover View, shown via the Agent Whisper Flow attached to the destination queue (S-11) — see `connect-flow-templates/views/agent-handover-view.json`." Both details are stale: `agent-handover-view.json` doesn't exist (Phase 5 fell back to `agent-handover-view.md`, a hand-merge guide, per the plan's own Migration Notes contingency), and `agent-handover-whisper-flow.md` explicitly documents that a classic Agent Whisper Flow *cannot* run a Show view block at all — the real mechanism is a Set event flow into a separate Inbound guide flow. `docs/reference/contract-surfaces.md` is this repo's load-bearing names registry; a future implementer following this entry would look for a file that doesn't exist and try to wire a flow-block combination AWS doesn't support.
- **Fix**: Update the "Read by" line to reference `connect-flow-templates/views/agent-handover-view.md` and describe the Set-event-flow-into-guide-flow mechanism `agent-handover-whisper-flow.md` documents, instead of "Agent Whisper Flow."
- **Decision**: FIXED — corrected the "Read by" line to point at `agent-handover-view.md` and describe the Set-event-flow/guide-Inbound-flow mechanism.
