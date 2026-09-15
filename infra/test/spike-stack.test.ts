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
    targetBotId: 'TARGETBOT01',
    targetBotAliasId: 'TARGETALIAS01',
    targetBotAliasArn: 'arn:aws:lex:eu-central-1:123456789012:bot-alias/TARGETBOT01/TARGETALIAS01',
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

test('the spike Lambda is async-compatible: a timeout well under the KVS/Transcribe budget but above the synchronous 8s cap', () => {
  const functions = template.findResources('AWS::Lambda::Function');
  const spikeFn = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-language-detect-spike',
  );
  expect(spikeFn).toBeDefined();
  expect(spikeFn?.Properties.Timeout).toBeGreaterThan(8);
  expect(spikeFn?.Properties.Timeout).toBeLessThanOrEqual(60);
});

test('the spike Lambda carries the bot id and alias id as environment variables', () => {
  const functions = template.findResources('AWS::Lambda::Function');
  const spikeFn = Object.values(functions).find(
    (fn) => fn.Properties.FunctionName === 'phoneconnect-med-language-detect-spike',
  );
  const variables = spikeFn?.Properties.Environment?.Variables as Record<string, unknown> | undefined;
  expect(variables?.BOT_ID).toBeDefined();
  expect(variables?.BOT_ALIAS_ID).toBeDefined();
});

test('the telephony instance may invoke the spike Lambda', () => {
  template.hasResourceProperties('AWS::Lambda::Permission', {
    Action: 'lambda:InvokeFunction',
    Principal: 'connect.amazonaws.com',
    SourceArn: 'arn:aws:connect:eu-central-1:123456789012:instance/11111111-2222-3333-4444-555555555555',
  });
});

test('the spike Lambda is associated with the telephony instance', () => {
  template.resourceCountIs('AWS::Connect::IntegrationAssociation', 1);
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
  expect(() =>
    new SpikeStack(new cdk.App(), 'NoContext', {
      targetBotId: 'TARGETBOT01',
      targetBotAliasId: 'TARGETALIAS01',
      targetBotAliasArn: 'arn:aws:lex:eu-central-1:123456789012:bot-alias/TARGETBOT01/TARGETALIAS01',
    }),
  ).toThrow(/connectInstanceArn/);
});
