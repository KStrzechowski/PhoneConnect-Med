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
                'repo:KStrzechowski/PhoneConnect-Med:ref:refs/heads/main',
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

test('synth fails without the telephony instance ARN', () => {
  expect(() => new InfraStack(new cdk.App(), 'NoContext')).toThrow(/connectInstanceArn/);
});
