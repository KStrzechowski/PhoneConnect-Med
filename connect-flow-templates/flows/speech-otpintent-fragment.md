# Speech variant: OtpIntent wiring — superseded

This fragment described a hand-merge for `OtpIntent` routing, including the force-start
request-attribute mechanism and the mismatch-attempt counter. `speech-facility-info-flow.json`
now includes this wiring directly (`elicitOtp`, `checkOtpMismatch`, `bumpOtpMismatch`,
`setOtpMismatch1`/`setOtpMismatch2`, `checkOtpSuccess`) — import/reconcile from there instead of
hand-editing from this document.

One thing worth re-verifying against the console designer when importing: the exact
request-attribute key/field for force-starting an intent
(`x-amz-lex:start-intent:<botAliasId>:pl_PL`) — the merged flow uses a
`REPLACE_WITH_SPEECH_BOT_ALIAS_ID` placeholder for the alias-id segment; confirm the label the
designer exposes it under matches.

Reference for the underlying session attributes: `docs/reference/contract-surfaces.md` → "Lex
session attributes (facility-info-speech bot)".
