import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { authenticate, beginOtpChallenge, verifyOtpCode } from './index.ts';

const mockVerify = (body: object) => {
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));
};

test('authenticates when the pair matches and the caller dials from the declared phone', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null });
  const result = await authenticate('90010112345', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: true, patientId: 1, firstName: 'Jan' });
});

test('does not authenticate when the pair matches but the caller dials from a different number', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null });
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
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null });
  const wrongNumber = await authenticate('90010112345', '+48000000000', '+48111111111', AbortSignal.timeout(1000));
  mock.restoreAll();

  mockVerify({ matched: false });
  const noMatch = await authenticate('00000000000', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(wrongNumber, noMatch);
});

test('beginOtpChallenge takes the shortcut when the caller dials from the declared phone', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null });
  const result = await beginOtpChallenge('90010112345', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: true, patientId: 1, firstName: 'Jan' });
});

test('beginOtpChallenge issues a fresh code to the matched phone for a real, non-demo match', async () => {
  mockVerify({ matched: true, id: 1, firstName: 'Jan', lastName: 'Kowalski', isDemo: false, demoOtpCode: null });
  const result = await beginOtpChallenge('90010112345', '+48000000000', '+48111111111', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.ok('otpRequired' in result);
  assert.equal(result.isDemo, false);
  assert.equal(result.phone, '+48000000000');
  assert.equal(result.patientId, 1);
  assert.match(result.code ?? '', /^\d{6}$/);
});

test('beginOtpChallenge uses the seeded fixed code and sends nothing for a demo match', async () => {
  mockVerify({ matched: true, id: 2, firstName: 'Anna', lastName: 'Demo', isDemo: true, demoOtpCode: '123456' });
  const result = await beginOtpChallenge('85050512345', '+48999999999', '+48111111111', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { otpRequired: true, isDemo: true, code: '123456', phone: null, patientId: 2 });
});

test('beginOtpChallenge poses the same challenge with a null code when the pair matches nothing', async () => {
  mockVerify({ matched: false });
  const result = await beginOtpChallenge('00000000000', '+48000000000', '+48000000000', AbortSignal.timeout(1000));
  mock.restoreAll();

  assert.deepEqual(result, { otpRequired: true, isDemo: false, code: null, phone: null });
});

test('verifyOtpCode matches an equal, non-null expected code', () => {
  assert.equal(verifyOtpCode('123456', '123456'), true);
});

test('verifyOtpCode rejects a mismatched code', () => {
  assert.equal(verifyOtpCode('123456', '654321'), false);
});

test('verifyOtpCode never matches when the expected code is null', () => {
  assert.equal(verifyOtpCode(null, '123456'), false);
});
