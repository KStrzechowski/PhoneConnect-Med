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

const captureRecords = () => {
  const logged: InvocationRecord[] = [];
  mock.method(console, 'log', (record: InvocationRecord) => void logged.push(record));
  return () => logged.filter((record) => record.kind === 'invocation');
};

test('returns the mock facility payload as a flat string map', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const result = await handler();
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', ...sampleFacility });
  assert.ok(Object.values(result).every((value) => typeof value === 'string'));
});

test('returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler();
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
  assert.ok(Object.values(result).every((value) => typeof value === 'string'));
});

test('emits exactly one invocation record, carrying the contact id and variant', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const records = captureRecords();
  await handler(sampleEvent);
  mock.restoreAll();

  const [record, ...rest] = records();
  assert.equal(rest.length, 0);
  assert.equal(record.contactId, sampleEvent.Details.ContactData.ContactId);
  assert.equal(record.handler, 'facility-info');
  assert.equal(record.variant, 'keypad');
  assert.equal(record.outcome, 'ok');
  assert.ok(record.downstreamMs !== undefined && record.downstreamMs <= record.durationMs);
});

test('an unreachable mock still emits a record, marked as a failure', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const records = captureRecords();
  await handler(sampleEvent);
  mock.restoreAll();

  const [record] = records();
  assert.equal(record.outcome, 'error');
  assert.match(String(record.error), /ECONNREFUSED/);
});
