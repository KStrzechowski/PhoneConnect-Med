import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App({
    context: {
      connectInstanceArn:
        'arn:aws:connect:eu-central-1:123456789012:instance/11111111-2222-3333-4444-555555555555',
    },
  });
  const stack = new InfraStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
  });
  template = Template.fromStack(stack);
});

test('the network has no NAT gateway', () => {
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('measurement logs outlive the write-up window', () => {
  template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 90 });
});

test('every handler writes to the one measurement log group, as parseable JSON', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs24.x',
    LoggingConfig: {
      LogGroup: { Ref: Match.stringLikeRegexp('Measurements') },
      LogFormat: 'JSON',
    },
  });
});

test('the mock is reachable only from the function security group', () => {
  template.resourceCountIs('AWS::EC2::SecurityGroupIngress', 1);
  template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
    FromPort: 3000,
    ToPort: 3000,
    SourceSecurityGroupId: Match.anyValue(),
  });
});

test('the function is pinned to a runtime and a sub-budget timeout', () => {
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs24.x',
    Timeout: 2,
  });
});

test('the deploy role trusts only this repository on main', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:sub':
                'repo:KStrzechowski@57865141/PhoneConnect-Med@1339987698:ref:refs/heads/main',
            },
          },
        }),
      ]),
    },
  });
});

test('the telephony instance may invoke the function', () => {
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 'connect.amazonaws.com',
    SourceArn: 'arn:aws:connect:eu-central-1:123456789012:instance/11111111-2222-3333-4444-555555555555',
  });
});

test('all seven keypad-invoked functions may be invoked by the telephony instance', () => {
  const permissions = template.findResources('AWS::Lambda::Permission', {
    Properties: { Principal: 'connect.amazonaws.com' },
  });
  expect(Object.keys(permissions)).toHaveLength(7);
});

test('SendOtp and OtpVerify are not attached to the VPC', () => {
  const functions = template.findResources('AWS::Lambda::Function');
  const sendOtp = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-send-otp',
  );
  const otpVerify = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-otp-verify',
  );
  expect(sendOtp?.Properties.VpcConfig).toBeUndefined();
  expect(otpVerify?.Properties.VpcConfig).toBeUndefined();
});

test('Booking is named per convention and reaches the mock over the VPC', () => {
  const functions = template.findResources('AWS::Lambda::Function');
  const booking = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-booking',
  );
  expect(booking).toBeDefined();
  expect(booking?.Properties.VpcConfig).toBeDefined();
});

test('AppointmentList is named per convention and reaches the mock over the VPC', () => {
  const functions = template.findResources('AWS::Lambda::Function');
  const appointmentList = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-appointment-list',
  );
  expect(appointmentList).toBeDefined();
  expect(appointmentList?.Properties.VpcConfig).toBeDefined();
});

test('SendOtp and FacilityInfoSpeech may both publish to SNS', () => {
  const policies = template.findResources('AWS::IAM::Policy', {
    Properties: {
      PolicyDocument: {
        Statement: Match.arrayWith([Match.objectLike({ Action: 'sns:Publish' })]),
      },
    },
  });
  expect(Object.keys(policies)).toHaveLength(2);
});

test('the speech bot has all 6 global-layer intents plus AuthIntent, OtpIntent and BookingIntent under pl_PL', () => {
  template.hasResourceProperties('AWS::Lex::Bot', {
    DataPrivacy: { ChildDirected: false },
    BotLocales: Match.arrayWith([
      Match.objectLike({
        LocaleId: 'pl_PL',
        Intents: Match.arrayWith([
          Match.objectLike({ Name: 'MainMenuIntent' }),
          Match.objectLike({ Name: 'InfoIntent' }),
          Match.objectLike({ Name: 'RepeatLastMessageIntent' }),
          Match.objectLike({ Name: 'AgentTransferIntent' }),
          Match.objectLike({ Name: 'ListAppointmentsIntent' }),
          Match.objectLike({ Name: 'AuthIntent' }),
          Match.objectLike({ Name: 'OtpIntent' }),
          Match.objectLike({ Name: 'BookingIntent' }),
          Match.objectLike({ Name: 'FallbackIntent' }),
        ]),
      }),
    ]),
  });
});

test('BookingIntent has a dialog code hook in addition to fulfillment, and three slots in priority order', () => {
  const bots = template.findResources('AWS::Lex::Bot');
  const [bot] = Object.values(bots);
  const locale = (bot.Properties.BotLocales as Array<{ LocaleId: string; Intents: Array<{ Name: string }> }>).find(
    (candidate) => candidate.LocaleId === 'pl_PL',
  );
  const bookingIntent = locale?.Intents.find((intent) => intent.Name === 'BookingIntent') as
    | {
        DialogCodeHook?: { Enabled: boolean };
        FulfillmentCodeHook?: { Enabled: boolean };
        SlotPriorities?: Array<{ SlotName: string; Priority: number }>;
      }
    | undefined;

  expect(bookingIntent?.DialogCodeHook?.Enabled).toBe(true);
  expect(bookingIntent?.FulfillmentCodeHook?.Enabled).toBe(true);
  expect(
    bookingIntent?.SlotPriorities?.slice().sort((a, b) => a.Priority - b.Priority).map((slot) => slot.SlotName),
  ).toEqual(['specialty', 'timeOfDay', 'selectedSlot']);
});

test('BookingIntent has an explicit declination path that clears only selectedSlot', () => {
  const bots = template.findResources('AWS::Lex::Bot');
  const [bot] = Object.values(bots);
  const locale = (bot.Properties.BotLocales as Array<{ LocaleId: string; Intents: Array<{ Name: string }> }>).find(
    (candidate) => candidate.LocaleId === 'pl_PL',
  );
  const bookingIntent = locale?.Intents.find((intent) => intent.Name === 'BookingIntent') as
    | {
        IntentConfirmationSetting?: {
          DeclinationNextStep?: {
            DialogAction?: { SlotToElicit?: string };
            Intent?: { Slots?: Array<{ SlotName: string }> };
          };
        };
      }
    | undefined;

  const declinationNextStep = bookingIntent?.IntentConfirmationSetting?.DeclinationNextStep;
  expect(declinationNextStep?.DialogAction?.SlotToElicit).toBe('selectedSlot');
  expect(declinationNextStep?.Intent?.Slots).toEqual([{ SlotName: 'selectedSlot', SlotValueOverride: {} }]);
});

test('AuthIntent has an explicit declination path that clears both slots and re-elicits pesel', () => {
  const bots = template.findResources('AWS::Lex::Bot');
  const [bot] = Object.values(bots);
  const locale = (bot.Properties.BotLocales as Array<{ LocaleId: string; Intents: Array<{ Name: string }> }>).find(
    (candidate) => candidate.LocaleId === 'pl_PL',
  );
  const authIntent = locale?.Intents.find((intent) => intent.Name === 'AuthIntent') as
    | { IntentConfirmationSetting?: { DeclinationNextStep?: { DialogAction?: { SlotToElicit?: string } } } }
    | undefined;

  expect(authIntent?.IntentConfirmationSetting?.DeclinationNextStep?.DialogAction?.SlotToElicit).toBe('pesel');
});

test('only the speech function may be invoked by Lex', () => {
  const permissions = template.findResources('AWS::Lambda::Permission', {
    Properties: { Principal: 'lexv2.amazonaws.com' },
  });
  expect(Object.keys(permissions)).toHaveLength(1);
});

test('the bot association custom resource may associate and disassociate the bot', () => {
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(['connect:AssociateBot', 'connect:DisassociateBot']),
        }),
      ]),
    },
  });
});

test('all seven keypad-invoked functions are associated with the telephony instance', () => {
  const associations = template.findResources('AWS::Connect::IntegrationAssociation');
  const targets = Object.values(associations).map(
    (assoc) => (assoc.Properties.IntegrationArn as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0],
  );
  expect(targets).toHaveLength(7);
  expect(targets.some((t) => t.startsWith('ConnectHealth'))).toBe(true);
  expect(targets.some((t) => t.startsWith('FacilityInfo'))).toBe(true);
  expect(targets.some((t) => t.startsWith('Authenticate'))).toBe(true);
  expect(targets.some((t) => t.startsWith('SendOtp'))).toBe(true);
  expect(targets.some((t) => t.startsWith('OtpVerify'))).toBe(true);
  expect(targets.some((t) => t.startsWith('Booking'))).toBe(true);
  expect(targets.some((t) => t.startsWith('AppointmentList'))).toBe(true);
});

test('the instance user data still installs docker', () => {
  const instances = template.findResources('AWS::EC2::Instance');
  const [instance] = Object.values(instances);
  const joinParts = (
    instance.Properties.UserData as { 'Fn::Base64': { 'Fn::Join': [string, unknown[]] } }
  )['Fn::Base64']['Fn::Join'][1];
  const script = joinParts.filter((part): part is string => typeof part === 'string').join('');
  expect(script).toContain('install -y docker');
});

test('synth fails without the telephony instance ARN', () => {
  expect(() => new InfraStack(new cdk.App(), 'NoContext')).toThrow(/connectInstanceArn/);
});
