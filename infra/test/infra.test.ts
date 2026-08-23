import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { InfraStack } from '../lib/infra-stack';

let template: Template;

beforeAll(() => {
  const stack = new InfraStack(new cdk.App(), 'TestStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
  });
  template = Template.fromStack(stack);
});

test('the network has no NAT gateway', () => {
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('function logs expire', () => {
  template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
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
