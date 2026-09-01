import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from './index.ts';

const mockVerify = (body: object) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
};

test('authenticates when the pair matches and the caller dials from the declared phone', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' });
  const result = await authenticate('90010112345', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: true, patientId: 1, firstName: 'Jan' });
});

test('does not authenticate when the pair matches but the caller dials from a different number', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' });
  const result = await authenticate('90010112345', '+48000000000', '+48111111111', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: false });
});

test('does not authenticate when the pair matches no record', async () => {
  mockVerify({ matched: false });
  const result = await authenticate('00000000000', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: false });
});

test('a matched-wrong-number result is indistinguishable from a no-match result', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski' });
  const wrongNumber = await authenticate('90010112345', '+48000000000', '+48111111111', AbortSignal.timeout(1000));
  mock.restoreAll();

  mockVerify({ matched: false });
  const noMatch = await authenticate('00000000000', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(wrongNumber, noMatch);
});
