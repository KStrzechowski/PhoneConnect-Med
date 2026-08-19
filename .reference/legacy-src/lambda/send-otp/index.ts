import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { LexEvent, LexResponse } from '../shared/types';
import {
  generateOtp,
  otpTtl,
  saveOtpSession,
  logCall,
  lexClose,
  getSessionAttr,
} from '../shared/utils';

const snsClient = new SNSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

export const handler = async (event: LexEvent): Promise<LexResponse> => {
  const contactId = getSessionAttr(event, 'contactId') || event.sessionId;
  const pendingPesel = getSessionAttr(event, 'pendingPesel') || '';
  const pendingPhone = getSessionAttr(event, 'pendingPhone') || '';

  console.log('send-otp (resend) invoked', { sessionId: event.sessionId });

  if (!pendingPesel || !pendingPhone) {
    return lexClose(event, 'Failed',
      'Nie mogę wysłać kodu – brak danych weryfikacyjnych. Proszę rozpocząć logowanie od nowa.',
      { restartAuth: 'true' });
  }

  const otp = generateOtp();
  const sessionId = `otp-${contactId}-${Date.now()}`;
  const ttlMinutes = 5;

  await saveOtpSession({
    sessionId,
    pesel: pendingPesel,
    phoneNumber: pendingPhone,
    otpCode: otp,
    createdAt: new Date().toISOString(),
    ttl: otpTtl(ttlMinutes),
    attempts: 0,
    verified: false,
  });

  try {
    await snsClient.send(new PublishCommand({
      TopicArn: process.env.OTP_TOPIC_ARN,
      Message: `Nowy kod weryfikacyjny infolinii medycznej: ${otp}. Ważny ${ttlMinutes} minut.`,
      MessageAttributes: {
        'AWS.SNS.SMS.PhoneNumber': { DataType: 'String', StringValue: `+48${pendingPhone}` },
        'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
      },
    }));
  } catch (err) {
    console.error('SNS resend error', err);
  }

  await logCall(contactId, 'OTP_RESENT', { pesel: pendingPesel, sessionId });

  return lexClose(event, 'Fulfilled',
    'Wysłałam nowy kod weryfikacyjny SMS. Proszę go teraz podać.',
    { otpSessionId: sessionId });
};
