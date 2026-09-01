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

test('returns authenticated true and stamps the caller-id auth path when the pair matches from the declared number', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () => new Response(JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' })),
  );
  const records = captureRecords();
  const result = await handler(sampleEvent);
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', authenticated: 'true', patientId: '1', firstName: 'Jan' });
  assert.equal(records()[0].authPath, 'caller-id');
});

test('returns authenticated false when the pair matches no record', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: false })));
  const result = await handler(sampleEvent);
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', authenticated: 'false' });
});

test('returns a handled error when the mock is unreachable', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });
  const result = await handler(sampleEvent);
  mock.restoreAll();

  assert.equal(result.reachable, 'false');
  assert.match(result.error, /ECONNREFUSED/);
});
