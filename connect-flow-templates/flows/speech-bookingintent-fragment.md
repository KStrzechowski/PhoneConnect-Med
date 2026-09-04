# Speech variant: BookingIntent wiring (hand-merge, not importable)

Like `speech-authintent-fragment.md` and `speech-otpintent-fragment.md`, this is **not** a
standalone flow — hand-edit this into your existing speech flow, alongside the `AuthIntent` and
`OtpIntent` wiring from those fragments.

## Why there is almost nothing to wire here

`BookingIntent`'s entire day → time → confirm conversation (however many `ElicitSlot` /
`ConfirmIntent` turns the dialog code hook produces) happens **inside a single invocation** of the
Get Customer Input (Lex) block — Connect keeps re-entering the bot turn by turn on its own. The
flow only regains control once the bot closes the intent, exactly like every other intent already
wired in this bot. So there is no per-turn flow logic to add for the day/time/confirm loop itself;
the caller reaches `BookingIntent` the same way they reach `InfoIntent` or `AuthIntent` — by saying
one of its sample utterances (e.g. "chcę umówić wizytę do kardiologa rano") — and every intermediate
turn is invisible to the flow.

The one branch the flow does need is the auth gate: `BookingIntent`'s dialog code hook closes
immediately with `needsAuth: 'true'` when the caller isn't authenticated yet, before it ever asks
for a specialty.

## The branch after the Lex block

Add one more `Compare` block in the same spot as `checkOtpRequired`/`checkAuthTransfer`/
`checkAuthSuccess` (see `speech-authintent-fragment.md`), evaluated **before** those three — a
caller can reach for booking before ever attempting `AuthIntent`, so this check must not be
shadowed by the existing chain:

```json
{
  "Identifier": "checkBookingNeedsAuth",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.needsAuth" },
  "Transitions": {
    "NextAction": "checkOtpRequired",
    "Conditions": [
      { "NextAction": "elicitAgain", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "checkOtpRequired", "ErrorType": "NoMatchingCondition" }]
  }
}
```

Concretely, in the console: insert this check first in the post-turn branch chain, before
`checkOtpRequired`. On `needsAuth: 'true'`, the bot has already spoken
"Aby umówić wizytę, proszę się najpierw zidentyfikować." as its closing message (the block plays it
automatically before returning), so the flow just loops back to `elicitAgain` — the caller then
says an `AuthIntent` utterance to authenticate (same session, same bot), completes it, and simply
restates their booking request. There is no automatic resume of `BookingIntent` after
authentication — Lex V2 has no "switch intent" dialog action, so the caller re-asks, one extra turn
compared to the keypad variant's flow-level redirect (see `docs/reference/contract-surfaces.md` →
"Auth-gate redirect asymmetry between variants").

Every other `BookingIntent` outcome needs no new branch:

- A successful booking's confirmation message is just the bot's closing message, played
  automatically like any other intent's `Close` — the existing loop back to `elicitAgain` after any
  turn already covers it.
- The three-strikes no-availability transfer and any downstream error both set
  `transfer: 'true'`, reusing `AuthIntent`'s existing `checkAuthTransfer` branch — no new attribute,
  no new check.
- The read-back decline is handled entirely inside the bot (Lex's own confirmation matching plus
  `BookingIntent`'s `declinationNextStep`, which resets only `selectedSlot`) — invisible to the flow,
  same as the day/time turns.

## Reference: `BookingIntent`'s Lex session attributes

Set by `lambdas/facility-info-speech/index.ts`'s `BookingIntent` branch (already implemented and
committed — nothing to write in code, just wire the one branch above):

| Attribute | Set when | Value |
| --- | --- | --- |
| `needsAuth` | dialog code hook, caller not yet authenticated | `"true"` |
| `transfer` | three consecutive no-availability outcomes, or a downstream error | `"true"` |
| `bookingStage` / `bookingDate` / `bookingTime` / `bookingAttempts` | every dialog-hook turn | internal state re-read on the next turn; not read by the flow |

Full detail: `docs/reference/contract-surfaces.md` → "Lex session attributes (facility-info-speech
bot)".
