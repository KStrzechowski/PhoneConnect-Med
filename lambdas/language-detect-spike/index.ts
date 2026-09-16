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
const audioCaptureMs = 9000;
const silenceStopMs = 1500;
const languageConfidenceThreshold = 0.7;

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
    ContactData: {
      ContactId: string;
      MediaStreams: { Customer: { Audio: { StreamARN: string } } };
    };
  };
};

type SpikeResult = {
  languageCode: string;
  transcript: string;
  lexMessage: string;
  sessionState: unknown;
};

export async function* captureAudioFrames(payload: Readable, captureMs: number): AsyncGenerator<Uint8Array> {
  if (captureMs <= 0) {
    payload.destroy();
    return;
  }

  const decoder = new Decoder();
  payload.pipe(decoder as unknown as NodeJS.WritableStream);

  const trackTypes = new Map<number, number>();
  let audioTrack: number | undefined;
  let currentTrackNumber: number | undefined;

  const queue: Uint8Array[] = [];
  let done = false;
  let wake: (() => void) | undefined;

  const notify = () => {
    if (wake) {
      const resolve = wake;
      wake = undefined;
      resolve();
    }
  };

  const finish = () => {
    clearTimeout(timer);
    done = true;
    notify();
  };
  const timer = setTimeout(finish, captureMs);

  decoder.on('data', ([tag, elm]: [string, Record<string, unknown>]) => {
    if (tag === 'tag' && elm.name === 'TrackNumber') {
      currentTrackNumber = elm.value as number;
    } else if (tag === 'tag' && elm.name === 'TrackType') {
      if (currentTrackNumber !== undefined) trackTypes.set(currentTrackNumber, elm.value as number);
      if (elm.value === 2) audioTrack = currentTrackNumber;
    } else if (tag === 'tag' && elm.name === 'CodecID') {
      console.log(`[timing] TrackEntry CodecID=${elm.value} for track ${currentTrackNumber}`);
    } else if (tag === 'tag' && (elm.name === 'SimpleBlock' || elm.name === 'Block')) {
      const track = elm.track as number;
      if (audioTrack === undefined || track === audioTrack) {
        queue.push(elm.payload as Uint8Array);
        notify();
      }
    }
  });

  decoder.on('end', finish);
  decoder.on('error', finish);

  try {
    while (!done || queue.length > 0) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        continue;
      }
      yield queue.shift() as Uint8Array;
    }
  } finally {
    clearTimeout(timer);
    decoder.removeAllListeners();
    payload.destroy();
  }
}

async function detectLanguageAndTranscript(
  frames: AsyncIterable<Uint8Array>,
  transcribe: TranscribeStreamingClient,
): Promise<{ languageCode: string; transcript: string; frameCount: number }> {
  let frameCount = 0;
  let stopFeeding = false;
  let silenceTimer: NodeJS.Timeout | undefined;

  const armSilenceTimer = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      stopFeeding = true;
    }, silenceStopMs);
  };

  async function* toAudioStream(): AsyncGenerator<AudioStream> {
    for await (const frame of frames) {
      frameCount += 1;
      yield { AudioEvent: { AudioChunk: frame } };
      if (stopFeeding) return;
    }
  }

  const response = await transcribe.send(
    new StartStreamTranscriptionCommand({
      IdentifyLanguage: true,
      LanguageOptions: languageOptions,
      MediaSampleRateHertz: sampleRateHertz,
      MediaEncoding: 'pcm',
      AudioStream: toAudioStream(),
    }),
  );

  let languageCode = '';
  let transcript = '';

  try {
    for await (const event of response.TranscriptResultStream ?? []) {
      const results = event.TranscriptEvent?.Transcript?.Results ?? [];
      for (const result of results) {
        if (result.IsPartial) continue;
        if (result.LanguageCode) {
          const score = result.LanguageIdentification?.find((c) => c.LanguageCode === result.LanguageCode)?.Score ?? 0;
          if (score >= languageConfidenceThreshold) languageCode = result.LanguageCode;
        }
        const alternative = result.Alternatives?.[0]?.Transcript;
        if (alternative) {
          transcript = alternative;
          armSilenceTimer();
        }
      }
    }
  } finally {
    clearTimeout(silenceTimer);
  }

  return { languageCode, transcript, frameCount };
}

export const handler = async (event: SpikeEvent): Promise<SpikeResult> => {
  const start = Date.now();
  const elapsed = () => `${Date.now() - start}ms`;

  const { StreamARN: streamArn } = event.Details.ContactData.MediaStreams.Customer.Audio;
  const contactId = event.Details.ContactData.ContactId;

  const kinesisVideo = new KinesisVideoClient({});
  const { DataEndpoint } = await kinesisVideo.send(
    new GetDataEndpointCommand({ StreamARN: streamArn, APIName: 'GET_MEDIA' }),
  );
  console.log(`[timing] GetDataEndpoint done at ${elapsed()}`);

  const kinesisVideoMedia = new KinesisVideoMediaClient({ endpoint: DataEndpoint });
  const { Payload } = await kinesisVideoMedia.send(
    new GetMediaCommand({
      StreamARN: streamArn,
      StartSelector: { StartSelectorType: 'NOW' },
    }),
  );
  console.log(`[timing] GetMedia opened at ${elapsed()}`);

  const frames = captureAudioFrames(Payload as Readable, audioCaptureMs);

  const transcribe = new TranscribeStreamingClient({});
  const { languageCode, transcript, frameCount } = await detectLanguageAndTranscript(frames, transcribe);
  console.log(`[timing] detectLanguageAndTranscript done at ${elapsed()}: ${frameCount} frames, languageCode=${languageCode} transcript=${JSON.stringify(transcript)}`);

  if (!transcript || !languageCode) {
    console.log(`[timing] no transcript or no confident language, skipping RecognizeText`);
    return { languageCode: '', transcript: '', lexMessage: '', sessionState: undefined };
  }

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
  console.log(`[timing] RecognizeText done at ${elapsed()}`);

  return {
    languageCode,
    transcript,
    lexMessage: recognized.messages?.[0]?.content ?? '',
    sessionState: recognized.sessionState,
  };
};
