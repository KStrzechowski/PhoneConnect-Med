import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SNSClient } from '@aws-sdk/client-sns';
import { ssmlTime, ssmlOpeningHour } from '@pcm/appointment';
import { openDaysEn, ssmlAddress } from '@pcm/facility';
import { handler } from './index.ts';
import type { InvocationRecord } from '@pcm/measure';

const messageOf = (result: Awaited<ReturnType<typeof handler>>): string =>
  (result as { messages: [{ content: string }] }).messages[0].content;

const contentTypeOf = (result: Awaited<ReturnType<typeof handler>>): string =>
  (result as { messages: [{ contentType: string }] }).messages[0].contentType;

const intentNameOf = (result: Awaited<ReturnType<typeof handler>>): string =>
  (result as { sessionState: { intent: { name: string } } }).sessionState.intent.name;

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const sampleFacility = {
  name: 'Przychodnia Zdrowie',
  address: 'ul. Kwiatowa 12, 00-001 Warszawa',
  opensAt: '08:00',
  closesAt: '18:00',
  openDays: 'poniedziałek-piątek',
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
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
) => ({
  ...sampleEvent,
  invocationSource,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'BookingIntent',
      ...(confirmationState ? { confirmationState } : {}),
      slots: Object.fromEntries(
        Object.entries(slots).map(([key, value]) => [key, value === null ? null : { value: { interpretedValue: value } }]),
      ),
    },
  },
});

const cancelIntentEvent = (
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook',
  slots: Record<string, string | null>,
  sessionAttributes: Record<string, string> = {},
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
) => ({
  ...sampleEvent,
  invocationSource,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'CancelAppointmentIntent',
      ...(confirmationState ? { confirmationState } : {}),
      slots: Object.fromEntries(
        Object.entries(slots).map(([key, value]) => [key, value === null ? null : { value: { interpretedValue: value } }]),
      ),
    },
  },
});

const rescheduleIntentEvent = (
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook',
  slots: Record<string, string | null>,
  sessionAttributes: Record<string, string> = {},
  confirmationState?: 'None' | 'Confirmed' | 'Denied',
) => ({
  ...sampleEvent,
  invocationSource,
  sessionState: {
    ...sampleEvent.sessionState,
    sessionAttributes: { contactId: 'contact-1', ...sessionAttributes },
    intent: {
      ...sampleEvent.sessionState.intent,
      name: 'RescheduleIntent',
      ...(confirmationState ? { confirmationState } : {}),
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
    messageOf(result),
    `<speak>Nasz adres to ${ssmlAddress('ul. Kwiatowa 12, 00-001 Warszawa')}. Jesteśmy czynni od ${ssmlOpeningHour('08:00')} do ${ssmlOpeningHour('18:00')}, poniedziałek-piątek.</speak>`,
  );
  assert.equal(contentTypeOf(result), 'SSML');
  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(intentNameOf(result), 'InfoIntent');
  assert.equal(result.sessionState.sessionAttributes.fallbackCount, '0');
});

test('InfoIntent returns an English facility sentence when the bot locale is en_US', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const result = await handler({ ...eventFor('InfoIntent'), bot: { ...sampleEvent.bot, localeId: 'en_US' } });
  mock.restoreAll();

  assert.equal(
    messageOf(result),
    `<speak>Our address is ${ssmlAddress('ul. Kwiatowa 12, 00-001 Warszawa', 'en')}. We are open from ${ssmlOpeningHour('08:00', 'en')} to ${ssmlOpeningHour('18:00', 'en')}, ${openDaysEn['poniedziałek-piątek']}.</speak>`,
  );
});

test('RepeatLastMessageIntent echoes the last spoken message', async () => {
  const result = await handler(eventFor('RepeatLastMessageIntent', { lastMessageText: 'poprzednia wiadomość' }));

  assert.equal(messageOf(result), '<speak>poprzednia wiadomość</speak>');
});

test('AgentTransferIntent returns a connecting message', async () => {
  const result = await handler(eventFor('AgentTransferIntent'));

  assert.equal(messageOf(result), '<speak>Już łączę z konsultantem.</speak>');
  assert.equal(result.sessionState.sessionAttributes.agentRequested, 'true');
});

test('FallbackIntent escalates across three consecutive invocations', async () => {
  const first = await handler(eventFor('FallbackIntent', { fallbackCount: '0' }));
  const second = await handler(eventFor('FallbackIntent', { fallbackCount: '1' }));
  const third = await handler(eventFor('FallbackIntent', { fallbackCount: '2' }));

  assert.equal(first.sessionState.sessionAttributes.fallbackCount, '1');
  assert.equal(second.sessionState.sessionAttributes.fallbackCount, '2');
  assert.equal(third.sessionState.sessionAttributes.fallbackCount, '3');

  const messages = [first, second, third].map(messageOf);
  assert.equal(new Set(messages).size, 3);
});

test('a non-FallbackIntent invocation resets the fallback counter to 0', async () => {
  const result = await handler(eventFor('AgentTransferIntent', { fallbackCount: '2' }));

  assert.equal(result.sessionState.sessionAttributes.fallbackCount, '0');
});

test('AuthIntent delegates back to Lex instead of authenticating when only the pesel slot is filled', async () => {
  const fetchSpy = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: true })));
  const result = await handler(authIntentEvent('90010112345', ''));
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Delegate');
  assert.equal(fetchSpy.mock.callCount(), 0);
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

  assert.equal(messageOf(result), '<speak>Dziękuję. Tożsamość została potwierdzona.</speak>');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
  assert.equal(result.sessionState.sessionAttributes.firstName, 'Jan');
  assert.equal(result.sessionState.sessionAttributes.lastName, 'Kowalski');
  assert.equal(result.sessionState.sessionAttributes.pesel, '90010112345');
  assert.equal(result.sessionState.sessionAttributes.phone, '+48000000000');
});

test('AuthIntent resumes the pending BookingIntent flow directly after a caller-id shortcut', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  const result = await handler(authIntentEvent('90010112345', '+48000000000', { pendingIntent: 'BookingIntent' }));
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Delegate');
  assert.equal(intentNameOf(result), 'BookingIntent');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal('pendingIntent' in result.sessionState.sessionAttributes, false);
});

test('AuthIntent sends the code and starts an OTP challenge when the pair matches no record', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: false })));
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(authIntentEvent('00000000000', '+48000000000'));
  mock.restoreAll();

  assert.equal(messageOf(result), '<speak>Kod weryfikacyjny został wysłany na podany numer telefonu. Wprowadź otrzymany kod na klawiaturze telefonu, a następnie naciśnij krzyżyk. Aby otrzymać nowy kod, naciśnij dziewięć.</speak>');
  assert.equal(result.sessionState.sessionAttributes.otpRequired, 'true');
  assert.equal(result.sessionState.sessionAttributes.isDemo, 'false');
  assert.equal(result.sessionState.sessionAttributes.code, '');
  assert.equal(result.sessionState.sessionAttributes.firstName, '');
  assert.equal(result.sessionState.sessionAttributes.lastName, '');
  assert.equal(result.sessionState.sessionAttributes.pesel, '00000000000');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
  assert.equal(send.mock.callCount(), 0);
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

  assert.equal(messageOf(result), '<speak>Kod weryfikacyjny został wysłany na podany numer telefonu. Wprowadź otrzymany kod na klawiaturze telefonu, a następnie naciśnij krzyżyk. Aby otrzymać nowy kod, naciśnij dziewięć.</speak>');
  assert.equal(result.sessionState.sessionAttributes.otpRequired, 'true');
  assert.equal(result.sessionState.sessionAttributes.isDemo, 'false');
  assert.equal(result.sessionState.sessionAttributes.phone, '+48000000000');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
  assert.match(result.sessionState.sessionAttributes.code, /^\d{6}$/);
  assert.equal(result.sessionState.sessionAttributes.firstName, 'Jan');
  assert.equal(result.sessionState.sessionAttributes.lastName, 'Kowalski');
  assert.equal(result.sessionState.sessionAttributes.pesel, '90010112345');
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
  assert.equal(result.sessionState.sessionAttributes.firstName, 'Anna');
  assert.equal(result.sessionState.sessionAttributes.lastName, 'Demo');
  assert.equal(result.sessionState.sessionAttributes.pesel, '85050512345');
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

  assert.equal(messageOf(result), '<speak>Kod weryfikacyjny został wysłany na podany numer telefonu. Wprowadź otrzymany kod na klawiaturze telefonu, a następnie naciśnij krzyżyk. Aby otrzymać nowy kod, naciśnij dziewięć.</speak>');
  assert.match(result.sessionState.sessionAttributes.code, /^\d{6}$/);
});

test('OtpIntent authenticates and stamps the otp auth path on a correct real code', async () => {
  const result = await handler(
    otpIntentEvent('654321', { code: '654321', isDemo: 'false', phone: '+48000000000', patientId: '1' }),
  );

  assert.equal(messageOf(result), '<speak>Dziękuję. Tożsamość została potwierdzona.</speak>');
  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '1');
});

test('OtpIntent resumes the pending CancelAppointmentIntent flow directly after a correct code', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(JSON.stringify({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] })),
  );
  const result = await handler(
    otpIntentEvent('654321', {
      code: '654321',
      isDemo: 'false',
      phone: '+48000000000',
      patientId: '1',
      pendingIntent: 'CancelAppointmentIntent',
    }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(intentNameOf(result), 'CancelAppointmentIntent');
  assert.match(messageOf(result), /kardiolog/);
  assert.equal('pendingIntent' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent authenticates and stamps the demo auth path on a correct demo code', async () => {
  const result = await handler(
    otpIntentEvent('123456', { code: '123456', isDemo: 'true', phone: '', patientId: '2' }),
  );

  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.patientId, '2');
});

test('OtpIntent re-elicits the code on a wrong entry without authenticating', async () => {
  const result = await handler(
    otpIntentEvent('000000', { code: '654321', isDemo: 'false', phone: '+48000000000', patientId: '1' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'otpCode');
  assert.equal(result.sessionState.sessionAttributes.otpAttempts, '1');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent never authenticates when no code was ever actually issued', async () => {
  const result = await handler(
    otpIntentEvent('000000', { code: '', isDemo: 'false', phone: '', patientId: '' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal('authenticated' in result.sessionState.sessionAttributes, false);
});

test('OtpIntent transfers to an agent after the third consecutive wrong code', async () => {
  const result = await handler(
    otpIntentEvent('000000', {
      code: '654321',
      isDemo: 'false',
      phone: '+48000000000',
      patientId: '1',
      otpAttempts: '2',
    }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
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
  assert.equal(result.sessionState.sessionAttributes.otpAttempts, '0');
});

test('OtpIntent resend does not publish when no phone was ever captured', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(otpIntentEvent('9', { code: '', isDemo: 'false', phone: '', patientId: '' }));
  mock.restoreAll();

  assert.equal(send.mock.callCount(), 0);
});

test('OtpIntent resend does not publish for a demo challenge', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(otpIntentEvent('9', { code: '123456', isDemo: 'true', phone: '', patientId: '2' }));
  mock.restoreAll();

  assert.equal(send.mock.callCount(), 0);
  assert.equal(result.sessionState.sessionAttributes.code, '123456');
});

test('OtpIntent resend clears a stale attempt count from previous wrong entries', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler(
    otpIntentEvent('9', {
      code: '654321',
      isDemo: 'false',
      phone: '+48000000000',
      patientId: '1',
      otpAttempts: '2',
    }),
  );
  mock.restoreAll();

  assert.equal(send.mock.callCount(), 1);
  assert.equal(result.sessionState.sessionAttributes.otpAttempts, '0');
});

test('OtpIntent success clears a stale otpRequired flag so a later turn does not re-enter OTP', async () => {
  const result = await handler(
    otpIntentEvent('654321', {
      code: '654321',
      isDemo: 'false',
      phone: '+48000000000',
      patientId: '1',
      otpRequired: 'true',
    }),
  );

  assert.equal(result.sessionState.sessionAttributes.authenticated, 'true');
  assert.equal(result.sessionState.sessionAttributes.otpRequired, '');
});

test('BookingIntent dialog hook needs auth before eliciting anything', async () => {
  const result = await handler(
    bookingIntentEvent('DialogCodeHook', { specialty: null, timeOfDay: null }, { authenticated: 'false' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'BookingIntent');
});

test('BookingIntent dialog hook delegates to Lex while specialty is still unfilled', async () => {
  const result = await handler(
    bookingIntentEvent('DialogCodeHook', { specialty: null }, { authenticated: 'true' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Delegate');
});

test('BookingIntent dialog hook proposes the nearest available slot when no date is given', async () => {
  mockFetchSequence([{ nearest: { date: '2026-09-07', time: '09:30' } }]);
  const result = await handler(
    bookingIntentEvent('DialogCodeHook', { specialty: 'kardiolog' }, { authenticated: 'true' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'confirm');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-07');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '09:30');
  assert.match(messageOf(result), /Najbliższy wolny termin/);
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
});

test('BookingIntent dialog hook re-elicits specialty when nothing is available anywhere, without transferring on the first miss', async () => {
  mockFetchSequence([{ nearest: null }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'reumatolog' },
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
  mockFetchSequence([{ nearest: null }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'reumatolog' },
      { authenticated: 'true', bookingAttempts: '2' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('BookingIntent dialog hook searches a specific date and confirms directly when exactly one time is free', async () => {
  mockFetchSequence([{ times: ['09:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'confirm');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-07');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '09:30');
});

test('BookingIntent dialog hook searches a specific date and offers a numbered list when multiple times are free', async () => {
  mockFetchSequence([{ times: ['08:00', '09:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'time');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-07');
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
});

test('BookingIntent dialog hook falls back to the nearest slot when the given date has nothing free', async () => {
  mockFetchSequence([{ times: [] }, { nearest: { date: '2026-09-10', time: '08:00' } }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-10');
  assert.match(messageOf(result), /Najbliższy wolny termin/);
});

test('BookingIntent dialog hook filters a given date down to times at or after the requested preferredTime', async () => {
  mockFetchSequence([{ times: ['08:00', '09:30', '16:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07', preferredTime: '16:00' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '16:30');
});

test('BookingIntent dialog hook proposes the nearest slot at or after preferredTime when no date is given', async () => {
  const fetchSpy = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ nearest: { date: '2026-09-07', time: '16:30' } })),
  );
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredTime: '16:00' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.bookingTime, '16:30');
  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('minTime=16%3A00'), true);
});

test('BookingIntent dialog hook filters a given date down to times at or before preferredTimeBefore', async () => {
  mockFetchSequence([{ times: ['08:00', '09:30', '16:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07', preferredTimeBefore: '10:00' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.match(messageOf(result), new RegExp(ssmlTime('08:00')));
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
  assert.doesNotMatch(messageOf(result), new RegExp(ssmlTime('16:30')));
});

test('BookingIntent dialog hook proposes the nearest slot at or before preferredTimeBefore when no date is given', async () => {
  const fetchSpy = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ nearest: { date: '2026-09-07', time: '09:30' } })),
  );
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredTimeBefore: '10:00' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.bookingTime, '09:30');
  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('maxTime=10%3A00'), true);
  assert.equal(url.includes('minTime'), false);
});

test('BookingIntent dialog hook translates a time-of-day word into a time window for a given date', async () => {
  mockFetchSequence([{ times: ['08:00', '13:00', '15:00'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-07', preferredTimeOfDay: 'rano' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '08:00');
});

test('BookingIntent dialog hook translates a time-of-day word into a min/max window when no date is given', async () => {
  const fetchSpy = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ nearest: { date: '2026-09-07', time: '18:30' } })),
  );
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredTimeOfDay: 'wieczorem' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.bookingTime, '18:30');
  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('minTime=18%3A00'), true);
  assert.equal(url.includes('maxTime=21%3A59'), true);
});

test('BookingIntent dialog hook prefers an explicit preferredTime over the time-of-day window', async () => {
  const fetchSpy = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ nearest: { date: '2026-09-07', time: '09:00' } })),
  );
  await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredTime: '07:00', preferredTimeOfDay: 'rano' },
      { authenticated: 'true' },
    ),
  );
  mock.restoreAll();

  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('minTime=07%3A00'), true);
  assert.equal(url.includes('maxTime=11%3A59'), true);
});

test('BookingIntent dialog hook resolves a numbered time choice and asks for confirmation', async () => {
  mockFetchSequence([{ times: ['08:00', '09:30'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', selectedSlot: '2' },
      { authenticated: 'true', bookingStage: 'time', bookingDate: '2026-09-07', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, 'confirm');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '09:30');
  assert.match(messageOf(result), /kardiolog/);
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
});

test('BookingIntent dialog hook re-elicits the numbered choice when it does not resolve', async () => {
  mockFetchSequence([{ times: ['08:00'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', selectedSlot: '9' },
      { authenticated: 'true', bookingStage: 'time', bookingDate: '2026-09-07', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.bookingAttempts, '1');
});

test('BookingIntent dialog hook treats a stale bookingStage as fresh once a decline has cleared selectedSlot', async () => {
  mockFetchSequence([{ nearest: { date: '2026-09-08', time: '08:00' } }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', selectedSlot: null },
      { authenticated: 'true', bookingStage: 'time', bookingDate: '2026-09-07', bookingAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.match(messageOf(result), /Najbliższy wolny termin/);
});

test('BookingIntent dialog hook forwards straight to fulfillment when the caller confirms', async () => {
  mockFetchSequence([{ booked: true }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog' },
      { authenticated: 'true', patientId: '1', bookingDate: '2026-09-07', bookingTime: '09:30', bookingStage: 'confirm' },
      'Confirmed',
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /umówiona/);
});

test('BookingIntent dialog hook re-asks for a day when the caller declines without naming a new date', async () => {
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog' },
      { authenticated: 'true', bookingDate: '2026-09-07', bookingTime: '09:30', bookingStage: 'confirm' },
      'Denied',
    ),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'preferredDate');
  assert.equal(result.sessionState.sessionAttributes.bookingStage, '');
});

test('BookingIntent dialog hook searches the new date directly when the caller declines while naming one', async () => {
  mockFetchSequence([{ times: ['10:00'] }]);
  const result = await handler(
    bookingIntentEvent(
      'DialogCodeHook',
      { specialty: 'kardiolog', preferredDate: '2026-09-16' },
      { authenticated: 'true', bookingDate: '2026-09-07', bookingTime: '09:30', bookingStage: 'confirm' },
      'Denied',
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.bookingDate, '2026-09-16');
  assert.equal(result.sessionState.sessionAttributes.bookingTime, '10:00');
});

test('BookingIntent fulfillment needs auth before booking', async () => {
  const result = await handler(
    bookingIntentEvent(
      'FulfillmentCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano' },
      { authenticated: 'false', patientId: '1', bookingDate: '2026-09-07', bookingTime: '09:30' },
    ),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'BookingIntent');
});

test('BookingIntent fulfillment reports a clean failure when patientId is missing', async () => {
  const result = await handler(
    bookingIntentEvent(
      'FulfillmentCodeHook',
      { specialty: 'kardiolog', timeOfDay: 'rano' },
      { authenticated: 'true', bookingDate: '2026-09-07', bookingTime: '09:30' },
    ),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
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
  assert.match(messageOf(result), /umówiona/);
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

test('CancelAppointmentIntent dialog hook needs auth before listing anything', async () => {
  const result = await handler(cancelIntentEvent('DialogCodeHook', {}, { authenticated: 'false' }));

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'CancelAppointmentIntent');
});

test('CancelAppointmentIntent dialog hook closes with the empty message for a patient with no appointments', async () => {
  mockFetchSequence([{ appointments: [] }]);
  const result = await handler(
    cancelIntentEvent('DialogCodeHook', {}, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(messageOf(result), '<speak>Nie mają Państwo żadnych zaplanowanych wizyt.</speak>');
});

test('CancelAppointmentIntent dialog hook lists appointments and elicits a selection', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    cancelIntentEvent('DialogCodeHook', {}, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.cancelStage, 'select');
  assert.match(messageOf(result), /kardiolog/);
});

test('CancelAppointmentIntent dialog hook resolves the chosen appointment and asks for confirmation', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    cancelIntentEvent(
      'DialogCodeHook',
      { selectedSlot: '1' },
      { authenticated: 'true', patientId: '1', cancelStage: 'select', cancelAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.match(messageOf(result), /kardiolog/);
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
});

test('CancelAppointmentIntent dialog hook re-elicits the selection when it does not resolve', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    cancelIntentEvent(
      'DialogCodeHook',
      { selectedSlot: '9' },
      { authenticated: 'true', patientId: '1', cancelStage: 'select', cancelAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.cancelAttempts, '1');
});

test('CancelAppointmentIntent dialog hook transfers after the third consecutive unresolved selection', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    cancelIntentEvent(
      'DialogCodeHook',
      { selectedSlot: '9' },
      { authenticated: 'true', patientId: '1', cancelStage: 'select', cancelAttempts: '2' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('CancelAppointmentIntent dialog hook forwards straight to fulfillment when the caller confirms', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { cancelled: true },
  ]);
  const result = await handler(
    cancelIntentEvent('DialogCodeHook', { selectedSlot: '1' }, { authenticated: 'true', patientId: '1' }, 'Confirmed'),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /odwołana/);
});

test('CancelAppointmentIntent dialog hook leaves the appointment untouched when the caller declines', async () => {
  const result = await handler(
    cancelIntentEvent('DialogCodeHook', { selectedSlot: '1' }, { authenticated: 'true', patientId: '1' }, 'Denied'),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /bez zmian/);
  assert.equal('transfer' in result.sessionState.sessionAttributes, false);
});

test('CancelAppointmentIntent fulfillment needs auth before cancelling', async () => {
  const result = await handler(
    cancelIntentEvent('FulfillmentCodeHook', { selectedSlot: '1' }, { authenticated: 'false', patientId: '1' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'CancelAppointmentIntent');
});

test('CancelAppointmentIntent fulfillment reports a clean failure when patientId is missing', async () => {
  const result = await handler(
    cancelIntentEvent('FulfillmentCodeHook', { selectedSlot: '1' }, { authenticated: 'true' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('CancelAppointmentIntent fulfillment resolves the appointment and cancels it', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { cancelled: true },
  ]);
  const result = await handler(
    cancelIntentEvent('FulfillmentCodeHook', { selectedSlot: '1' }, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /odwołana/);
});

test('CancelAppointmentIntent fulfillment reports a clean failure when the cancellation does not go through', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { cancelled: false },
  ]);
  const result = await handler(
    cancelIntentEvent('FulfillmentCodeHook', { selectedSlot: '1' }, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal('transfer' in result.sessionState.sessionAttributes, false);
});

test('CancelAppointmentIntent fulfillment transfers when the appointment no longer resolves', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    cancelIntentEvent('FulfillmentCodeHook', { selectedSlot: '9' }, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('RescheduleIntent dialog hook needs auth before eliciting anything', async () => {
  const result = await handler(
    rescheduleIntentEvent('DialogCodeHook', { timeOfDay: null }, { authenticated: 'false' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'RescheduleIntent');
});

test('RescheduleIntent dialog hook delegates to Lex while timeOfDay is still unfilled', async () => {
  const result = await handler(
    rescheduleIntentEvent('DialogCodeHook', { timeOfDay: null }, { authenticated: 'true' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Delegate');
});

test('RescheduleIntent dialog hook closes with the empty message for a patient with no appointments', async () => {
  mockFetchSequence([{ appointments: [] }]);
  const result = await handler(
    rescheduleIntentEvent('DialogCodeHook', { timeOfDay: 'rano' }, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(messageOf(result), '<speak>Nie mają Państwo żadnych zaplanowanych wizyt.</speak>');
});

test('RescheduleIntent dialog hook lists appointments and elicits a selection', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    rescheduleIntentEvent('DialogCodeHook', { timeOfDay: 'rano' }, { authenticated: 'true', patientId: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'select');
  assert.match(messageOf(result), /kardiolog/);
});

test('RescheduleIntent dialog hook resolves the chosen appointment and offers days', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { days: ['2026-09-04', '2026-09-07'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '1' },
      { authenticated: 'true', patientId: '1', rescheduleStage: 'select', rescheduleAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'day');
  assert.equal(result.sessionState.sessionAttributes.rescheduleApptSelection, '1');
  assert.match(messageOf(result), /Mam wolne terminy/);
});

test('RescheduleIntent dialog hook re-elicits the selection when it does not resolve', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '9' },
      { authenticated: 'true', patientId: '1', rescheduleStage: 'select', rescheduleAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleAttempts, '1');
});

test('RescheduleIntent dialog hook transfers after the third consecutive unresolved selection', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '9' },
      { authenticated: 'true', patientId: '1', rescheduleStage: 'select', rescheduleAttempts: '2' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('RescheduleIntent dialog hook re-elicits timeOfDay when the resolved appointment has no availability', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'reumatolog', date: '2026-09-08', time: '09:30' }] },
    { days: [] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '1' },
      { authenticated: 'true', patientId: '1', rescheduleStage: 'select', rescheduleAttempts: '0' },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'timeOfDay');
  assert.equal(result.sessionState.sessionAttributes.rescheduleApptSelection, '1');
  assert.equal(result.sessionState.sessionAttributes.rescheduleAttempts, '1');
});

test('RescheduleIntent dialog hook offers fresh days again after a decline (rescheduleStage confirm)', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { days: ['2026-09-04'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: null },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'confirm',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'day');
});

test('RescheduleIntent dialog hook resolves the chosen day and offers times', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { days: ['2026-09-04', '2026-09-07'] },
    { times: ['08:00', '09:30'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '2' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'day',
        rescheduleApptSelection: '1',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'time');
  assert.match(messageOf(result), new RegExp(ssmlTime('09:30')));
});

test('RescheduleIntent dialog hook re-elicits the day choice when it does not resolve', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { days: ['2026-09-04'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '9' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'day',
        rescheduleApptSelection: '1',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleAttempts, '1');
});

test('RescheduleIntent dialog hook resolves the chosen time and asks for confirmation', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { times: ['08:00', '09:30'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '2' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'time',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ConfirmIntent');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'confirm');
  assert.equal(result.sessionState.sessionAttributes.rescheduleTime, '09:30');
  assert.match(
    messageOf(result),
    new RegExp(`kardiolog.*godzina ${ssmlTime('09:30')}.*na.*godzina ${ssmlTime('09:30')}`),
  );
});

test('RescheduleIntent dialog hook transfers immediately when the appointment resolution goes stale at the day stage', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] })),
  );
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '2' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'day',
        rescheduleApptSelection: '9',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('RescheduleIntent dialog hook transfers immediately when the appointment resolution goes stale at the time stage', async () => {
  const fetchMock = mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] })),
  );
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '2' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'time',
        rescheduleApptSelection: '9',
        rescheduleDate: '2026-09-07',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('RescheduleIntent dialog hook re-elicits the time choice when it does not resolve', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { times: ['08:00'] },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '9' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleStage: 'time',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleAttempts: '0',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleAttempts, '1');
});

test('RescheduleIntent dialog hook forwards straight to fulfillment when the caller confirms', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { booked: true },
    { cancelled: true },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
      'Confirmed',
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /przełożona/);
});

test('RescheduleIntent dialog hook restarts from appointment selection when the caller declines', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    rescheduleIntentEvent(
      'DialogCodeHook',
      { timeOfDay: 'rano', selectedSlot: '1' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
      'Denied',
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'selectedSlot');
  assert.equal(result.sessionState.sessionAttributes.rescheduleStage, 'select');
  assert.equal(result.sessionState.sessionAttributes.rescheduleApptSelection, '');
});

test('RescheduleIntent fulfillment needs auth before rescheduling', async () => {
  const result = await handler(
    rescheduleIntentEvent('FulfillmentCodeHook', { timeOfDay: 'rano' }, { authenticated: 'false' }),
  );

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'RescheduleIntent');
});

test('RescheduleIntent fulfillment reports a clean failure when patientId is missing', async () => {
  const result = await handler(
    rescheduleIntentEvent(
      'FulfillmentCodeHook',
      { timeOfDay: 'rano' },
      { authenticated: 'true', rescheduleApptSelection: '1', rescheduleDate: '2026-09-07', rescheduleTime: '08:00' },
    ),
  );

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('RescheduleIntent fulfillment reschedules the resolved appointment and confirms', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { booked: true },
    { cancelled: true },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'FulfillmentCodeHook',
      { timeOfDay: 'rano' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.match(messageOf(result), /przełożona/);
});

test('RescheduleIntent fulfillment reports a clean failure when the new slot was taken in the meantime', async () => {
  mockFetchSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { booked: false },
  ]);
  const result = await handler(
    rescheduleIntentEvent(
      'FulfillmentCodeHook',
      { timeOfDay: 'rano' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleApptSelection: '1',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.dialogAction.type, 'Close');
  assert.equal('transfer' in result.sessionState.sessionAttributes, false);
});

test('RescheduleIntent fulfillment transfers when the old appointment no longer resolves', async () => {
  mockFetchSequence([{ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] }]);
  const result = await handler(
    rescheduleIntentEvent(
      'FulfillmentCodeHook',
      { timeOfDay: 'rano' },
      {
        authenticated: 'true',
        patientId: '1',
        rescheduleApptSelection: '9',
        rescheduleDate: '2026-09-07',
        rescheduleTime: '08:00',
      },
    ),
  );
  mock.restoreAll();

  assert.equal(result.sessionState.sessionAttributes.transfer, 'true');
});

test('ListAppointmentsIntent needs auth before fetching anything', async () => {
  const result = await handler(eventFor('ListAppointmentsIntent', { authenticated: 'false' }));

  assert.equal(result.sessionState.dialogAction.type, 'ElicitSlot');
  assert.equal(result.sessionState.dialogAction.slotToElicit, 'pesel');
  assert.equal(intentNameOf(result), 'AuthIntent');
  assert.equal(result.sessionState.sessionAttributes.pendingIntent, 'ListAppointmentsIntent');
});

test('ListAppointmentsIntent reports no appointments for a patient with none', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ appointments: [] })));
  const result = await handler(eventFor('ListAppointmentsIntent', { authenticated: 'true', patientId: '1' }));
  mock.restoreAll();

  assert.equal(messageOf(result), '<speak>Nie mają Państwo żadnych zaplanowanych wizyt.</speak>');
});

test('ListAppointmentsIntent speaks up to three appointments without an overflow line when under the cap', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          appointments: [
            { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' },
            { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
          ],
        }),
      ),
  );
  const result = await handler(eventFor('ListAppointmentsIntent', { authenticated: 'true', patientId: '1' }));
  mock.restoreAll();

  assert.match(messageOf(result), /kardiolog/);
  assert.match(messageOf(result), /okulista/);
  assert.doesNotMatch(messageOf(result), /więcej/);
});

test('ListAppointmentsIntent adds the overflow line when a fourth appointment exists', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          appointments: [
            { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' },
            { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
            { specialty: 'urolog', date: '2026-09-10', time: '11:00' },
            { specialty: 'dermatolog', date: '2026-09-11', time: '12:00' },
          ],
        }),
      ),
  );
  const result = await handler(eventFor('ListAppointmentsIntent', { authenticated: 'true', patientId: '1' }));
  mock.restoreAll();

  assert.doesNotMatch(messageOf(result), /dermatolog/);
  assert.match(messageOf(result), /więcej/);
});

test('ListAppointmentsIntent transfers to an agent when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(eventFor('ListAppointmentsIntent', { authenticated: 'true', patientId: '1' }));
  mock.restoreAll();

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
