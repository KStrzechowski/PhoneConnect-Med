import { KinesisVideoClient, GetDataEndpointCommand } from '@aws-sdk/client-kinesis-video';
import { KinesisVideoMediaClient, GetMediaCommand } from '@aws-sdk/client-kinesis-video-media';
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
} from '@aws-sdk/client-transcribe-streaming';
import { LexRuntimeV2Client, RecognizeTextCommand, type RecognizeTextRequest } from '@aws-sdk/client-lex-runtime-v2';
import { Decoder } from 'ebml';
import type { Readable } from 'node:stream';

const languageOptions = 'pl-PL,en-US';
const sampleRateHertz = 8000;
const audioCaptureMs = 5000;

export type LocaleId = 'pl_PL' | 'en_US';

export const localeIdForLanguageCode = (languageCode: string): LocaleId =>
  languageCode === 'en-US' ? 'en_US' : 'pl_PL';

export const buildRecognizeTextInput = (params: {
  botId: string;
  botAliasId: string;
  localeId: LocaleId;
  sessionId: string;
  text: string;
}): RecognizeTextRequest => ({
  botId: params.botId,
  botAliasId: params.botAliasId,
  localeId: params.localeId,
  sessionId: params.sessionId,
  text: params.text,
});

type SpikeEvent = {
  Details: {
    ContactData: { ContactId: string };
    Parameters: { streamArn: string; startFragmentNumber?: string };
  };
};

type SpikeResult = {
  languageCode: string;
  transcript: string;
  lexMessage: string;
  sessionState: unknown;
};

async function captureAudioFrames(payload: Readable, captureMs: number): Promise<Uint8Array[]> {
  const decoder = new Decoder();
  payload.pipe(decoder as unknown as NodeJS.WritableStream);

  const trackTypes = new Map<number, number>();
  let audioTrack: number | undefined;
  let currentTrackNumber: number | undefined;
  const frames: Uint8Array[] = [];
  const deadline = Date.now() + captureMs;

  for await (const [tag, elm] of decoder as AsyncIterable<[string, Record<string, unknown>]>) {
    if (Date.now() > deadline) break;

    if (tag === 'tag' && elm.name === 'TrackNumber') {
      currentTrackNumber = elm.value as number;
    } else if (tag === 'tag' && elm.name === 'TrackType') {
      if (currentTrackNumber !== undefined) trackTypes.set(currentTrackNumber, elm.value as number);
      if (elm.value === 2) audioTrack = currentTrackNumber;
    } else if (tag === 'tag' && (elm.name === 'SimpleBlock' || elm.name === 'Block')) {
      const track = elm.track as number;
      if (audioTrack === undefined || track === audioTrack) {
        frames.push(elm.payload as Uint8Array);
      }
    }
  }

  payload.destroy();
  return frames;
}

async function* replayAsAudioStream(frames: Uint8Array[]): AsyncGenerator<AudioStream> {
  for (const frame of frames) {
    yield { AudioEvent: { AudioChunk: frame } };
  }
}

async function detectLanguageAndTranscript(
  frames: Uint8Array[],
  transcribe: TranscribeStreamingClient,
): Promise<{ languageCode: string; transcript: string }> {
  const response = await transcribe.send(
    new StartStreamTranscriptionCommand({
      IdentifyLanguage: true,
      LanguageOptions: languageOptions,
      MediaSampleRateHertz: sampleRateHertz,
      MediaEncoding: 'pcm',
      AudioStream: replayAsAudioStream(frames),
    }),
  );

  let languageCode = '';
  let transcript = '';

  for await (const event of response.TranscriptResultStream ?? []) {
    const results = event.TranscriptEvent?.Transcript?.Results ?? [];
    for (const result of results) {
      if (result.IsPartial) continue;
      if (result.LanguageCode) languageCode = result.LanguageCode;
      const alternative = result.Alternatives?.[0]?.Transcript;
      if (alternative) transcript = alternative;
    }
  }

  return { languageCode, transcript };
}

export const handler = async (event: SpikeEvent): Promise<SpikeResult> => {
  const { streamArn, startFragmentNumber } = event.Details.Parameters;
  const contactId = event.Details.ContactData.ContactId;

  const kinesisVideo = new KinesisVideoClient({});
  const { DataEndpoint } = await kinesisVideo.send(
    new GetDataEndpointCommand({ StreamARN: streamArn, APIName: 'GET_MEDIA' }),
  );

  const kinesisVideoMedia = new KinesisVideoMediaClient({ endpoint: DataEndpoint });
  const { Payload } = await kinesisVideoMedia.send(
    new GetMediaCommand({
      StreamARN: streamArn,
      StartSelector: startFragmentNumber
        ? { StartSelectorType: 'FRAGMENT_NUMBER', AfterFragmentNumber: startFragmentNumber }
        : { StartSelectorType: 'NOW' },
    }),
  );

  const frames = await captureAudioFrames(Payload as Readable, audioCaptureMs);

  const transcribe = new TranscribeStreamingClient({});
  const { languageCode, transcript } = await detectLanguageAndTranscript(frames, transcribe);

  const lex = new LexRuntimeV2Client({});
  const localeId = localeIdForLanguageCode(languageCode);
  const recognized = await lex.send(
    new RecognizeTextCommand(
      buildRecognizeTextInput({
        botId: process.env.BOT_ID ?? '',
        botAliasId: process.env.BOT_ALIAS_ID ?? '',
        localeId,
        sessionId: contactId,
        text: transcript,
      }),
    ),
  );

  return {
    languageCode,
    transcript,
    lexMessage: recognized.messages?.[0]?.content ?? '',
    sessionState: recognized.sessionState,
  };
};
