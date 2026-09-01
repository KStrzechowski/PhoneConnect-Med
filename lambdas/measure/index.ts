export type ConnectEvent = {
  Details?: {
    ContactData?: { ContactId?: string };
    Parameters?: Record<string, string>;
  };
};

export type InvocationRecord = {
  kind: 'invocation';
  ts: string;
  handler: string;
  durationMs: number;
  outcome: 'ok' | 'error' | 'transferred';
  contactId?: string;
  variant?: 'keypad' | 'speech';
  authPath?: 'caller-id' | 'otp' | 'demo';
  downstreamMs?: number;
  [extra: string]: unknown;
};

export const measured =
  <R>(handler: string, fn: (event: ConnectEvent, record: InvocationRecord) => Promise<R>) =>
  async (event: ConnectEvent = {}): Promise<R> => {
    const started = Date.now();
    const record: InvocationRecord = {
      kind: 'invocation',
      ts: new Date().toISOString(),
      handler,
      durationMs: 0,
      outcome: 'ok',
    };

    const contactId = event.Details?.ContactData?.ContactId;
    if (contactId) record.contactId = contactId;

    const variant = event.Details?.Parameters?.variant;
    if (variant === 'keypad' || variant === 'speech') record.variant = variant;

    try {
      return await fn(event, record);
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
      throw error;
    } finally {
      record.durationMs = Date.now() - started;
      console.log(record);
    }
  };

export const downstream = async <T>(record: InvocationRecord, call: () => Promise<T>): Promise<T> => {
  const started = Date.now();
  try {
    return await call();
  } finally {
    record.downstreamMs = (record.downstreamMs ?? 0) + (Date.now() - started);
  }
};
