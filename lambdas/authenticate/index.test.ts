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
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  const records = captureRecords();
  const result = await handler(sampleEvent);
  mock.restoreAll();

  assert.deepEqual(result, { reachable: 'true', authenticated: 'true', patientId: '1', firstName: 'Jan' });
  assert.equal(records()[0].authPath, 'caller-id');
});

test('starts an OTP challenge with a fresh code when the pair matches but the caller dials from a different number', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null }),
      ),
  );
  const records = captureRecords();
  const result = await handler({
    ...sampleEvent,
    Details: { ...sampleEvent.Details, Parameters: { ...sampleEvent.Details.Parameters, callerNumber: '+48111111111' } },
  });
  mock.restoreAll();

  assert.equal(result.reachable, 'true');
  assert.equal(result.authenticated, 'false');
  assert.equal(result.otpRequired, 'true');
  assert.equal(result.isDemo, 'false');
  assert.equal(result.phone, '+48000000000');
  assert.equal(result.patientId, '1');
  assert.match(result.code, /^\d{6}$/);
  assert.equal('authPath' in records()[0], false);
  assert.equal(records()[0].outcome, 'ok');
});

test('starts an OTP challenge with the fixed code and no phone for a demo match', async () => {
  mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({ matched: true, id: 2, firstName: 'Anna', lastName: 'Demo', isDemo: true, demoOtpCode: '123456' }),
      ),
  );
  const result = await handler({
    ...sampleEvent,
    Details: { ...sampleEvent.Details, Parameters: { ...sampleEvent.Details.Parameters, callerNumber: '+48111111111' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, {
    reachable: 'true',
    authenticated: 'false',
    otpRequired: 'true',
    isDemo: 'true',
    code: '123456',
    phone: '',
    patientId: '2',
  });
});

test('starts the same OTP challenge with an empty code when the pair matches no record', async () => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ matched: false })));
  const records = captureRecords();
  const result = await handler(sampleEvent);
  mock.restoreAll();

  assert.deepEqual(result, {
    reachable: 'true',
    authenticated: 'false',
    otpRequired: 'true',
    isDemo: 'false',
    code: '',
    phone: '',
    patientId: '',
  });
  assert.equal('authPath' in records()[0], false);
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
