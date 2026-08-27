import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SpikeStack } from '../lib/spike-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App({
    context: {
      connectInstanceArn:
        'arn:aws:connect:eu-central-1:123456789012:instance/11111111-2222-3333-4444-555555555555',
    },
  });
  const stack = new SpikeStack(app, 'TestSpikeStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
  });
  template = Template.fromStack(stack);
});

function peselSlot() {
  const [bot] = Object.values<any>(template.findResources('AWS::Lex::Bot'));
  const locale = bot.Properties.BotLocales.find((l: any) => l.LocaleId === 'pl-PL');
  const intent = locale.Intents.find((i: any) => i.Name === 'AuthIntent');
  return intent.Slots.find((s: any) => s.Name === 'pesel');
}

test('the bot speaks Polish', () => {
  template.hasResourceProperties('AWS::Lex::Bot', {
    BotLocales: Match.arrayWith([Match.objectLike({ LocaleId: 'pl-PL' })]),
  });
});

test('every prompt attempt for the PESEL accepts the keypad, not just the first ask', () => {
  const attempts = peselSlot().ValueElicitationSetting.PromptSpecification
    .PromptAttemptsSpecification;

  expect(Object.keys(attempts).sort()).toEqual(['Initial', 'Retry1', 'Retry2']);

  for (const attempt of Object.values<any>(attempts)) {
    expect(attempt.AllowedInputTypes.AllowDTMFInput).toBe(true);
    expect(attempt.AudioAndDTMFInputSpecification.DTMFSpecification).toEqual({
      DeletionCharacter: '*',
      EndCharacter: '#',
      EndTimeoutMs: 5000,
      MaxLength: 11,
    });
  }
});

test('the retry count matches the number of configured attempts', () => {
  const prompt = peselSlot().ValueElicitationSetting.PromptSpecification;
  expect(Object.keys(prompt.PromptAttemptsSpecification)).toHaveLength(prompt.MaxRetries + 1);
});

test('the spoken confirmation does not fall back to the keypad', () => {
  const [bot] = Object.values<any>(template.findResources('AWS::Lex::Bot'));
  const locale = bot.Properties.BotLocales.find((l: any) => l.LocaleId === 'pl-PL');
  const intent = locale.Intents.find((i: any) => i.Name === 'AuthIntent');
  const slot = intent.Slots.find((s: any) => s.Name === 'confirmation');

  for (const attempt of Object.values<any>(
    slot.ValueElicitationSetting.PromptSpecification.PromptAttemptsSpecification,
  )) {
    expect(attempt.AllowedInputTypes.AllowDTMFInput).toBe(false);
  }
});

test('conversations are logged as text, never as recorded audio', () => {
  const [alias] = Object.values<any>(template.findResources('AWS::Lex::BotAlias'));
  const logs = alias.Properties.ConversationLogSettings;

  expect(logs.TextLogSettings).toHaveLength(1);
  expect(logs.TextLogSettings[0].Enabled).toBe(true);
  expect(logs.AudioLogSettings).toBeUndefined();
});

test('the conversation log group does not survive teardown', () => {
  template.hasResource('AWS::Logs::LogGroup', { DeletionPolicy: 'Delete' });
});

test('synth fails without the telephony instance ARN', () => {
  expect(() => new SpikeStack(new cdk.App(), 'NoContext')).toThrow(/connectInstanceArn/);
});
