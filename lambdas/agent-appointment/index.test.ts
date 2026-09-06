import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from './index.ts';

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const withParams = (params: Record<string, string>) => ({
  ...sampleEvent,
  Details: { ...sampleEvent.Details, Parameters: { ...sampleEvent.Details.Parameters, ...params } },
});

const mockJson = (body: object) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
};

const mockSequence = (bodies: object[]) => {
  let i = 0;
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(bodies[i++])));
};

const appt = { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' };

for (const [operation, step] of [
  ['create', 'days'],
  ['create', 'times'],
  ['create', 'confirm'],
  ['create', 'book'],
  ['cancel', 'list'],
  ['cancel', 'confirm'],
  ['cancel', 'cancel'],
  ['reschedule', 'list'],
  ['reschedule', 'days'],
  ['reschedule', 'times'],
  ['reschedule', 'confirm'],
  ['reschedule', 'reschedule'],
]) {
  test(`${operation}/${step} short-circuits with needsAuth when the caller is not authenticated`, async () => {
    const result = await handler(withParams({ operation, step, authenticated: 'false' }));

    assert.deepEqual(result, { needsAuth: 'true' });
  });
}

test('create/days returns speakable day labels when slots are available', async () => {
  mockSequence([{ days: ['2026-09-04', '2026-09-07', '2026-09-08'] }]);
  const result = await handler(withParams({ operation: 'create', step: 'days' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.available, 'true');
  assert.ok(result.day1.length > 0);
  assert.ok(result.day2.length > 0);
  assert.ok(result.day3.length > 0);
});

test('create/days reports no availability when the search is empty', async () => {
  mockJson({ days: [] });
  const result = await handler(withParams({ operation: 'create', step: 'days' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('create/times re-derives the chosen day and returns its times', async () => {
  mockSequence([{ days: ['2026-09-04', '2026-09-07'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(withParams({ operation: 'create', step: 'times', dayChoice: '2' }));
  mock.restoreAll();

  assert.deepEqual(result, {
    reachable: 'true',
    available: 'true',
    date: '2026-09-07',
    time1: '08:00',
    time2: '09:30',
    time3: '',
  });
});

test('create/times reports no availability for an out-of-range day choice', async () => {
  mockJson({ days: ['2026-09-04'] });
  const result = await handler(withParams({ operation: 'create', step: 'times', dayChoice: '3' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('create/confirm resolves day and time and returns a read-back message', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(
    withParams({ operation: 'create', step: 'confirm', dayChoice: '1', timeChoice: '2' }),
  );
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.available, 'true');
  assert.equal(result.date, '2026-09-04');
  assert.equal(result.time, '09:30');
  assert.ok(result.message.includes('09:30'));
});

test('create/confirm reports no availability when the day no longer resolves', async () => {
  mockJson({ days: [] });
  const result = await handler(
    withParams({ operation: 'create', step: 'confirm', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('create/book resolves day and time then books the slot', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00'] }, { booked: true }]);
  const result = await handler(withParams({ operation: 'create', step: 'book', dayChoice: '1', timeChoice: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', booked: 'true' });
});

test('create/book reports failure when the slot was already taken', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00'] }, { booked: false }]);
  const result = await handler(withParams({ operation: 'create', step: 'book', dayChoice: '1', timeChoice: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', booked: 'false' });
});

test('create/book reports failure when patientId is missing', async () => {
  const result = await handler(
    withParams({ operation: 'create', step: 'book', dayChoice: '1', timeChoice: '1', patientId: '' }),
  );

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /patientId/);
});

test('cancel/list reports no appointments for a patient with none', async () => {
  mockJson({ appointments: [] });
  const result = await handler(withParams({ operation: 'cancel', step: 'list' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', hasAppointments: 'false' });
});

test('cancel/list returns up to four formatted appointments', async () => {
  mockJson({
    appointments: [
      appt,
      { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
      { specialty: 'dermatolog', date: '2026-09-10', time: '11:00' },
      { specialty: 'laryngolog', date: '2026-09-11', time: '12:00' },
    ],
  });
  const result = await handler(withParams({ operation: 'cancel', step: 'list' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.hasAppointments, 'true');
  assert.match(result.appt1, /kardiolog.*godzina 09:30/);
  assert.match(result.appt2, /okulista.*godzina 10:00/);
  assert.match(result.appt3, /dermatolog.*godzina 11:00/);
  assert.match(result.appt4, /laryngolog.*godzina 12:00/);
});

test('cancel/confirm resolves the chosen appointment and returns a read-back message', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(withParams({ operation: 'cancel', step: 'confirm', selectedSlot: '1' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.match(result.message, /kardiolog.*godzina 09:30/);
});

test('cancel/confirm reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(withParams({ operation: 'cancel', step: 'confirm', selectedSlot: '2' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('cancel/cancel resolves the chosen appointment and cancels it', async () => {
  mockSequence([{ appointments: [appt] }, { cancelled: true }]);
  const result = await handler(withParams({ operation: 'cancel', step: 'cancel', selectedSlot: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', cancelled: 'true' });
});

test('cancel/cancel reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(withParams({ operation: 'cancel', step: 'cancel', selectedSlot: '2' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('reschedule/list returns up to four formatted appointments', async () => {
  mockJson({ appointments: [appt, { specialty: 'okulista', date: '2026-09-09', time: '10:00' }] });
  const result = await handler(withParams({ operation: 'reschedule', step: 'list' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.hasAppointments, 'true');
  assert.match(result.appt1, /kardiolog.*godzina 09:30/);
  assert.match(result.appt2, /okulista.*godzina 10:00/);
  assert.equal(result.appt3, '');
  assert.equal(result.appt4, '');
});

test('reschedule/days reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(
    withParams({ operation: 'reschedule', step: 'days', selectedSlot: '2', timeOfDay: 'rano' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('reschedule/days reports no availability when the search comes back empty', async () => {
  mockSequence([{ appointments: [appt] }, { days: [] }]);
  const result = await handler(
    withParams({ operation: 'reschedule', step: 'days', selectedSlot: '1', timeOfDay: 'rano' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'false' });
});

test('reschedule/times returns the resolved date and up to three times', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(
    withParams({ operation: 'reschedule', step: 'times', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.equal(result.available, 'true');
  assert.equal(result.date, '2026-09-08');
  assert.equal(result.time1, '08:00');
  assert.equal(result.time2, '09:30');
});

test('reschedule/confirm returns a combined old+new read-back message', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00'] }]);
  const result = await handler(
    withParams({
      operation: 'reschedule',
      step: 'confirm',
      selectedSlot: '1',
      timeOfDay: 'rano',
      dayChoice: '1',
      timeChoice: '1',
    }),
  );
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.equal(result.available, 'true');
  assert.match(result.message, /kardiolog.*godzina 09:30.*na.*godzina 08:00/);
});

test('reschedule/reschedule books the new slot and releases the old one', async () => {
  mockSequence([
    { appointments: [appt] },
    { days: ['2026-09-08'] },
    { times: ['08:00'] },
    { booked: true },
    { cancelled: true },
  ]);
  const result = await handler(
    withParams({
      operation: 'reschedule',
      step: 'reschedule',
      selectedSlot: '1',
      timeOfDay: 'rano',
      dayChoice: '1',
      timeChoice: '1',
    }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'true', rescheduled: 'true' });
});

test('reschedule/reschedule reports a failed reschedule when the new slot fails to book', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00'] }, { booked: false }]);
  const result = await handler(
    withParams({
      operation: 'reschedule',
      step: 'reschedule',
      selectedSlot: '1',
      timeOfDay: 'rano',
      dayChoice: '1',
      timeChoice: '1',
    }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'true', rescheduled: 'false' });
});

for (const [operation, step] of [
  ['create', 'days'],
  ['cancel', 'list'],
  ['reschedule', 'list'],
]) {
  test(`${operation}/${step} returns a handled error when the mock is unreachable`, async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const result = await handler(withParams({ operation, step, dayChoice: '1', selectedSlot: '1' }));
    mock.restoreAll();

    assert.equal(result.reachable, 'false');
    assert.match(result.error, /ECONNREFUSED/);
  });
}
