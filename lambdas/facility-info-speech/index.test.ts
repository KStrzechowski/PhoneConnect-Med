import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNSClient } from '@aws-sdk/client-sns';
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

const otpIntentEvent = (otpCode: string, sessionAttributes: Record<string, string> = {}) => ({
  ...sampleEvent,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'OtpIntent',
      slots: { otpCode: { value: { interpretedValue: otpCode } } },
    },
  },
});

const bookingIntentEvent = (
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook',
  slots: Record<string, string | null>,
  sessionAttributes: Record<string, string> = {},
) => ({
  ...sampleEvent,
  invocationSource,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'BookingIntent',
      slots: Object.fromEntries(
        Object.entries(slots).map(([key, value]) => [key, value === null ? null : { value: { interpretedValue: value } }]),
      ),
    },
  },
});

const mockFetchSequence = (bodies: object[]) => {
  let i = 0;
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(bodies[i++])));
};

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
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  const result = await handler(authIntentEvent('90010112345', '+48000000000'));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Dziękuję. Tożsamość została potwierdzona.');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
});

test('AuthIntent sends the code and starts an OTP challenge when the pair matches no record', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: false })));
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(authIntentEvent('00000000000', '+48000000000'));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Kod weryfikacyjny został wysłany na podany numer telefonu.');
  assert.equal(result.sessionState.sessionAttributes.otpRequired, 'true');
  assert.equal(result.sessionState.sessionAttributes.isDemo, 'false');
  assert.equal(result.sessionState.sessionAttributes.code, '');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
  assert.equal(send.mock.callCount(), 1);
});

test('AuthIntent sends a fresh code and speaks the byte-identical neutral message when the pair matches but from a different number', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(authIntentEvent('90010112345', '+48000000000', { callerNumber: '+48111111111' }));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Kod weryfikacyjny został wysłany na podany numer telefonu.');
  assert.equal(result.sessionState.sessionAttributes.otpRequired, 'true');
  assert.equal(result.sessionState.sessionAttributes.isDemo, 'false');
  assert.equal(result.sessionState.sessionAttributes.phone, '+48000000000');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
  assert.match(result.sessionState.sessionAttributes.code, /^\d{6}$/);
  assert.equal(send.mock.callCount(), 1);
});

test('AuthIntent uses the seeded fixed code and sends nothing for a demo match', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 2, firstName: 'Anna', lastName: 'Demo', isDemo: true, demoOtpCode: '123456' }),
      ),
  );
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(authIntentEvent('85050512345', '+48999999999', { callerNumber: '+48111111111' }));
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.isDemo, 'true');
  assert.equal(result.sessionState.sessionAttributes.code, '123456');
  assert.equal(result.sessionState.sessionAttributes.phone, '');
  assert.equal(send.mock.callCount(), 0);
});

test('AuthIntent still returns the code when the initial SNS publish fails', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  mock.method(SNSClient.prototype, 'send', async () => {
    throw new Error('sns unavailable');
  });
  const result = await handler(authIntentEvent('90010112345', '+48000000000', { callerNumber: '+48111111111' }));
  mock.restoreAll();

  assert.equal(result.messages[0].content, 'Kod weryfikacyjny został wysłany na podany numer telefonu.');
  assert.match(result.sessionState.sessionAttributes.code, /^\d{6}$/);
});

test('OtpIntent authenticates and stamps the otp auth path on a correct real code', async () => {
  const result = await handler(
    otpIntentEvent('654321', { code: '654321', isDemo: 'false', phone: '+48000000000', patientId: '1' }),
  );

  assert.equal(result.messages[0].content, 'Dziękuję. Tożsamość została potwierdzona.');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
});

test('OtpIntent authenticates and stamps the demo auth path on a correct demo code', async () => {
  const result = await handler(
    otpIntentEvent('123456', { code: '123456', isDemo: 'true', phone: '', patientId: '2' }),
  );

  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '2');
});

test('OtpIntent signals a mismatch on a wrong code without authenticating', async () => {
  const result = await handler(
    otpIntentEvent('000000', { code: '654321', isDemo: 'false', phone: '+48000000000', patientId: '1' }),
  );

  assert.equal(result.sessionState.sessionAttributes.otpMismatch, 'true');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent never authenticates when no code was ever actually issued', async () => {
  const result = await handler(
    otpIntentEvent('000000', { code: '', isDemo: 'false', phone: '', patientId: '' }),
  );

  assert.equal(result.sessionState.sessionAttributes.otpMismatch, 'true');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent resends a fresh code for a real challenge without consuming an attempt', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(
    otpIntentEvent('9', { code: '654321', isDemo: 'false', phone: '+48000000000', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(send.mock.callCount(), 1);
  assert.match(result.sessionState.sessionAttributes.code, /^\d{6}$/);
  assert.notEqual(result.sessionState.sessionAttributes.code, '654321');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
  assert.equal('otpMismatch' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent resend does not publish for a demo challenge', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(otpIntentEvent('9', { code: '123456', isDemo: 'true', phone: '', patientId: '2' }));
  mock.restoreAll();

  assert.equal(send.mock.callCount(), 0);
  assert.equal(result.sessionState.sessionAttributes.code, '123456');
});

test('BookingIntent dialog hook needs auth before eliciting anything', async () => {
  const result = await handler(
    bookingIntentEvent('DialogCodeHook', { specialty: null, timeOfDay: null }, { authenticated: 'false' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.needsAuth, 'true');
});

test('BookingIntent dialog hook delegates to Lex while specialty/timeOfDay are still unfilled', async () => {
  const result = await handler(
    bookingIntentEvent('DialogCodeHook', { specialty: 'kardiolog', timeOfDay: null }, { authenticated: 'true' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Delegate');
});

test('BookingIntent dialog hook offers days once specialty and time of day are filled', async () => {
  mockFetchSequence([{ days: ['2026-09-04', '2026-09-07'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'day');
  assert.match(result.messages[0].content, /Który termin/);
});

test('BookingIntent dialog hook re-elicits specialty when no days are available, without transferring on the first miss', async () => {
  mockFetchSequence([{ days: [] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'reumatolog', timeOfDay: 'rano' },
      { authenticated: 'true', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'specialty');
  assert.equal(result.sessionState.sessionAttributes.bookingAttempts, '1');
  assert.equal('transfer' in result.sessionState.sessionAttributes, false);
});

test('BookingIntent dialog hook transfers after the third consecutive no-availability outcome', async () => {
  mockFetchSequence([{ days: [] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'reumatolog', timeOfDay: 'rano' },
      { authenticated: 'true', bookingAttempts: '2' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('BookingIntent dialog hook resolves the chosen day and offers times', async () => {
  mockFetchSequence([{ days: ['2026-09-04', '2026-09-07'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano', selectedSlot: '2' },
      { authenticated: 'true', bookingStage: 'day', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'time');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-07');
  assert.match(result.messages[0].content, /09:30/);
});

test('BookingIntent dialog hook re-elicits the day choice when it does not resolve', async () => {
  mockFetchSequence([{ days: ['2026-09-04'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano', selectedSlot: '9' },
      { authenticated: 'true', bookingStage: 'day', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingAttempts, '1');
});

test('BookingIntent dialog hook resolves the chosen time and asks for confirmation', async () => {
  mockFetchSequence([{ times: ['08:00', '09:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano', selectedSlot: '2' },
      { authenticated: 'true', bookingStage: 'time', bookingDate: '2026-09-07', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'confirm');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '09:30');
  assert.match(result.messages[0].content, /kardiolog/);
  assert.match(result.messages[0].content, /09:30/);
});

test('BookingIntent dialog hook offers fresh days again after a decline (bookingStage confirm)', async () => {
  mockFetchSequence([{ days: ['2026-09-04'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano', selectedSlot: null },
      { authenticated: 'true', bookingStage: 'confirm', bookingDate: '2026-09-07', bookingTime: '09:30' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'day');
});

test('BookingIntent fulfillment books the resolved slot and confirms', async () => {
  mockFetchSequence([{ booked: true }]);
  const result = await handler(
    bookingIntentEvent(
      'FulfillmentCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano' },
      { authenticated: 'true', patientId: '1', bookingDate: '2026-09-07', bookingTime: '09:30' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(result.messages[0].content, /umówiona/);
});

test('BookingIntent fulfillment reports a clean failure when the slot was taken in the meantime', async () => {
  mockFetchSequence([{ booked: false }]);
  const result = await handler(
    bookingIntentEvent(
      'FulfillmentCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano' },
      { authenticated: 'true', patientId: '1', bookingDate: '2026-09-07', bookingTime: '09:30' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal('transfer' in result.sessionState.sessionAttributes, false);
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
