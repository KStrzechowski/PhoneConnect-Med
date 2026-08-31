import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

const githubRepository = 'KStrzechowski/PhoneConnect-Med';
const cdkBootstrapQualifier = 'hnb659fds';

// No dependency on InfraStack/SpikeStack — these roles only need to run `cdk diff`/`cdk deploy`
// against them, so they must survive a destroy-and-recreate of either app stack.
export class GithubOidcStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubOidcProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubOidc',
      cdk.Arn.format(
        {
          service: 'iam',
          region: '',
          resource: 'oidc-provider',
          resourceName: 'token.actions.githubusercontent.com',
        },
        this,
      ),
    );

    const cdkBootstrapRoleArn = (role: string) =>
      cdk.Arn.format(
        { service: 'iam', region: '', resource: 'role', resourceName: `cdk-${cdkBootstrapQualifier}-${role}-role-${this.account}-${this.region}` },
        this,
      );
    const anyStackArn = cdk.Arn.format({ service: 'cloudformation', resource: 'stack', resourceName: '*/*' }, this);

    // Assumed by GitHub Actions on PRs and on pushes to main to run `cdk diff`. Cannot assume
    // the deploy or file-publishing bootstrap roles, so it cannot execute a deploy or publish
    // assets even if the workflow that assumes it were compromised.
    const cdkDiffRole = new iam.Role(this, 'CdkDiffRole', {
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: { 'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com' },
        StringLike: {
          'token.actions.githubusercontent.com:sub': [
            `repo:${githubRepository}:pull_request`,
            `repo:${githubRepository}:ref:refs/heads/main`,
          ],
        },
      }),
    });
    cdkDiffRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['sts:AssumeRole'], resources: [cdkBootstrapRoleArn('lookup')] }),
    );
    cdkDiffRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:GetTemplate',
          'cloudformation:DescribeStackEvents',
          'cloudformation:ListStacks',
        ],
        resources: [anyStackArn],
      }),
    );

    // Assumed only by the `infra-deploy` environment-gated job: GitHub only mints a token whose
    // sub claim is `environment:infra-deploy` for a job that actually declares that environment,
    // so this role is unreachable without the environment's required-reviewer approval.
    const cdkDeployRole = new iam.Role(this, 'CdkDeployRole', {
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${githubRepository}:environment:infra-deploy`,
        },
      }),
    });
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: [cdkBootstrapRoleArn('deploy'), cdkBootstrapRoleArn('file-publishing'), cdkBootstrapRoleArn('lookup')],
      }),
    );
    cdkDeployRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: [anyStackArn] }),
    );

    new cdk.CfnOutput(this, 'CdkDiffRoleArn', { value: cdkDiffRole.roleArn });
    new cdk.CfnOutput(this, 'CdkDeployRoleArn', { value: cdkDeployRole.roleArn });
  }
}
