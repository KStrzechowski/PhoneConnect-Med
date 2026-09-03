import { measured } from '@pcm/measure';
import { verifyOtpCode } from '@pcm/patient';

export const handler = measured(
  'otp-verify',
  async (event, record): Promise<Record<string, string>> => {
    const { enteredCode = '', expectedCode = '', isDemo = 'false', patientId = '' } = event.Details?.Parameters ?? {};
    const expected = expectedCode === '' ? null : expectedCode;
    if (verifyOtpCode(expected, enteredCode)) {
      record.authPath = isDemo === 'true' ? 'demo' : 'otp';
      return { authenticated: 'true', patientId };
    }
    return { authenticated: 'false' };
  },
);
