# Lex Language Detection Spike — Findings

## Phase 1: Feasibility check

### 1. Transcribe streaming `IdentifyLanguage` — `pl-PL` / `en-US` pair in `eu-central-1`

**Confirmed**, via AWS documentation (no live account call needed — this is a static
service-capability question):

- Amazon Transcribe's [supported languages table](https://docs.aws.amazon.com/transcribe/latest/dg/supported-languages.html)
  lists both `pl-PL` (Polish) and `en-US` (English, US) as `batch, streaming` with no asterisk —
  the asterisk in that table marks languages whose *streaming* support is restricted in a handful
  of regions (`af-south-1`, `ap-northeast-1`, `ap-southeast-5`, `ap-southeast-7`,
  `cn-northwest-1`); neither `pl-PL` nor `en-US` carries that restriction, so both are streaming-
  eligible everywhere streaming itself is available.
- `eu-central-1` (Frankfurt) has a streaming Transcribe endpoint
  (`transcribestreaming.eu-central-1.amazonaws.com`), per the
  [Transcribe endpoints and quotas reference](https://docs.aws.amazon.com/general/latest/gr/transcribe.html).
- Streaming `IdentifyLanguage` itself (not just plain streaming) was called out as available in
  Europe (Frankfurt) in AWS's own
  ["Amazon Transcribe now supports automatic language identification for streaming transcriptions"](https://aws.amazon.com/about-aws/whats-new/2021/11/amazon-transcribe-language-identification-streaming-transcription)
  announcement (Nov 2021).

No account-specific `LanguageOptions` allowlist or quota was found that would exclude this pair —
`LanguageOptions: ['pl-PL', 'en-US']` is expected to be accepted for a streaming session in
`eu-central-1`. This will get its first live confirmation the moment Phase 2's Lambda opens a real
streaming session (not a new risk — the API either accepts the parameter or returns a
`BadRequestException`, and that would surface immediately in CloudWatch logs on the first
invocation).

### 2. KVS-to-PCM/audio feasibility in Node.js/TypeScript

**Confirmed**, with one detail deferred to Phase 2's first live call. Two things were checked:

**a. Is there a proven Node.js/TypeScript path to demux a Kinesis Video Streams `GetMedia`
response at all?**

The plan's premise — "the only public reference implementation
(`amazon-connect/amazon-connect-realtime-transcription`) is Java and archived" — is accurate for a
*complete Connect-to-Transcribe reference solution*. It is **not** accurate for "a Node.js path
exists to demux KVS's container format." Two npm packages exist:

- [`kvs-parser`](https://github.com/alezanai/kvs-parser) — unofficial, video-oriented (its
  `FrameStream` layer decodes video frames via `ffmpeg`/`beamcoder` native bindings), no documented
  audio-extraction path. Its lowest layer (`KvsStream`) is a thin wrapper around `ebml-stream`.
  Rejected for this spike: native ffmpeg bindings are a poor fit for a Lambda deployment, and we
  don't need video decoding at all.
- [`ebml`](https://www.npmjs.com/package/ebml) (v3.0.0, MIT, zero runtime dependencies, pure
  JS — confirmed via `npm install`, 4 packages total in the tree) — a general-purpose EBML/Matroska
  decoder. Its `Decoder` is a Node `Transform` stream that emits `SimpleBlock`/`Block` elements with
  a `payload` (`Uint8Array`), a `track` number, and a `value` (timecode) — exactly the demux
  primitive KVS's fragment format needs, since [KVS's own docs](https://docs.aws.amazon.com/kinesisvideostreams/latest/dg/examples-renderer.html)
  describe `GetMedia`'s output as a stream of fragments "encapsulated in a Mkv stream containing
  EBML and Segment elements" — the same container `ebml` already parses. TypeScript support exists
  via `@types/ebml` (present on npm, versions up to 3.0.5 checked).

**b. Proof, not just a plausible package**

A throwaway script (`feasibility.mjs`, run locally in the scratchpad, not committed per the plan's
instruction) piped `ebml`'s bundled real-world sample file (`node_modules/ebml/media/test.webm` —
an actual Matroska/WebM file, not a hand-built fixture) through `Decoder` and:

- Correctly walked `TrackEntry` elements and read back `TrackNumber` / `TrackType` / `CodecID` for
  both tracks in the file (`{trackNumber: 1, codecId: 'V_VP8', trackType: 1}`,
  `{trackNumber: 2, codecId: 'A_VORBIS', trackType: 2}`) — proving track-type/codec identification
  works, which is how the spike Lambda will pick out the audio track from a live KVS fragment.
  Track *type* (`2` = audio) is the field to key on, not a hardcoded track number — do not assume
  Connect always numbers its audio track `2`.
- Correctly extracted every `SimpleBlock` payload per track (182 frames / 211,488 bytes on track 1,
  261 frames / 261 bytes on track 2), with per-frame timecodes, confirming the payload bytes are
  handed back as usable `Uint8Array` frame data.

This proves the pure-JS demux mechanism works end-to-end on a real Matroska file, with **no native
dependencies** — a materially better fit for Lambda than `kvs-parser`'s ffmpeg path.

**What is deferred, deliberately, to Phase 2 rather than blocking it:** the exact `CodecID` Amazon
Connect's live media streaming emits for its voice-call audio track (commonly documented elsewhere
as raw linear PCM, 8 kHz mono, for Connect's telephony audio — not independently confirmed against
AWS's own docs in this session). This does not change the demux code path either way:
- If Connect's audio is raw PCM (`A_MS/ACM` or similar), the `SimpleBlock` payload bytes handed
  back by `ebml` need **no decoding step** at all before being framed for Transcribe streaming —
  simpler than the `test.webm` fixture above, which used compressed Vorbis audio.
- If it turns out to be a compressed codec, the same demux path still applies; only a decode step
  would need adding before the Transcribe call.

Either way, the Phase 1 question — "does a Node.js/TypeScript path exist to get frame-level audio
data out of a KVS fragment at all" — is answered yes. The spike Lambda should log the parsed
`TrackEntry` (`codecId`, `trackType`) on its very first real invocation in Phase 2, before wiring
the rest of the pipeline, as the cheap first checkpoint that confirms or corrects this assumption
against a real Connect stream.

**Package decision for Phase 2:** use `ebml` + `@types/ebml` in
`lambdas/language-detect-spike/package.json`. Do not use `kvs-parser`.

---

## Phase 2: The throwaway stack

Built and automated-verified; **not yet deployed**. Manual verification (deploy, console checks,
first test call) deferred to the end-of-slice pass per user instruction.

**Automated verification, run and confirmed:**

- `cd infra && npx cdk synth -c connectInstanceArn=<arn>` — succeeds, all three stacks synthesize
  (`PhoneConnect-Med-InfraStack`, `PhoneConnect-Med-GithubOidcStack`, `PhoneConnect-Med-SpikeStack`).
- `npm test --workspace lambdas/language-detect-spike` — 3/3 pass (the two pure functions the
  Testing Strategy scoped: `localeIdForLanguageCode`, `buildRecognizeTextInput`).
- `cd infra && npm test` — 34/34 pass across all three template suites, including the 9 new
  `spike-stack.test.ts` assertions (both locales present, alias has text-only conversation logs,
  Lambda timeout sits in the async band `(8, 60]`, `BOT_ID`/`BOT_ALIAS_ID` env vars present, Connect
  invoke permission and integration association exist, bot-association IAM policy exists, synth
  fails without `connectInstanceArn`).

**Design decisions made while building, not yet in the plan's text:**

- **Session ID = the Connect Contact ID.** `RecognizeTextCommand`'s `sessionId` is set from
  `event.Details.ContactData.ContactId` (`lambdas/language-detect-spike/index.ts`). This is not
  independently confirmed against AWS documentation in this session (a docs search surfaced
  re:Post-level guidance pointing the same way, not an authoritative doc quote) — it is the leading
  hypothesis, and **is exactly what Phase 4 tests**, not a settled fact.
- **One shared bot alias, no per-language branching in the flow.** `spike-flow.json`'s `elicit`
  step points at a single `GetParticipantInput` block against the one bot alias (both locales live
  on it), rather than two separate Lex blocks selected by a language branch. The locale hand-off is
  expected to ride on the same session-ID continuity Phase 4 tests — if Connect's native block
  picks up the session `RecognizeText` already established (including whatever locale that session
  is pinned to), no explicit locale switch is needed in the flow at all. If Phase 4 refutes session
  continuity, this flow design needs revisiting too, not just the hand-off mechanism in isolation.
- **`spike-flow.json`'s `InvokeLambdaFunction`/`Wait`/"Load Lambda Result" JSON is a first-cut, not
  a confirmed schema.** AWS documents the async-invoke-then-load-result pattern
  ([Invoke Lambda function block](https://docs.aws.amazon.com/connect/latest/adminguide/invoke-lambda-function-block.html))
  and confirms the mechanism exists (`$.LambdaInvocation.InvocationId`, "Load Lambda Result" as a
  second mode of the same block), but does not publish the flow-language JSON for the "Load Lambda
  Result" mode in a form this session could fetch. `loadResult`'s `LambdaInvocationId` parameter
  name in `spike-flow.json` is a best-effort guess. Per this project's standing convention, the flow
  is hand-imported and hand-corrected in the console anyway — this needs checking (and fixing, if
  wrong) against what the console's own "AWS Lambda function" block generates when configured
  through the UI, before the first real call.
- **KVS stream parameters** (`streamArn`, `startFragmentNumber`) are passed into the Lambda as
  `LambdaInvocationAttributes` sourced from `$.MediaStreams.Customer.Audio.StreamARN` and
  `$.MediaStreams.Customer.Audio.StartFragmentNumber` — these are Connect's documented system
  attributes for a stream started by a `StartMediaStreaming` block, not independently verified
  against a live contact in this session.
- **Audio capture window is a fixed 5 seconds of wall-clock time** (`audioCaptureMs` in
  `lambdas/language-detect-spike/index.ts`), not a byte/sample-count budget — deliberately simple
  given Phase 1's finding that the exact codec (and therefore bytes-per-second) isn't confirmed yet.
  Revisit once Phase 2's first real invocation logs the actual `TrackEntry` codec.
- **`MediaSampleRateHertz: 8000`, `MediaEncoding: 'pcm'`** passed to
  `StartStreamTranscriptionCommand` assume Connect's telephony audio is 8 kHz linear PCM — the
  same assumption Phase 1 flagged as unconfirmed and deferred to this phase's first live call.

**What Phase 2's first real invocation should check before trusting anything downstream:** log the
parsed `TrackEntry` (`codecId`, `trackType`) from `captureAudioFrames` once, confirming or
correcting the PCM/8kHz assumption before relying on it.

## Phase 3: The call matrix

_Pending — requires real test calls against the deployed spike. Table below is the structure to
fill in once Phase 2 is deployed._

| # | Opener | Expected language | Detected language | `RecognizeText` result | Acceptable? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Plain Polish opener | pl-PL | | | | |
| 2 | Plain English opener | en-US | | | | |
| 3 | Full Polish booking sentence | pl-PL | | | | |
| 4 | Full English booking sentence | en-US | | | | |
| 5 | Ambiguous/short opener ("halo") | — | | | | |

## Phase 4: Session continuity

_Pending — requires Phase 3's calls to have reached a sane `RecognizeText` response first._

## Phase 5: Verdict, hand-off, teardown

_Pending — verdict cannot be written until Phase 3/4 real-call evidence exists._
