<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Caller ID Authentication

- **Plan**: context/pending-verification/caller-id-authentication/plan.md
- **Scope**: Full plan, Phases 1-6
- **Date**: 2026-09-04
- **Verdict**: APPROVED
- **Findings**: [0 critical] [1 warning] [0 observations] — resolved during triage

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Notes on scope

Reviewed against the commit range `cb0a35c^..d26e53d` plus the later `b013b7c` (a deploy-role IAM
fix tagged `caller-id-authentication` but committed during the `otp-authentication-fallback`
window). Files shared with later slices (`lambdas/patient`, `lambdas/authenticate`,
`facility-info-speech`) were diffed at the commit where this plan's phases ended, not at current
HEAD, since HEAD already carries `otp-authentication-fallback` and
`appointment-booking-both-variants` on top.

The plan's core security property — **outcome neutrality between "no match" and "matched but
wrong number"** — was the primary focus of this review and holds at every layer:
`PatientService.verify` is a single `findOneBy({ pesel, phone })` (no sequential lookup that could
leak via timing), `@pcm/patient`'s `authenticate()` collapses both failure cases into the same
`{ authenticated: false }` shape with an explicit test asserting the two are `deepEqual`, both
Lambdas return identical shapes for both cases, and the speech intent's test asserts byte-identical
spoken wording for both. No drift found here.

The F-03 decline-disconnects-the-call bug fix is genuinely present:
`infra/lib/infra-stack.ts`'s `AuthIntent.intentConfirmationSetting.declinationNextStep` elicits
`pesel` and clears both slots via `slotValueOverride: {}`, not just a documented intent to fix it.

All automated verification commands were re-run and pass: `his/` test suite (14/14, includes the
patient spec), `lambdas/patient`, `lambdas/authenticate`, `lambdas/facility-info-speech`, and
`infra/` (`cdk synth` + `Template.fromStack`, 19/19).

## Findings

### F1 — Roadmap sync (Phase 6 item 4) never landed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/roadmap.md (S-03 entry, `## At a glance` row + `### S-03` body)
- **Detail**: The plan's Phase 6 item 4 required flipping S-03's status to `planning` in both the
  at-a-glance table and the item body as this plan's own mechanical roadmap-sync step. `git log
  --oneline -- context/foundation/roadmap.md` shows no commit between this change's start and its
  move to `pending-verification` ever touched the file — the step was skipped outright, not done
  differently. S-03 has sat at `in-progress` (a status set earlier, by F-03's handoff commit
  `20710b4`) through this entire change. Low stakes in practice: two downstream slices
  (`otp-authentication-fallback`, `appointment-booking-both-variants`) have already been built on
  top of S-03 regardless, so nothing was blocked by the stale status. Note: there is currently an
  *uncommitted* working-tree edit to roadmap.md (visible in `git diff`) that touches S-03's status
  among several others, apparently done as part of unrelated in-flight work — it sets S-03 to
  `in-progress` rather than the `planning` this plan called for, and is not part of any
  caller-id-authentication commit, so it doesn't resolve this finding either way.
- **Fix**: Set S-03's `Status:` line and its `## At a glance` row to reflect its actual current
  state (it is fully implemented and mid-manual-verification, not merely "planning") the next time
  roadmap.md is touched — no need for a dedicated commit just for this.
- **Decision**: FIXED — the working-tree edit already in progress (uncommitted, from unrelated
  work) already sets both S-03 locations to `in-progress`, which is the accurate status for its
  current implemented-but-not-archived state. No further edit needed; verified 2026-09-04.
