---
change_id: intent-accuracy-measurement
title: Intent accuracy measurement
status: new
created: 2026-09-05
updated: 2026-09-05
archived_at: null
---

## Notes

Deferred 2026-09-05, before a plan was written. During `/10x-plan`, research surfaced that every
change in `context/pending-verification/` (S-03 through S-08) has 100% of its Automated checks
passed but only Manual (real-call) verification outstanding, including two undeployed `cdk deploy`
steps (`caller-id-authentication` 5.3, `otp-authentication-fallback` 5.3). User doesn't have time
for that manual pass right now, and doesn't want to run the held-out corpus (a one-shot resource —
participants who've never seen the system) against flows whose dialog-hook/auth-gate mechanics are
still unproven by a real call. Decision: pivot to `english-locale` (S-10) instead, since it is
implementation work rather than measurement.

Two things to fix before this change is next picked up:
- Ground-truth drift: `test-corpus-kit.md` / `lex-sample-utterances.md` label the appointments
  intent `AppointmentsIntent`; the deployed intent (`infra/lib/infra-stack.ts:626`) is actually
  `ListAppointmentsIntent`.
- Auth-gate gotcha: `BookingIntent`/`CancelIntent`/`RescheduleIntent`'s dialog code hook
  (`lambdas/facility-info-speech/index.ts:131`) returns an early `Close` response with no slots
  when `sessionAttributes.authenticated !== 'true'` — any scoring harness must seed `authenticated:
  'true'` + a `patientId` into the session before calling `RecognizeText`, or B2/B3 slot-extraction
  data is lost silently.

Open design questions not yet resolved: voice replay (text-only `RecognizeText` vs. also
`RecognizeUtterance`) and report depth (per-intent + known-pair callouts vs. full N×N confusion
matrix). Roadmap Question 1 (keypad analogue) was resolved: kept out of scope for this change.
