import { measured, downstream } from '@pcm/measure';
import { authenticate } from '@pcm/patient';

export const handler = measured(
  'authenticate',
  async (event, record): Promise<Record<string, string>> => {
    const { pesel = '', phone = '', callerNumber = '' } = event.Details?.Parameters ?? {};
    const abort = AbortSignal.timeout(1000);
    try {
      const result = await downstream(record, () => authenticate(pesel, phone, callerNumber, abort));
      if (result.authenticated) {
        record.authPath = 'caller-id';
        return {
          reachable: 'true',
          authenticated: 'true',
          patientId: String(result.patientId),
          firstName: result.firstName,
        };
      }
      record.outcome = 'transferred';
      return { reachable: 'true', authenticated: 'false' };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
