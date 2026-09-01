import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from './index.ts';
import type { InvocationRecord } from '@pcm/measure';

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const sampleFacility = {
  name: 'Przychodnia Zdrowie',
  address: 'ul. Kwiatowa 12, 00-001 Warszawa',
  opensAt: '08:00',
  closesAt: '18:00',
  openDays: 'monday-friday',
};

const eventFor = (intentName: string, sessionAttributes: Record<string, string> = {}) => ({
  ...sampleEvent,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: { ...sampleEvent.sessionState.intent, name: intentName },
  },
});

const authIntentEvent = (
  pesel: string,
  phone: string,
  sessionAttributes: Record<string, string> = {},
) => ({
  ...sampleEvent,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', callerNumber: '+48000000000', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'AuthIntent',
      slots: {
        pesel: { value: { interpretedValue: pesel } },
        phone: { value: { interpretedValue: phone } },
      },
    },
  },
});

const captureRecords = () => {
  const logged: InvocationRecord[] = [];
  mock.method(console, 'log', (record: InvocationRecord) => void logged.push(record));
  return () => logged.filter((record) => record.kind === 'invocation');
};

test('InfoIntent returns the byte-identical facility sentence', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const result = await handler(eventFor('InfoIntent'));
  mock.restoreAll();

  assert.equal(
    result.messages[0].content,
    'Nasz adres to ul. Kwiatowa 12, 00-001 Warszawa. Jesteśmy czynni od 08:00 do 18:00, monday-friday.',
  );
  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.intent.name, 'InfoIntent');
  assert.equal(result.sessionState.sessionAttributes.fallbackCount, '0');
});

test('RepeatLastMessageIntent echoes the last spoken message', async () => {
  const result = await handler(eventFor('RepeatLastMessageIntent', { lastMessageText: 'poprzednia wiadomość' }));

  assert.equal(result.messages[0].content, 'poprzednia wiadomość');
});

test('AgentTransferIntent returns a connecting message', async () => {
  const result = await handler(eventFor('AgentTransferIntent'));

  assert.equal(result.messages[0].content, 'Już łączę z konsultantem.');
});

test('FallbackIntent escalates across three consecutive invocations', async () => {
  const first = await handler(eventFor('FallbackIntent', { fallbackCount: '0' }));
  const second = await handler(eventFor('FallbackIntent', { fallbackCount: '1' }));
  const third = await handler(eventFor('FallbackIntent', { fallbackCount: '2' }));

  assert.equal(first.sessionState.sessionAttributes.fallbackCount, '1');
  assert.equal(second.sessionState.sessionAttributes.fallbackCount, '2');
  assert.equal(third.sessionState.sessionAttributes.fallbackCount, '3');

  const messages = [first, second, third].map((response) => response.messages[0].content);
  assert.equal(new Set(messages).size, 3);
});

test('a non-FallbackIntent invocation resets the fallback counter to 0', async () => {
  const result = await handler(eventFor('AgentTransferIntent', { fallbackCount: '2' }));

  assert.equal(result.sessionState.sessionAttributes.fallbackCount, '0');
});

test('AuthIntent confirms and sets session attributes when the pair matches from the declared number', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' })),
  );
  const result = await handler(authIntentEvent('90010112345', '+48000000000'));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Dziękuję. Tożsamość została potwierdzona.');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
});

test('AuthIntent speaks the neutral message and signals a transfer when the pair matches no record', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: false })));
  const result = await handler(authIntentEvent('00000000000', '+48000000000'));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Kod weryfikacyjny został wysłany na podany numer telefonu.');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
});

test('AuthIntent speaks the byte-identical neutral message when the pair matches but from a different number', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' })),
  );
  const result = await handler(authIntentEvent('90010112345', '+48000000000', { callerNumber: '+48111111111' }));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Kod weryfikacyjny został wysłany na podany numer telefonu.');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('emits exactly one measurement record, carrying variant and contactId', async () => {
  const records = captureRecords();
  await handler(eventFor('AgentTransferIntent'));
  mock.restoreAll();

  const [record, ...rest] = records();
  assert.equal(rest.length, 0);
  assert.equal(record.handler, 'facility-info-speech');
  assert.equal(record.variant, 'speech');
  assert.equal(record.contactId, 'contact-1');
});
