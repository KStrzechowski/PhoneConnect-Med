# Lex Keypad Capture Spike — Findings

Roadmap **F-03**. Does the natural-language variant collect an 11-digit PESEL on the keypad
inside a conversational turn, and then carry on in speech, without bouncing the caller out to a
separate input step?

Verdict: pending

## Locale

| | |
| --- | --- |
| Identifier | `pl-PL` |
| Region | `eu-central-1` |
| Source | Lex V2 developer guide, *Supported languages and locales* |
| Confirmed on | pending |

`pl-PL` is what the stack is built against (`infra/lib/spike-stack.ts`). Confirm it against the
live account before the first deploy — the identifier below is read from documentation, not from
the account:

```
aws lexv2-models list-built-in-slot-types --locale-id pl-PL --region eu-central-1
```

A locale Lex does not offer in this region returns an error here rather than an empty list. If
Polish turns out to be unavailable, stop: that outcome invalidates Wariant B's design and is a
larger finding than the one this spike was opened for. Record it in this section, leave
`Verdict: pending`, and take it to the roadmap rather than running the remaining phases.

## Importing the flow

`spike-flow.json` ships with a placeholder alias ARN. `cdk deploy` emits the real one as the
`SpikeBotAliasArn` output; substitute it before importing:

```
sed -i "s#arn:aws:lex:eu-central-1:ACCOUNT_ID:bot-alias/BOT_ID/BOT_ALIAS_ID#<SpikeBotAliasArn>#" \
  context/changes/lex-keypad-capture-spike/spike-flow.json
```

The flow greets, hands the caller to the bot, reads `$.Lex.Slots.pesel` and
`$.Lex.Slots.confirmation` back, and disconnects. It makes no decisions — L-03 holds.

## Call matrix

Filled in during Phase 3, one row per call, written as each call ends.

| Behaviour | Keyed | Heard | Text log shows | Acceptable for S-03 |
| --- | --- | --- | --- | --- |
| `#` ends input early | | | | |
| `*` corrects a digit | | | | |
| No `#` — ends by timeout | | | | |
| Fewer than eleven digits | | | | |
| Digits spoken, not pressed | | | | |

## Console state to restore at teardown

| | |
| --- | --- |
| Test number's inbound flow before the spike | pending — record in Phase 2 |

## Hand-off

The working `CfnBot` DTMF fragment and the contact flow JSON land here in Phase 4, so S-03 lifts
them rather than rederiving them.
