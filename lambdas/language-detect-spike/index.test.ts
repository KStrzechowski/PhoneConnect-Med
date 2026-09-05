import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localeIdForLanguageCode, buildRecognizeTextInput } from './index.ts';

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
