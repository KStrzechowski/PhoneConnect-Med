import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handler } from './index.ts';
import type { InvocationRecord } from '@pcm/measure';

const sampleEvent = JSON.parse(readFileSync(new URL('./event.sample.json', import.meta.url), 'utf8'));

const captureRecords = () => {
  const logged: InvocationRecord[] = [];
  mock.method(console, 'log', (record: InvocationRecord) => void logged.push(record));
  return () => logged.filter((record) => record.kind === 'invocation');
};

test('returns the mock health payload as a flat string map', async () => {
  mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ service: 'his', status: 'ok' })),
  );
  const result = await handler();
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', service: 'his', status: 'ok' });
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
});

test('emits exactly one invocation record, carrying the contact id', async () => {
  mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ service: 'his', status: 'ok' })),
  );
  const records = captureRecords();
  await handler(sampleEvent);
  mock.restoreAll();

  const [record, ...rest] = records();
  assert.equal(rest.length, 0);
  assert.equal(record.contactId, sampleEvent.Details.ContactData.ContactId);
  assert.equal(record.handler, 'connect-health');
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
