# Review Follow-ups

Queued during triage of `reviews/impl-review.md`.

## From F1 — Speech variant identity capture

`storeIdentityAttrs` (added in `speech-facility-info-flow.json`) only carries
`authenticated`/`patientId`/`firstName`/`lastName`, because those are the only identity fields
`lambdas/facility-info-speech/index.ts` puts in Lex session attributes today. The plan's Desired
End State also wants `pesel`/`phone` shown to the agent for the speech variant (matching what the
keypad variant already shows). Follow-up: have `AuthIntent`/`OtpIntent` in
`lambdas/facility-info-speech/index.ts` return `pesel`/`phone` in session attributes, then extend
`storeIdentityAttrs` to copy them too.
