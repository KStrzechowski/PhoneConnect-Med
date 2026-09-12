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

test('list step short-circuits with needsAuth when the caller is not authenticated', async () => {
  const result = await handler(withParams({ step: 'list', authenticated: 'false' }));

  assert.deepEqual(result, { needsAuth: 'true' });
});

test('confirm step short-circuits with needsAuth when the caller is not authenticated', async () => {
  const result = await handler(withParams({ step: 'confirm', authenticated: 'false' }));

  assert.deepEqual(result, { needsAuth: 'true' });
});

test('cancel step short-circuits with needsAuth when the caller is not authenticated', async () => {
  const result = await handler(withParams({ step: 'cancel', authenticated: 'false' }));

  assert.deepEqual(result, { needsAuth: 'true' });
});

test('list step reports no appointments for a patient with none', async () => {
  mockJson({ appointments: [] });
  const result = await handler(withParams({ step: 'list' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', hasAppointments: 'false' });
});

test('list step returns up to three formatted appointments', async () => {
  mockJson({
    appointments: [
      { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' },
      { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
    ],
  });
  const result = await handler(withParams({ step: 'list' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.hasAppointments, 'true');
  assert.match(
    result.apptsList,
    new RegExp(`^1 - kardiolog.*godzina ${ssmlTime('09:30')}, 2 - okulista.*godzina ${ssmlTime('10:00')}$`),
  );
});

test('confirm step resolves the chosen appointment and returns a read-back message', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] });
  const result = await handler(withParams({ step: 'confirm', selectedSlot: '1' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.found, 'true');
  assert.match(result.message, new RegExp(`kardiolog.*godzina ${ssmlTime('09:30')}`));
});

test('confirm step reports not found for an out-of-range selection', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] });
  const result = await handler(withParams({ step: 'confirm', selectedSlot: '2' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('cancel step resolves the chosen appointment and cancels it', async () => {
  mockSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { cancelled: true },
  ]);
  const result = await handler(withParams({ step: 'cancel', selectedSlot: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', cancelled: 'true' });
});

test('cancel step reports a failed cancellation when the slot no longer matches', async () => {
  mockSequence([
    { appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] },
    { cancelled: false },
  ]);
  const result = await handler(withParams({ step: 'cancel', selectedSlot: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'true', cancelled: 'false' });
});

test('cancel step reports not found for an out-of-range selection', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] });
  const result = await handler(withParams({ step: 'cancel', selectedSlot: '2' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', found: 'false' });
});

test('list step returns English-formatted appointments when locale is en', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] });
  const result = await handler(withParams({ step: 'list', locale: 'en' }));
  mock.restoreAll();

  assert.match(result.apptsList, new RegExp(`Cardiology.*at ${ssmlTime('09:30')}`));
});

test('confirm step returns an English read-back message when locale is en', async () => {
  mockJson({ appointments: [{ specialty: 'kardiolog', date: '2026-09-08', time: '09:30' }] });
  const result = await handler(withParams({ step: 'confirm', selectedSlot: '1', locale: 'en' }));
  mock.restoreAll();

  assert.match(result.message, new RegExp(`Cardiology.*at ${ssmlTime('09:30')}`));
});

test('list step returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(withParams({ step: 'list' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});

test('confirm step returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(withParams({ step: 'confirm', selectedSlot: '1' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});

test('cancel step returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(withParams({ step: 'cancel', selectedSlot: '1' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});
