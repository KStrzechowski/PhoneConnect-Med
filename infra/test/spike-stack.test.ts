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
  const stack = new SpikeStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
  });
  template = Template.fromStack(stack);
});

test('the bot has both pl_PL and en_US locales', () => {
  template.hasResourceProperties('AWS::Lex::Bot', {
    BotLocales: Match.arrayWith([
      Match.objectLike({ LocaleId: 'pl_PL' }),
      Match.objectLike({ LocaleId: 'en_US' }),
    ]),
  });
});

test('the bot version covers both locales', () => {
  template.hasResourceProperties('AWS::Lex::BotVersion', {
    BotVersionLocaleSpecification: Match.arrayWith([
      Match.objectLike({ LocaleId: 'pl_PL' }),
      Match.objectLike({ LocaleId: 'en_US' }),
    ]),
  });
});

test('the alias has text conversation logs, not audio', () => {
  template.hasResourceProperties('AWS::Lex::BotAlias', {
    ConversationLogSettings: {
      TextLogSettings: Match.arrayWith([Match.objectLike({ Enabled: true })]),
    },
  });
  const aliases = template.findResources('AWS::Lex::BotAlias');
  const [alias] = Object.values(aliases);
  expect(alias.Properties.ConversationLogSettings.AudioLogSettings).toBeUndefined();
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

test('synth fails without the telephony instance ARN', () => {
  expect(() => new SpikeStack(new cdk.App(), 'NoContext', {})).toThrow(/connectInstanceArn/);
});
