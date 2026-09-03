# Speech variant: OtpIntent wiring (hand-merge, not importable)

Like `speech-authintent-fragment.md`, this is **not** a standalone flow — hand-edit these points
into your existing speech flow, right after the `AuthIntent` wiring from that fragment.

## 1. Branch to `OtpIntent` after a non-shortcut `AuthIntent` turn

`AuthIntent`'s non-shortcut branch (no match, matched-wrong-number) now sets
`otpRequired: 'true'` instead of `transfer: 'true'` (see `speech-authintent-fragment.md`'s
`checkAuthTransfer`/`checkAuthSuccess` pair — add a third check in the same spot, evaluated
**before** `checkAuthTransfer`, since `transfer` is now reserved for a genuine downstream failure
rather than the neutral non-shortcut outcome):

```json
{
  "Identifier": "checkOtpRequired",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.otpRequired" },
  "Transitions": {
    "NextAction": "checkAuthTransfer",
    "Conditions": [
      { "NextAction": "elicitOtp", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "checkAuthTransfer", "ErrorType": "NoMatchingCondition" }]
  }
}
```

## 2. The `elicitOtp` Get Customer Input (Lex) block

`OtpIntent` is never reached by a spoken utterance — the caller must be routed into it directly,
not left to free-speak. Lex V2's Connect integration supports this via a **request attribute**
that names the intent to start: add `x-amz-lex:start-intent:<botAliasId>:pl_PL` (the same
`AliasArn`'s alias ID) set to `OtpIntent` in the block's request attributes, alongside the usual
session attributes (`contactId`, `callerNumber`, both already forwarded from the `AuthIntent`
wiring):

```json
{
  "Identifier": "elicitOtp",
  "Type": "GetParticipantInput",
  "Parameters": {
    "Text": "$.Lex.Messages[0].content",
    "TextToSpeechType": "text",
    "LexV2Bot": { "AliasArn": "<SpeechBotAliasArn>" },
    "SessionAttributes": [
      { "Key": "contactId", "Value": "$.ContactId" },
      { "Key": "callerNumber", "Value": "$.CustomerEndpoint.Address" }
    ],
    "RequestAttributes": [
      { "Key": "x-amz-lex:start-intent:<botAliasId>:pl_PL", "Value": "OtpIntent" }
    ]
  },
  "Transitions": {
    "NextAction": "checkOtpMismatch",
    "Errors": [
      { "NextAction": "checkOtpMismatch", "ErrorType": "NoMatchingCondition" },
      { "NextAction": "checkOtpMismatch", "ErrorType": "NoMatchingError" },
      { "NextAction": "checkOtpMismatch", "ErrorType": "InputTimeLimitExceeded" }
    ]
  }
}
```

`Text` speaks whatever `OtpIntent`'s fulfillment just returned (the menu prompt, the resend
confirmation, or the mismatch message) — mirroring how `elicit`/`elicitAgain` already speak the
bot's own message rather than a flow-authored one. **Verify the exact request-attribute key and
block field name in the designer** — this fragment documents the mechanism, not a tested
Connect-console export; the request-attributes UI may expose it under a different label.

## 3. The branch after `elicitOtp`

```json
{
  "Identifier": "checkOtpMismatch",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.otpMismatch" },
  "Transitions": {
    "NextAction": "checkOtpSuccess",
    "Conditions": [
      { "NextAction": "elicitOtp", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "checkOtpSuccess", "ErrorType": "NoMatchingCondition" }]
  }
}
```

```json
{
  "Identifier": "checkOtpSuccess",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.authenticated" },
  "Transitions": {
    "NextAction": "elicitOtp",
    "Conditions": [
      { "NextAction": "<main menu prompt>", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "elicitOtp", "ErrorType": "NoMatchingCondition" }]
  }
}
```

A resend (the reserved digit `9`, entered as the `otpCode` slot value) neither sets `authenticated`
nor `otpMismatch`, so it falls through both checks straight back to `elicitOtp` — looping the turn
without transferring or advancing an attempt count, same as a fresh code prompt. The turn's own
mismatch count (three attempts before transfer) is **not** tracked here in the flow: mirror the
keypad variant's approach by counting mismatches in a contact attribute
(`UpdateContactAttributes` on `checkOtpMismatch`'s `true` branch, `Compare` against it before
looping back to `elicitOtp` a fourth time, transferring instead once it reaches 3) — the same
attempt-count shape as `keypad-otp-verify-module.json`'s `bumpOtpAttempts`/`setAttempts1`/
`setAttempts2`, so match that pattern rather than reinventing it.

## Reference: `OtpIntent`'s Lex session attributes

Set by `lambdas/facility-info-speech/index.ts` (already implemented and committed — nothing to
write in code, just wire the branches above):

| Attribute | Set when | Value |
| --- | --- | --- |
| `otpRequired` / `isDemo` / `code` / `phone` / `patientId` | `AuthIntent`, non-shortcut outcome | see `docs/reference/contract-surfaces.md` |
| `authenticated` / `patientId` | `OtpIntent`, correct code | `"true"` / matched patient id |
| `otpMismatch` | `OtpIntent`, wrong code | `"true"` |
| `code` (updated) | `OtpIntent`, resend (`otpCode` slot `"9"`) | freshly generated (non-demo) or unchanged (demo) |

Full detail: `docs/reference/contract-surfaces.md` → "Lex session attributes (facility-info-speech
bot)".
