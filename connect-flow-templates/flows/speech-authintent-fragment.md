# Speech variant: AuthIntent wiring (hand-merge, not importable)

Unlike `keypad-authenticate-flow.json`, this is **not** a standalone flow to import — S-02's
main speech flow already exists in your Connect instance and was never committed to this repo
(project convention; see `docs/reference/contract-surfaces.md`). Importing a full replacement
flow here would risk clobbering the five intents S-02 already built. Instead, hand-edit the two
points below in your existing flow.

## 1. The Get Customer Input (Lex) block

Add `callerNumber` to the session attributes it already forwards (`contactId` is there today):

```json
"LexV2Bot": { "AliasArn": "<SpeechBotAliasArn>" },
"SessionAttributes": [
  { "Key": "contactId", "Value": "$.ContactId" },
  { "Key": "callerNumber", "Value": "$.CustomerEndpoint.Address" }
]
```

In the console: open the block, find where `contactId` is already mapped as a session attribute,
and add a second row mapping `callerNumber` to the caller ID system attribute (`$.CustomerEndpoint.Address`
in the attribute picker, usually listed as "Customer number" / "System" category).

## 2. The branch after the Lex block

The flow already branches on `$.Lex.SessionAttributes.fallbackCount` after every turn, almost
certainly via a "Check contact attributes" (`Compare`) block placed right after the Get Customer
Input (Lex) block. Add two more `Compare` blocks in the same spot, each checking one of
`AuthIntent`'s new session attributes:

```json
{
  "Identifier": "checkAuthTransfer",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.transfer" },
  "Transitions": {
    "NextAction": "checkAuthSuccess",
    "Conditions": [
      { "NextAction": "<agent transfer target>", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "checkAuthSuccess", "ErrorType": "NoMatchingCondition" }]
  }
}
```

```json
{
  "Identifier": "checkAuthSuccess",
  "Type": "Compare",
  "Parameters": { "Attribute": "$.Lex.SessionAttributes.authenticated" },
  "Transitions": {
    "NextAction": "<existing fallbackCount check / next turn>",
    "Conditions": [
      { "NextAction": "<main menu prompt>", "Condition": { "Operator": "Equals", "Operands": ["true"] } }
    ],
    "Errors": [{ "NextAction": "<existing fallbackCount check / next turn>", "ErrorType": "NoMatchingCondition" }]
  }
}
```

Concretely, in the console: at the Get Customer Input (Lex) block's post-turn branch, insert
these two checks before (or alongside) the existing `fallbackCount` check — `transfer` routes to
the same agent-transfer target `AgentTransferIntent` already uses, `authenticated` routes back to
the main menu prompt (mirroring how a successful `InfoIntent` turn loops back today); anything
matching neither falls through to the existing turn-handling logic unchanged. Neither `AuthIntent`
outcome needs a new digit or menu entry beyond what's already reachable — the caller triggers
`AuthIntent` by saying one of its sample utterances (e.g. "chcę się zalogować"), same as any other
intent.

## Reference: `AuthIntent`'s Lex session attributes

Set by `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch (already implemented and
committed — nothing to write, just wire the branch above):

| Attribute | Set when | Value |
| --- | --- | --- |
| `authenticated` | shortcut match | `"true"` |
| `patientId` | shortcut match | the matched patient's id |
| `transfer` | any non-shortcut outcome (no match, matched-wrong-number, downstream error) | `"true"` |

Full detail: `docs/reference/contract-surfaces.md` → "Lex session attributes (facility-info-speech bot)".
