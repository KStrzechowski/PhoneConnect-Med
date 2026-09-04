import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from './index.ts';

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const withParams = (params: Record<string, string>) => ({
  ...sampleEvent,
  Details: { ...sampleEvent.Details, Parameters: { ...sampleEvent.Details.Parameters, ...params } },
});

const mockAppointments = (appointments: { specialty: string; date: string; time: string }[]) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ appointments })));
};

test('short-circuits with needsAuth when the caller is not authenticated', async () => {
  const result = await handler(withParams({ authenticated: 'false' }));

  assert.deepEqual(result, { needsAuth: 'true' });
});

test('reports no appointments for a patient with none', async () => {
  mockAppointments([]);
  const result = await handler(withParams({}));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', hasAppointments: 'false' });
});

test('returns up to three formatted appointments without an overflow flag when under the cap', async () => {
  mockAppointments([
    { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' },
    { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
  ]);
  const result = await handler(withParams({}));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.hasAppointments, 'true');
  assert.equal(result.hasMore, 'false');
  assert.match(result.appt1, /kardiolog.*godzina 09:30/);
  assert.match(result.appt2, /okulista.*godzina 10:00/);
  assert.equal(result.appt3, '');
});

test('caps at three appointments and flags overflow when a fourth exists', async () => {
  mockAppointments([
    { specialty: 'kardiolog', date: '2026-09-08', time: '09:30' },
    { specialty: 'okulista', date: '2026-09-09', time: '10:00' },
    { specialty: 'urolog', date: '2026-09-10', time: '11:00' },
    { specialty: 'dermatolog', date: '2026-09-11', time: '12:00' },
  ]);
  const result = await handler(withParams({}));
  mock.restoreAll();

  assert.equal(result.hasMore, 'true');
  assert.match(result.appt3, /urolog/);
});

test('returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(withParams({}));
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});
