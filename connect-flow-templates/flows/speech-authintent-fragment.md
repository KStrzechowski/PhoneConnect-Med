# Speech variant: AuthIntent wiring — superseded

This fragment described a hand-merge for `AuthIntent` routing, written before
`speech-facility-info-flow.json` was itself committed to this repo. That flow is now the
committed baseline and already includes `AuthIntent`'s wiring (`checkOtpRequired`,
`checkAuthTransfer`, `callerNumber` forwarding) — import/reconcile from there instead of
hand-editing from this document.

Reference for the underlying session attributes: `docs/reference/contract-surfaces.md` → "Lex
session attributes (facility-info-speech bot)".
