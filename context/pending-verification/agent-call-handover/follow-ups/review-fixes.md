# Review Follow-ups

Queued during triage of `reviews/impl-review.md`.

## From F1 — Speech variant identity capture

DONE. `AuthIntent` in `lambdas/facility-info-speech/index.ts` now also returns `pesel`/`phone` in
its session attributes (raw slot values, both the immediate-authenticated and otpRequired
branches), and `storeIdentityAttrs` in `speech-facility-info-flow.json` copies them onto the
contact alongside `authenticated`/`patientId`/`firstName`/`lastName`.
