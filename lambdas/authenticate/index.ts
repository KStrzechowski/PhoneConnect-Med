import { measured, downstream } from '@pcm/measure';
import { beginOtpChallenge } from '@pcm/patient';

export const handler = measured(
  'authenticate',
  async (event, record): Promise<Record<string, string>> => {
    const { pesel = '', phone = '', callerNumber = '' } = event.Details?.Parameters ?? {};
    const abort = AbortSignal.timeout(1000);
    try {
      const result = await downstream(record, () => beginOtpChallenge(pesel, phone, callerNumber, abort));
      if ('authenticated' in result) {
        record.authPath = 'caller-id';
        return {
          reachable: 'true',
          authenticated: 'true',
          patientId: String(result.patientId),
          firstName: result.firstName,
        };
      }
      return {
        reachable: 'true',
        authenticated: 'false',
        otpRequired: 'true',
        isDemo: String(result.isDemo),
        code: result.code ?? '',
        phone: result.phone ?? '',
        patientId: result.patientId !== undefined ? String(result.patientId) : '',
      };
    } catch (error) {
      const message = String(error);
      record.outcome = 'error';
      record.error = message;
      return { reachable: 'false', error: message };
    }
  },
);
