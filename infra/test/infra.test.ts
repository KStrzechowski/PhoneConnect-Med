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

test('both functions may be invoked by the telephony instance', () => {
  const permissions = template.findResources('AWS::Lambda::Permission', {
    Properties: { Principal: 'connect.amazonaws.com' },
  });
  expect(Object.keys(permissions)).toHaveLength(2);
});

test('the speech bot has all 5 global-layer intents under pl_PL', () => {
  template.hasResourceProperties('AWS::Lex::Bot', {
    DataPrivacy: { ChildDirected: false },
    BotLocales: Match.arrayWith([
      Match.objectLike({
        LocaleId: 'pl_PL',
        Intents: Match.arrayWith([
          Match.objectLike({ Name: 'MainMenuIntent' }),
          Match.objectLike({ Name: 'InfoIntent' }),
          Match.objectLike({ Name: 'RepeatIntent' }),
          Match.objectLike({ Name: 'AgentTransferIntent' }),
          Match.objectLike({ Name: 'FallbackIntent' }),
        ]),
      }),
    ]),
  });
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

test('both functions are associated with the telephony instance', () => {
  const associations = template.findResources('AWS::Connect::IntegrationAssociation');
  const targets = Object.values(associations).map(
    (assoc) => (assoc.Properties.IntegrationArn as { 'Fn::GetAtt': [string, string] })['Fn::GetAtt'][0],
  );
  expect(targets).toHaveLength(2);
  expect(targets.some((t) => t.startsWith('ConnectHealth'))).toBe(true);
  expect(targets.some((t) => t.startsWith('FacilityInfo'))).toBe(true);
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
