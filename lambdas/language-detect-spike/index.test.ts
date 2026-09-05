import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { localeIdForLanguageCode, buildRecognizeTextInput, captureAudioFrames } from './index.ts';

const ebmlIds = {
  Segment: 0x18538067,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  Cluster: 0x1f43b675,
  SimpleBlock: 0xa3,
};

function vint(value: number): Buffer {
  if (value < 0x80) return Buffer.from([0x80 | value]);
  if (value < 0x4000) return Buffer.from([0x40 | (value >> 8), value & 0xff]);
  throw new Error('vint too large for this test fixture');
}

function element(id: number, content: Buffer): Buffer {
  const idByteLength = Math.max(1, Math.floor(Math.log2(id) / 8) + 1);
  const idBytes = Buffer.alloc(idByteLength);
  for (let i = 0; i < idByteLength; i += 1) idBytes[idByteLength - 1 - i] = (id >> (8 * i)) & 0xff;
  return Buffer.concat([idBytes, vint(content.length), content]);
}

function trackEntry(trackNumber: number, trackType: number): Buffer {
  return element(
    ebmlIds.TrackEntry,
    Buffer.concat([
      element(ebmlIds.TrackNumber, Buffer.from([trackNumber])),
      element(ebmlIds.TrackType, Buffer.from([trackType])),
    ]),
  );
}

function simpleBlock(track: number, payload: Buffer): Buffer {
  return element(ebmlIds.SimpleBlock, Buffer.concat([Buffer.from([0x80 | track, 0x00, 0x00, 0x00]), payload]));
}

function syntheticFragment(): Buffer {
  const tracks = element(ebmlIds.Tracks, Buffer.concat([trackEntry(1, 1), trackEntry(2, 2)]));
  const cluster = element(
    ebmlIds.Cluster,
    Buffer.concat([
      simpleBlock(1, Buffer.from('videoframe')),
      simpleBlock(2, Buffer.from('audioframe1')),
      simpleBlock(2, Buffer.from('audioframe2')),
    ]),
  );
  return element(ebmlIds.Segment, Buffer.concat([tracks, cluster]));
}

test('maps en-US to the en_US locale', () => {
  assert.equal(localeIdForLanguageCode('en-US'), 'en_US');
});

test('maps pl-PL, and anything else, to the pl_PL locale', () => {
  assert.equal(localeIdForLanguageCode('pl-PL'), 'pl_PL');
  assert.equal(localeIdForLanguageCode('unknown'), 'pl_PL');
});

test('builds a RecognizeText request carrying the contact id as the session id', () => {
  const input = buildRecognizeTextInput({
    botId: 'bot-1',
    botAliasId: 'alias-1',
    localeId: 'en_US',
    sessionId: 'contact-123',
    text: 'I would like to book an appointment',
  });

  assert.deepEqual(input, {
    botId: 'bot-1',
    botAliasId: 'alias-1',
    localeId: 'en_US',
    sessionId: 'contact-123',
    text: 'I would like to book an appointment',
  });
});

test('captureAudioFrames extracts only the audio track\'s SimpleBlock payloads, ignoring video', async () => {
  const frames = await captureAudioFrames(Readable.from([syntheticFragment()]), 5000);

  assert.deepEqual(
    frames.map((frame) => Buffer.from(frame).toString()),
    ['audioframe1', 'audioframe2'],
  );
});

test('captureAudioFrames stops without reading past an exhausted deadline', async () => {
  const frames = await captureAudioFrames(Readable.from([syntheticFragment()]), -1);

  assert.deepEqual(frames, []);
});
