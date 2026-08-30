# Lex Keypad Capture Spike — Findings

Roadmap **F-03**. Does the natural-language variant collect an 11-digit PESEL on the keypad
inside a conversational turn, and then carry on in speech, without bouncing the caller out to a
separate input step?

Verdict: confirmed-with-constraints

The core round trip holds: the bot answers in Polish, keys eleven DTMF digits into `pesel`,
reads them back correctly, and continues into the spoken `confirmation` slot within one session
id — the roadmap's actual question. Four behaviours surfaced across the six real calls that S-03
has to design around rather than inherit for free. See §Constraints below.

## Locale

| | |
| --- | --- |
| Identifier | `pl_PL` |
| Region | `eu-central-1` |
| Source | Lex V2 developer guide, *Supported languages and locales*; confirmed against the live account |
| Confirmed on | 2026-08-30 |

`pl_PL` (underscore — Lex V2 locale IDs, unlike the `pl-PL` BCP-47 form this section originally
named) is what the stack is built against (`infra/lib/spike-stack.ts:8`). Confirmed against the
live account:

```
aws lexv2-models list-built-in-slot-types --locale-id pl_PL --region eu-central-1
```

Returned a slot-type list, not an error — Polish is available in `eu-central-1`. (A locale Lex
does not offer in this region would have errored here rather than returning empty; that would
have invalidated Wariant B's design and been a larger finding than the one this spike was opened
for.)

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

Filled in during Phase 3, one row per call. Notes below are transcribed from the caller's own
observations during the calls, not from a re-read of the CloudWatch text conversation logs — the
"text log shows" column is marked accordingly where the log itself wasn't cross-checked line by
line.

| Behaviour | Keyed | Heard | Text log shows | Acceptable for S-03 |
| --- | --- | --- | --- | --- |
| `#` ends input early | Fewer than 11 digits, then `#`, on two separate attempts | First attempt: re-asked twice, then disconnected after the slot's 3rd attempt. Second, later attempt: 6 digits accepted immediately | Not cross-checked against the log | Constrained — see §Constraints 3 |
| `*` corrects a digit | Wrong digit mid-PESEL, `*`, correction, remaining digits, `#` | Correction accepted; the following confirmation prompt was declined ("nie") and the call disconnected instead of re-asking | Not cross-checked against the log | Constrained — see §Constraints 1, 2 |
| No `#` — ends by timeout | A few digits, then silence | Worked on one attempt (ended by inter-digit timeout as configured); did not on a retry attempt within the same slot | Not cross-checked against the log | Constrained — see §Constraints 3 |
| Fewer than eleven digits | Not run as an independently isolated call — folded into the `#`-early-end attempts above | Re-asks did keep accepting DTMF (the second short-digit attempt above was accepted), consistent with `keypadAttempt` being wired to every `promptAttemptsSpecification` entry (`spike-stack.ts:108-111`) | Not cross-checked against the log | Provisionally yes, but not independently verified — see §Constraints 3 |
| Digits spoken, not pressed | Spoken, not keyed | Treated as a non-match and retried, not captured | Spoken digits appear in the turn's `inputTranscript`; slot was not filled from them | Yes — matches the spike's own expectation; PESEL capture stays DTMF-only, see §Constraints 4 |

## Constraints

Named per the verdict convention: what was observed, and what S-03 must do about it.

1. **Confirmation denial disconnects instead of re-eliciting.** Saying "nie" to "Czy numer jest
   poprawny?" ended the call rather than looping back to re-enter the PESEL.
   `intentConfirmationSetting` in `spike-stack.ts:116-126` sets no `declinationResponse` or
   `declinationNextStep`, and `spike-flow.json`'s `elicit` block branches only on intent name
   (`Equals AuthIntent`), not on `SessionState.Intent.State`. **S-03 must** configure an explicit
   decline path (`declinationResponse` plus a next step back to slot elicitation) and make the
   flow's branching state-aware, not name-only — a real auth flow can't hang up on a caller who
   correctly says a captured PESEL was wrong.
2. **Re-asks repeat the prompt verbatim, with no "that didn't work" framing** — observed on both
   the `pesel` slot's retries and the confirmation retry. A caller has no signal that a previous
   attempt was rejected rather than the bot simply repeating itself. **S-03 must** decide whether
   silent identical re-asks are acceptable for production auth, or add distinct retry messaging.
3. **Short/partial DTMF entry produced inconsistent outcomes across calls** — one attempt with
   fewer digits triggered two re-asks and a disconnect after `maxRetries: 2` was exhausted; a
   later attempt with only 6 digits was accepted on the first try. The `KeyedDigits` slot type
   does no format validation (`spike-stack.ts:71-77` — a single `ORIGINAL_VALUE` sample, no
   regex, no PESEL checksum — validation is explicitly out of scope for this spike), so nothing
   in the configuration should reject a shorter digit string outright. **The root cause is not
   established from the call notes alone.** **S-03 must** read the CloudWatch text conversation
   log (`SpikeConversationLogGroup` output, `spike/` prefix) for these specific calls —
   session id, per-turn `SessionState.Intent.State`, `inputTranscript` — before relying on this
   mechanism for a fixed-length field where inconsistent capture is not acceptable.
4. **Speaking the PESEL doesn't fill the slot, but is heard.** `allowAudioInput` is left on for
   the `pesel` attempt and the ASR does transcribe spoken digits, but the attempt is treated as a
   non-match rather than filling the slot. This matches what the spike set out to observe, not a
   defect. **S-03 must** decide this is fine (PESEL capture stays DTMF-only, which is the point
   of testing Wariant B at all) or scope explicit digit-from-speech parsing if voice-only capture
   is ever required for this field.

## Console state to restore at teardown

Not tracked. The test number gets repointed by hand to whatever flow is needed at the time —
there is no fixed pre-spike flow to restore.

## Hand-off

The working `CfnBot` DTMF fragment, referenced by line so it doesn't drift from the source:

- Prompt-attempt specs (`keypadAttempt`, `spokenAttempt`): `infra/lib/spike-stack.ts:11-29`
- The `pesel` slot's elicitation, wired to every retry attempt: `infra/lib/spike-stack.ts:93-114`
- The `intentConfirmationSetting`, missing the decline path per §Constraints 1:
  `infra/lib/spike-stack.ts:116-126`

The contact flow JSON is `context/changes/lex-keypad-capture-spike/spike-flow.json` in this same
folder — its `elicit` block's name-only branching is the other half of §Constraints 1.

No contract-surfaces.md entry was earned. The spike's slot names (`pesel`, `confirmation`) and
bot name are throwaway per the plan's own scope; S-03 defines its own bot and flow, and nothing
here crosses a boundary the repo doesn't already enforce.
