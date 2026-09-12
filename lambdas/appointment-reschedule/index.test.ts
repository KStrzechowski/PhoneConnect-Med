import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ssmlTime } from '@pcm/appointment';
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

for (const step of ['list', 'days', 'times', 'confirm', 'reschedule']) {
  test(`${step} step short-circuits with needsAuth when the caller is not authenticated`, async () => {
    const result = await handler(withParams({ step, authenticated: 'false' }));

    assert.deepEqual(result, { needsAuth: 'true' });
  });
}

test('list step reports no appointments for a patient with none', async () => {
  mockJson({ appointments: [] });
  const result = await handler(withParams({ step: 'list' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', hasAppointments: 'false' });
});

test('list step returns up to three formatted appointments', async () => {
  mockJson({ appointments: [appt, { specialty: 'okulista', date: '2026-09-09', time: '10:00' }] });
  const result = await handler(withParams({ step: 'list' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.hasAppointments, 'true');
  assert.match(
    result.apptsList,
    new RegExp(`^1 - kardiolog.*godzina ${ssmlTime('09:30')}, 2 - okulista.*godzina ${ssmlTime('10:00')}$`),
  );
});

test('days step reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(withParams({ step: 'days', selectedSlot: '2', timeOfDay: 'rano' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('days step reports no availability when the search comes back empty', async () => {
  mockSequence([{ appointments: [appt] }, { days: [] }]);
  const result = await handler(withParams({ step: 'days', selectedSlot: '1', timeOfDay: 'rano' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'false' });
});

test('days step returns up to three formatted days', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08', '2026-09-09'] }]);
  const result = await handler(withParams({ step: 'days', selectedSlot: '1', timeOfDay: 'rano' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.equal(result.available, 'true');
  assert.match(result.daysList, /^1 - .+, 2 - .+$/);
});

test('times step reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(
    withParams({ step: 'times', selectedSlot: '2', timeOfDay: 'rano', dayChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('times step reports no availability when the day search comes back empty', async () => {
  mockSequence([{ appointments: [appt] }, { days: [] }]);
  const result = await handler(
    withParams({ step: 'times', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'false' });
});

test('times step returns the resolved date and up to three times', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(
    withParams({ step: 'times', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.equal(result.available, 'true');
  assert.match(result.date, /wrze[śs]nia/);
  assert.equal(result.timesList, `1 - ${ssmlTime('08:00')}, 2 - ${ssmlTime('09:30')}`);
});

test('confirm step reports not found for a stale selectedSlot', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(
    withParams({ step: 'confirm', selectedSlot: '2', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('confirm step reports no availability when the time search comes back empty', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: [] }]);
  const result = await handler(
    withParams({ step: 'confirm', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'false' });
});

test('confirm step returns a combined old+new read-back message', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00'] }]);
  const result = await handler(
    withParams({ step: 'confirm', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.equal(result.available, 'true');
  assert.equal(result.date, '2026-09-08');
  assert.equal(result.time, '08:00');
  assert.match(
    result.message,
    new RegExp(`kardiolog.*godzina ${ssmlTime('09:30')}.*na.*godzina ${ssmlTime('08:00')}`),
  );
});

test('reschedule step books the new slot and releases the old one', async () => {
  mockSequence([
    { appointments: [appt] },
    { days: ['2026-09-08'] },
    { times: ['08:00'] },
    { booked: true },
    { cancelled: true },
  ]);
  const result = await handler(
    withParams({ step: 'reschedule', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'true', rescheduled: 'true' });
});

test('reschedule step reports a failed reschedule when the new slot fails to book', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00'] }, { booked: false }]);
  const result = await handler(
    withParams({ step: 'reschedule', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'true', rescheduled: 'false' });
});

test('reschedule step still reports success when the old slot fails to release', async () => {
  mockSequence([
    { appointments: [appt] },
    { days: ['2026-09-08'] },
    { times: ['08:00'] },
    { booked: true },
    { cancelled: false },
  ]);
  const result = await handler(
    withParams({ step: 'reschedule', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
  );
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', available: 'true', rescheduled: 'true' });
});

test('list step returns English-formatted appointments when locale is en', async () => {
  mockJson({ appointments: [appt] });
  const result = await handler(withParams({ step: 'list', locale: 'en' }));
  mock.restoreAll();

  assert.match(result.apptsList, new RegExp(`Cardiology.*at ${ssmlTime('09:30')}`));
});

test('days step returns English day labels when locale is en', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }]);
  const result = await handler(withParams({ step: 'days', selectedSlot: '1', timeOfDay: 'rano', locale: 'en' }));
  mock.restoreAll();

  assert.match(result.daysList, /Tuesday/);
});

test('confirm step returns an English combined read-back message when locale is en', async () => {
  mockSequence([{ appointments: [appt] }, { days: ['2026-09-08'] }, { times: ['08:00'] }]);
  const result = await handler(
    withParams({ step: 'confirm', selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1', locale: 'en' }),
  );
  mock.restoreAll();

  assert.match(
    result.message,
    new RegExp(`Cardiology.*at ${ssmlTime('09:30')}.*to.*at ${ssmlTime('08:00')}`),
  );
});

for (const step of ['list', 'days', 'times', 'confirm', 'reschedule']) {
  test(`${step} step returns a handled error when the mock is unreachable`, async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const result = await handler(
      withParams({ step, selectedSlot: '1', timeOfDay: 'rano', dayChoice: '1', timeChoice: '1' }),
    );
    mock.restoreAll();

    assert.equal(result.reachable, 'false');
    assert.match(result.error, /ECONNREFUSED/);
  });
}
