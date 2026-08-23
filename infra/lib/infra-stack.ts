import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const mockPort = 3000;
const githubRepository = 'KStrzechowski/PhoneConnect-Med';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });

    const functionSecurityGroup = new ec2.SecurityGroup(this, 'FunctionSecurityGroup', { vpc });

    const mockSecurityGroup = new ec2.SecurityGroup(this, 'MockSecurityGroup', { vpc });
    mockSecurityGroup.addIngressRule(functionSecurityGroup, ec2.Port.tcp(mockPort));

    const images = new ecr.Repository(this, 'MockImages', {
      repositoryName: 'phoneconnect-his',
      lifecycleRules: [{ maxImageCount: 5 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const instanceRole = new iam.Role(this, 'MockInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });
    images.grantPull(instanceRole);

    const image = `${images.repositoryUri}:latest`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf install -y docker',
      'systemctl enable --now docker',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${images.repositoryUri}`,
      `docker pull ${image} || exit 0`,
      `docker run -d --restart always --name his -p ${mockPort}:${mockPort} ${image}`,
    );

    const instance = new ec2.Instance(this, 'MockInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: mockSecurityGroup,
      role: instanceRole,
      associatePublicIpAddress: true,
      userData,
    });

    const connectHealthDir = path.join(__dirname, '../../lambdas/connect-health');
    const connectHealth = new NodejsFunction(this, 'ConnectHealth', {
      entry: path.join(connectHealthDir, 'index.ts'),
      projectRoot: connectHealthDir,
      depsLockFilePath: path.join(connectHealthDir, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(2),
      logGroup: new logs.LogGroup(this, 'ConnectHealthLogs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    const deployRole = new iam.Role(this, 'DeployRole', {
      assumedBy: new iam.OpenIdConnectPrincipal(
        new iam.OpenIdConnectProvider(this, 'GithubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        }),
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${githubRepository}:ref:refs/heads/main`,
          },
        },
      ),
    });
    images.grantPullPush(deployRole);

    const instanceArn = cdk.Arn.format(
      { service: 'ec2', resource: 'instance', resourceName: instance.instanceId },
      this,
    );

    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StartInstances'],
        resources: [instanceArn],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [
          instanceArn,
          cdk.Arn.format(
            { service: 'ssm', account: '', resource: 'document', resourceName: 'AWS-RunShellScript' },
            this,
          ),
        ],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'ec2:DescribeInstances',
          'ec2:DescribeInstanceStatus',
          'ssm:DescribeInstanceInformation',
          'ssm:GetCommandInvocation',
          'ssm:ListCommandInvocations',
        ],
        resources: ['*'],
      }),
    );

    new cdk.CfnOutput(this, 'MockInstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'MockPrivateIp', { value: instance.instancePrivateIp });
    new cdk.CfnOutput(this, 'ConnectHealthFunctionName', { value: connectHealth.functionName });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
  }
}
