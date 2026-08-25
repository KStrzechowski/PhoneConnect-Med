import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { measured, downstream } from './index.ts';

const captureLines = () => {
  const lines: string[] = [];
  mock.method(console, 'log', (line: string) => void lines.push(line));
  return lines;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const connectEvent = {
  Details: {
    ContactData: { ContactId: 'contact-1' },
    Parameters: { variant: 'keypad' },
  },
};

test('stamps the core fields on a successful invocation', async () => {
  const lines = captureLines();
  await measured('probe', async () => 'done')();
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.equal(record.kind, 'invocation');
  assert.equal(record.handler, 'probe');
  assert.equal(record.outcome, 'ok');
  assert.equal(typeof record.durationMs, 'number');
  assert.ok(!Number.isNaN(Date.parse(record.ts)));
});

test('records an error outcome and re-raises so the transfer path still fires', async () => {
  const lines = captureLines();
  const boom = measured('probe', async () => {
    throw new Error('downstream exploded');
  });

  await assert.rejects(boom(), /downstream exploded/);
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.equal(record.outcome, 'error');
  assert.match(record.error, /downstream exploded/);
});

test('takes the contact id and variant from a Connect-shaped event', async () => {
  const lines = captureLines();
  await measured('probe', async () => 'done')(connectEvent);
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.equal(record.contactId, 'contact-1');
  assert.equal(record.variant, 'keypad');
});

test('leaves them absent on a bare invocation', async () => {
  const lines = captureLines();
  await measured('probe', async () => 'done')();
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.equal('contactId' in record, false);
  assert.equal('variant' in record, false);
});

test('downstreamMs covers the downstream call, not the whole handler', async () => {
  const lines = captureLines();
  await measured('probe', async (_event, record) => {
    await downstream(record, () => sleep(30));
    await sleep(60);
  })();
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.ok(record.downstreamMs < 50, `downstreamMs was ${record.downstreamMs}`);
  assert.ok(record.durationMs >= record.downstreamMs + 50);
});

test('fields the handler adds survive into the record', async () => {
  const lines = captureLines();
  await measured('probe', async (_event, record) => {
    record.authPath = 'demo';
    record.specialty = 'cardiology';
  })();
  mock.restoreAll();

  const record = JSON.parse(lines[0]);
  assert.equal(record.authPath, 'demo');
  assert.equal(record.specialty, 'cardiology');
});
