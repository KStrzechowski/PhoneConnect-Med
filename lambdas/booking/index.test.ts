import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from './index.ts';

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const withParams = (params: Record<string, string>) => ({
  ...sampleEvent,
  Details: { ...sampleEvent.Details, Parameters: { ...sampleEvent.Details.Parameters, ...params } },
});

const mockSequence = (bodies: object[]) => {
  let i = 0;
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(bodies[i++])));
};

test('short-circuits with needsAuth when the caller is not authenticated', async () => {
  const result = await handler(withParams({ authenticated: 'false' }));

  assert.deepEqual(result, { needsAuth: 'true' });
});

test('days step returns speakable day labels when slots are available', async () => {
  mockSequence([{ days: ['2026-09-04', '2026-09-07', '2026-09-08'] }]);
  const result = await handler(withParams({ step: 'days' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.available, 'true');
  assert.ok(result.day1.length > 0);
  assert.ok(result.day2.length > 0);
  assert.ok(result.day3.length > 0);
});

test('days step reports no availability when the search is empty', async () => {
  mockSequence([{ days: [] }]);
  const result = await handler(withParams({ step: 'days' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('times step re-derives the chosen day and returns its times', async () => {
  mockSequence([{ days: ['2026-09-04', '2026-09-07'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(withParams({ step: 'times', dayChoice: '2' }));
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

test('times step reports no availability for an out-of-range day choice', async () => {
  mockSequence([{ days: ['2026-09-04'] }]);
  const result = await handler(withParams({ step: 'times', dayChoice: '3' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('confirm step resolves day and time and returns a read-back message', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00', '09:30'] }]);
  const result = await handler(withParams({ step: 'confirm', dayChoice: '1', timeChoice: '2' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.available, 'true');
  assert.equal(result.date, '2026-09-04');
  assert.equal(result.time, '09:30');
  assert.ok(result.message.includes('09:30'));
});

test('confirm step reports no availability when the day no longer resolves', async () => {
  mockSequence([{ days: [] }]);
  const result = await handler(withParams({ step: 'confirm', dayChoice: '1', timeChoice: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', available: 'false' });
});

test('book step resolves day and time then books the slot', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00'] }, { booked: true }]);
  const result = await handler(withParams({ step: 'book', dayChoice: '1', timeChoice: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', booked: 'true' });
});

test('book step reports failure when the slot was already taken', async () => {
  mockSequence([{ days: ['2026-09-04'] }, { times: ['08:00'] }, { booked: false }]);
  const result = await handler(withParams({ step: 'book', dayChoice: '1', timeChoice: '1' }));
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', booked: 'false' });
});

test('book step reports failure when patientId is missing', async () => {
  const result = await handler(withParams({ step: 'book', dayChoice: '1', timeChoice: '1', patientId: '' }));

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /patientId/);
});

test('returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(withParams({ step: 'days' }));
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});
