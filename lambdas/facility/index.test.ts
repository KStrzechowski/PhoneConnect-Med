import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFacility, ssmlAddress } from './index.ts';

const sampleFacility = {
  name: 'Przychodnia Zdrowie',
  address: 'ul. Kwiatowa 12, 00-001 Warszawa',
  opensAt: '08:00',
  closesAt: '18:00',
  openDays: 'poniedziałek-piątek',
};

test('returns the parsed facility payload', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(sampleFacility)));
  const result = await fetchFacility(AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, sampleFacility);
});

test('ssmlAddress expands "ul." and reads the postal code digit by digit', () => {
  assert.equal(
    ssmlAddress('ul. Kwiatowa 12, 00-001 Warszawa'),
    'ulica Kwiatowa 12, <say-as interpret-as="digits">00</say-as><break time="150ms"/><say-as interpret-as="digits">001</say-as> Warszawa',
  );
});

test('ssmlAddress translates the street word and city name for the en locale, keeping the street name as-is', () => {
  assert.equal(
    ssmlAddress('ul. Kwiatowa 12, 00-001 Warszawa', 'en'),
    'street Kwiatowa 12, <say-as interpret-as="digits">00</say-as><break time="150ms"/><say-as interpret-as="digits">001</say-as> Warsaw',
  );
});

test('propagates a fetch failure as a thrown error', async () => {
  mock.method(globalThis, 'fetch', async () => {
    throw new Error('connect ECONNREFUSED');
  });

  await assert.rejects(fetchFacility(AbortSignal.timeout(1000)), /ECONNREFUSED/);
  mock.restoreAll();
});
