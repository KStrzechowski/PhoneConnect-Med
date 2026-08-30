import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFacility } from './index.ts';

const sampleFacility = {
  name: 'Przychodnia Zdrowie',
  address: 'ul. Kwiatowa 12, 00-001 Warszawa',
  opensAt: '08:00',
  closesAt: '18:00',
  openDays: 'monday-friday',
};

test('returns the parsed facility payload', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const result = await fetchFacility(AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, sampleFacility);
});

test('propagates a fetch failure as a thrown error', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });

  await assert.rejects(fetchFacility(AbortSignal.timeout(1000)), /ECONNREFUSED/);
  mock.restoreAll();
});
