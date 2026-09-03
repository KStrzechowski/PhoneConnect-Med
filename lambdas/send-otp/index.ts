import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { measured, downstream } from '@pcm/measure';
import { generateOtpCode } from '@pcm/patient';

const sns = new SNSClient({});

export const handler = measured(
  'send-otp',
  async (event, record): Promise<Record<string, string>> => {
    const { code = '', phone = '', isDemo = 'false', isResend = 'false' } = event.Details?.Parameters ?? {};
    if (isDemo === 'true') return { code };

    const outgoingCode = isResend === 'true' ? generateOtpCode() : code;
    try {
      await downstream(record, () =>
        sns.send(
          new PublishCommand({
            PhoneNumber: phone,
            Message: `Twój kod weryfikacyjny PhoneConnect Med: ${outgoingCode}`,
          }),
        ),
      );
    } catch (error) {
      record.outcome = 'error';
      record.error = String(error);
    }
    return { code: outgoingCode };
  },
);
