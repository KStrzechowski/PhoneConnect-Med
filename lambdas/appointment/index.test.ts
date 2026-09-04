import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { findAvailableDays, findAvailableTimes, resolveDay, resolveTime, bookAppointment, listAppointments } from './index.ts';

const mockJson = (body: object) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
};

test('findAvailableDays returns the days from the mock', async () => {
  mockJson({ days: ['2026-09-04', '2026-09-07', '2026-09-08'] });
  const days = await findAvailableDays('kardiolog', 'rano', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(days, ['2026-09-04', '2026-09-07', '2026-09-08']);
});

test('findAvailableTimes returns the times from the mock', async () => {
  mockJson({ times: ['08:00', '09:30'] });
  const times = await findAvailableTimes('kardiolog', 'rano', '2026-09-04', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(times, ['08:00', '09:30']);
});

test('resolveDay re-derives the date at the chosen index', async () => {
  mockJson({ days: ['2026-09-04', '2026-09-07', '2026-09-08'] });
  const result = await resolveDay('kardiolog', 'rano', 2, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { date: '2026-09-07' });
});

test('resolveDay returns a null date for a choice outside the offered range', async () => {
  mockJson({ days: ['2026-09-04', '2026-09-07', '2026-09-08'] });
  const result = await resolveDay('kardiolog', 'rano', 4, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { date: null });
});

test('resolveDay returns a null date when the search comes back empty', async () => {
  mockJson({ days: [] });
  const result = await resolveDay('reumatolog', 'rano', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { date: null });
});

test('resolveTime re-derives the time at the chosen index', async () => {
  mockJson({ times: ['08:00', '09:30'] });
  const result = await resolveTime('kardiolog', 'rano', '2026-09-04', 2, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: '09:30' });
});

test('resolveTime returns a null time for a choice outside the offered range', async () => {
  mockJson({ times: ['08:00', '09:30'] });
  const result = await resolveTime('kardiolog', 'rano', '2026-09-04', 3, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: null });
});

test('resolveTime returns a null time when the search comes back empty', async () => {
  mockJson({ times: [] });
  const result = await resolveTime('alergolog', 'rano', '2026-09-04', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: null });
});

test('bookAppointment reports a successful booking', async () => {
  mockJson({ booked: true });
  const booked = await bookAppointment('kardiolog', 'rano', '2026-09-04', '08:00', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(booked, true);
});

test('bookAppointment reports a failed booking', async () => {
  mockJson({ booked: false });
  const booked = await bookAppointment('kardiolog', 'rano', '2026-09-04', '08:00', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(booked, false);
});

test('listAppointments returns the appointments from the mock', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-04', time: '08:00' }] });
  const appointments = await listAppointments(1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(appointments, [{ specialty: 'kardiolog', date: '2026-09-04', time: '08:00' }]);
});
