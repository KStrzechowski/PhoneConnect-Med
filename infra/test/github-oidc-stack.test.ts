import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { GithubOidcStack } from '../lib/github-oidc-stack';

let template: Template;

beforeAll(() => {
  const app = new cdk.App();
  const stack = new GithubOidcStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-central-1' },
  });
  template = Template.fromStack(stack);
});

test('the diff role trusts PRs and pushes to main, but can only assume the read-only lookup role', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringLike: {
              'token.actions.githubusercontent.com:sub': [
                'repo:KStrzechowski/PhoneConnect-Med:pull_request',
                'repo:KStrzechowski/PhoneConnect-Med:ref:refs/heads/main',
              ],
            },
          },
        }),
      ]),
    },
  });
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRole',
          Resource: {
            'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp('cdk-hnb659fds-lookup-role')])],
          },
        }),
      ]),
    },
  });
});

test('the deploy role is reachable only through the infra-deploy environment', () => {
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: 'sts:AssumeRoleWithWebIdentity',
          Condition: {
            StringEquals: {
              'token.actions.githubusercontent.com:sub':
                'repo:KStrzechowski/PhoneConnect-Med:environment:infra-deploy',
            },
          },
        }),
      ]),
    },
  });
});

