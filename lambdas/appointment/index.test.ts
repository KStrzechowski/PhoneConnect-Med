import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  findAvailableDays,
  findAvailableTimes,
  findAvailableTimesForDate,
  findNearestAvailable,
  resolveDay,
  resolveTime,
  resolveTimeForDate,
  bookAppointment,
  listAppointments,
  resolveAppointment,
  cancelAppointment,
  rescheduleAppointment,
  ssmlTime,
  ssmlOpeningHour,
  joinNumbered,
  joinList,
} from './index.ts';

const mockJson = (body: object) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
};

const mockSequence = (bodies: object[]) => {
  let i = 0;
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(bodies[i++])));
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

test('findAvailableTimesForDate omits timeOfDay from the request', async () => {
  const fetchSpy = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ times: ['08:00'] })));
  const times = await findAvailableTimesForDate('kardiolog', '2026-09-04', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(times, ['08:00']);
  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('timeOfDay'), false);
});

test('findNearestAvailable returns the mocked pair', async () => {
  mockJson({ nearest: { date: '2026-09-05', time: '09:30' } });
  const nearest = await findNearestAvailable('kardiolog', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(nearest, { date: '2026-09-05', time: '09:30' });
});

test('findNearestAvailable returns null when nothing is available', async () => {
  mockJson({ nearest: null });
  const nearest = await findNearestAvailable('reumatolog', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(nearest, null);
});

test('findNearestAvailable includes minTime in the request when given', async () => {
  const fetchSpy = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ nearest: null })));
  await findNearestAvailable('kardiolog', AbortSignal.timeout(1000), '16:00');
  mock.restoreAll();

  const url = String(fetchSpy.mock.calls[0].arguments[0]);
  assert.equal(url.includes('minTime=16%3A00'), true);
});

test('resolveTimeForDate re-derives the time at the chosen index', async () => {
  mockJson({ times: ['08:00', '09:30'] });
  const result = await resolveTimeForDate('kardiolog', '2026-09-04', 2, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: '09:30' });
});

test('resolveTimeForDate returns null for a choice outside the offered range', async () => {
  mockJson({ times: ['08:00'] });
  const result = await resolveTimeForDate('kardiolog', '2026-09-04', 5, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: null });
});

test('resolveTimeForDate returns null when the search comes back empty', async () => {
  mockJson({ times: [] });
  const result = await resolveTimeForDate('kardiolog', '2026-09-04', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { time: null });
});

test('bookAppointment omits timeOfDay from the request body when null', async () => {
  const fetchSpy = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ booked: true })));
  const booked = await bookAppointment('kardiolog', null, '2026-09-04', '09:30', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(booked, true);
  const body = JSON.parse(String(fetchSpy.mock.calls[0].arguments[1]?.body));
  assert.equal('timeOfDay' in body, false);
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

test('resolveAppointment re-derives the appointment at the chosen index', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-04', time: '08:00' }] });
  const result = await resolveAppointment(1, 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { specialty: 'kardiolog', date: '2026-09-04', time: '08:00' });
});

test('resolveAppointment returns null for a choice outside the offered range', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-04', time: '08:00' }] });
  const result = await resolveAppointment(1, 2, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(result, null);
});

test('cancelAppointment reports a successful cancellation', async () => {
  mockJson({ cancelled: true });
  const cancelled = await cancelAppointment('2026-09-04', '08:00', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(cancelled, true);
});

test('cancelAppointment reports a failed cancellation', async () => {
  mockJson({ cancelled: false });
  const cancelled = await cancelAppointment('2026-09-04', '08:00', 1, AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.equal(cancelled, false);
});

test('rescheduleAppointment does not cancel the old slot when the new slot fails to book', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ booked: false })));
  const result = await rescheduleAppointment(
    1,
    '2026-09-04',
    '08:00',
    'kardiolog',
    'rano',
    '2026-09-07',
    '09:30',
    AbortSignal.timeout(1000),
  );
  mock.restoreAll();

  assert.deepEqual(result, { rescheduled: false, oldSlotReleased: false });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('rescheduleAppointment books the new slot then releases the old one', async () => {
  mockSequence([{ booked: true }, { cancelled: true }]);
  const result = await rescheduleAppointment(
    1,
    '2026-09-04',
    '08:00',
    'kardiolog',
    'rano',
    '2026-09-07',
    '09:30',
    AbortSignal.timeout(1000),
  );
  mock.restoreAll();

  assert.deepEqual(result, { rescheduled: true, oldSlotReleased: true });
});

test('ssmlTime reads the hour as a Polish ordinal word with a cardinal minute', () => {
  assert.equal(ssmlTime('09:30'), 'dziewiąta <say-as interpret-as="cardinal">30</say-as>');
});

test('ssmlTime omits the minute when it is zero', () => {
  assert.equal(ssmlTime('08:00'), 'ósma');
});

test('ssmlTime reads hour and minute as cardinal numbers in English', () => {
  assert.equal(
    ssmlTime('09:30', 'en'),
    '<say-as interpret-as="cardinal">9</say-as> <say-as interpret-as="cardinal">30</say-as>',
  );
  assert.equal(ssmlTime('08:00', 'en'), '<say-as interpret-as="cardinal">8</say-as>');
});

test('ssmlOpeningHour reads the hour in genitive form for the "od...do" opening-hours phrasing', () => {
  assert.equal(ssmlOpeningHour('08:00'), 'ósmej');
  assert.equal(ssmlOpeningHour('18:00'), 'osiemnastej');
  assert.equal(ssmlOpeningHour('09:30'), 'dziewiątej <say-as interpret-as="cardinal">30</say-as>');
});

test('ssmlOpeningHour falls back to cardinal digits in English', () => {
  assert.equal(ssmlOpeningHour('08:00', 'en'), '<say-as interpret-as="cardinal">8</say-as>');
});

test('joinNumbered numbers each item and stops at however many are given', () => {
  assert.equal(joinNumbered(['poniedziałek']), '1 - poniedziałek');
  assert.equal(joinNumbered(['poniedziałek', 'wtorek']), '1 - poniedziałek, 2 - wtorek');
  assert.equal(joinNumbered([]), '');
});

test('joinList joins items with a period and no trailing separator', () => {
  assert.equal(joinList(['a']), 'a');
  assert.equal(joinList(['a', 'b']), 'a. b');
  assert.equal(joinList([]), '');
});

test('rescheduleAppointment reports the old slot as not released when its cancellation fails', async () => {
  mockSequence([{ booked: true }, { cancelled: false }]);
  const result = await rescheduleAppointment(
    1,
    '2026-09-04',
    '08:00',
    'kardiolog',
    'rano',
    '2026-09-07',
    '09:30',
    AbortSignal.timeout(1000),
  );
  mock.restoreAll();

  assert.deepEqual(result, { rescheduled: true, oldSlotReleased: false });
});
