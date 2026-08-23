import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.ts';

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
