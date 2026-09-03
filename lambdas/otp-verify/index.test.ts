import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './index.ts';
import type { InvocationRecord } from '@pcm/measure';

const captureRecords = () => {
  const logged: InvocationRecord[] = [];
  mock.method(console, 'log', (record: InvocationRecord) => void logged.push(record));
  return () => logged.filter((record) => record.kind === 'invocation');
};

test('authenticates and stamps the otp auth path on a correct real code', async () => {
  const records = captureRecords();
  const result = await handler({
    Details: { Parameters: { enteredCode: '654321', expectedCode: '654321', isDemo: 'false', patientId: '1' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: 'true', patientId: '1' });
  assert.equal(records()[0].authPath, 'otp');
});

test('authenticates and stamps the demo auth path on a correct demo code', async () => {
  const records = captureRecords();
  const result = await handler({
    Details: { Parameters: { enteredCode: '123456', expectedCode: '123456', isDemo: 'true', patientId: '2' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: 'true', patientId: '2' });
  assert.equal(records()[0].authPath, 'demo');
});

test('does not authenticate a wrong code', async () => {
  const records = captureRecords();
  const result = await handler({
    Details: { Parameters: { enteredCode: '000000', expectedCode: '654321', isDemo: 'false', patientId: '1' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: 'false' });
  assert.equal('authPath' in records()[0], false);
});

test('never authenticates when no code was ever actually issued', async () => {
  const records = captureRecords();
  const result = await handler({
    Details: { Parameters: { enteredCode: '000000', expectedCode: '', isDemo: 'false', patientId: '' } },
  });
  mock.restoreAll();

  assert.deepEqual(result, { authenticated: 'false' });
  assert.equal('authPath' in records()[0], false);
});
