import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SNSClient } from '@aws-sdk/client-sns';
import { handler } from './index.ts';

test('does not publish and returns the fixed code for a demo challenge', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler({ Details: { Parameters: { code: '123456', isDemo: 'true' } } });
  mock.restoreAll();

  assert.deepEqual(result, { code: '123456' });
  assert.equal(send.mock.callCount(), 0);
});

test('publishes the given code to the phone on a real, initial send', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler({
    Details: { Parameters: { code: '654321', phone: '+48000000000', isDemo: 'false' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { code: '654321' });
  assert.equal(send.mock.callCount(), 1);
});

test('generates and publishes a fresh code on resend', async () => {
  const send = mock.method(SNSClient.prototype, 'send', async () => ({}));
  const result = await handler({
    Details: { Parameters: { code: '654321', phone: '+48000000000', isDemo: 'false', isResend: 'true' } },
  });
  mock.restoreAll();

  assert.match(result.code, /^\d{6}$/);
  assert.notEqual(result.code, '654321');
  assert.equal(send.mock.callCount(), 1);
});

test('still returns the code when the SNS publish fails', async () => {
  mock.method(SNSClient.prototype, 'send', async () => {
    throw new Error('sns unavailable');
  });
  const result = await handler({
    Details: { Parameters: { code: '654321', phone: '+48000000000', isDemo: 'false' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { code: '654321' });
});
