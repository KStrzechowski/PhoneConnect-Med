import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as connect from 'aws-cdk-lib/aws-connect';
import * as cr from 'aws-cdk-lib/custom-resources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';

const mockPort = 3000;
const githubRepository = 'KStrzechowski@57865141/PhoneConnect-Med@1339987698';
const speechLocale = 'pl_PL';

function globalIntent(name: string, utterances: string[]): lex.CfnBot.IntentProperty {
  return {
    name,
    sampleUtterances: utterances.map((utterance) => ({ utterance })),
    fulfillmentCodeHook: { enabled: true },
  };
}

const mainMenuUtterances = [
  'dzień dobry',
  'halo',
  'dzień dobry, dzwonię do przychodni',
  'co mogę tutaj załatwić',
  'co można u was załatwić',
  'jakie są opcje',
  'menu',
  'menu główne',
  'wróć do menu',
  'zacznijmy od nowa',
  'od początku',
  'w czym możecie pomóc',
  'nie wiem co wybrać',
  'co dalej',
];

const infoUtterances = [
  'jakie są godziny otwarcia',
  'do której jesteście otwarci',
  'od której pracujecie',
  'w jakich godzinach przyjmujecie',
  'kiedy przychodnia jest czynna',
  'czy dziś jest otwarte',
  'czy jesteście otwarci w sobotę',
  'gdzie się znajdujecie',
  'jaki jest adres',
  'podaj adres',
  'gdzie was znaleźć',
  'na jakiej ulicy jest przychodnia',
  'jak do was dojechać',
  'informacje o przychodni',
  'chcę się dowiedzieć o placówce',
];

const repeatUtterances = [
  'powtórz',
  'powtórz proszę',
  'powtórz to jeszcze raz',
  'jeszcze raz',
  'słucham?',
  'nie dosłyszałem',
  'nie usłyszałam',
  'nie zrozumiałem',
  'możesz powtórzyć',
  'mógłbyś powtórzyć',
  'co powiedziałeś',
  'przepraszam, nie usłyszałem',
];

const agentTransferUtterances = [
  'połącz z agentem',
  'połącz mnie z rejestracją',
  'przełącz mnie do rejestracji',
  'chcę rozmawiać z człowiekiem',
  'chcę rozmawiać z osobą',
  'chcę z kimś porozmawiać',
  'nie chcę rozmawiać z automatem',
  'człowiek proszę',
  'poproszę o konsultanta',
  'daj mi kogoś z obsługi',
  'potrzebuję pomocy pracownika',
  'operator',
  'konsultant',
  'pomoc',
];

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
      repositoryName: 'phoneconnect-med-his',
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

    const composeFile = `services:
  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: his
      POSTGRES_PASSWORD: his
      POSTGRES_DB: his
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U his"]
      interval: 5s
      timeout: 5s
      retries: 5
    volumes:
      - his-postgres-data:/var/lib/postgresql/data
  his:
    image: \${HIS_IMAGE}
    restart: always
    ports:
      - "${mockPort}:${mockPort}"
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_USERNAME: his
      DB_PASSWORD: his
      DB_DATABASE: his
    depends_on:
      postgres:
        condition: service_healthy
volumes:
  his-postgres-data:
`;

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'dnf install -y docker',
      'systemctl enable --now docker',
      'mkdir -p /usr/libexec/docker/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/download/v2.29.2/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose',
      'chmod +x /usr/libexec/docker/cli-plugins/docker-compose',
      `aws ecr get-login-password --region ${this.region} | docker login --username AWS --password-stdin ${images.repositoryUri}`,
      'mkdir -p /opt/his',
      `cat > /opt/his/docker-compose.yml <<'EOF'\n${composeFile}EOF`,
      `echo "HIS_IMAGE=${image}" > /opt/his/.env`,
      'docker compose -f /opt/his/docker-compose.yml --env-file /opt/his/.env up -d postgres',
      'docker compose -f /opt/his/docker-compose.yml --env-file /opt/his/.env up -d his || ' +
        'echo "his did not start on first boot (image likely missing from ECR yet) - the deploy pipeline starts it on first push"',
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
      userDataCausesReplacement: true,
    });

    const measurements = new logs.LogGroup(this, 'Measurements', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const repoRoot = path.join(__dirname, '../..');
    const connectHealth = new NodejsFunction(this, 'ConnectHealth', {
      entry: path.join(repoRoot, 'lambdas/connect-health/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(2),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    const facilityInfo = new NodejsFunction(this, 'FacilityInfo', {
      entry: path.join(repoRoot, 'lambdas/facility-info/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(2),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    const connectInstanceArn: string | undefined = this.node.tryGetContext('connectInstanceArn');
    if (!connectInstanceArn) {
      throw new Error(
        'Missing context value connectInstanceArn. Pass the Connect instance ARN, ' +
          'for example: cdk synth -c connectInstanceArn=arn:aws:connect:eu-central-1:<account>:instance/<id>',
      );
    }

    connectHealth.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'ConnectFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: connectHealth.functionArn,
    });

    facilityInfo.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'FacilityInfoFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: facilityInfo.functionArn,
    });

    const facilityInfoSpeech = new NodejsFunction(this, 'FacilityInfoSpeech', {
      entry: path.join(repoRoot, 'lambdas/facility-info-speech/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(2),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    const speechConversations = new logs.LogGroup(this, 'SpeechConversations', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const speechBotRole = new iam.Role(this, 'SpeechBotRole', {
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
    });
    speechBotRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }),
    );
    speechConversations.grantWrite(speechBotRole);

    const speechBot = new lex.CfnBot(this, 'SpeechBot', {
      name: 'PhoneConnect-Med-FacilityInfoSpeech',
      roleArn: speechBotRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: speechLocale,
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Ola', engine: 'neural' },
          intents: [
            globalIntent('MainMenuIntent', mainMenuUtterances),
            globalIntent('InfoIntent', infoUtterances),
            globalIntent('RepeatIntent', repeatUtterances),
            globalIntent('AgentTransferIntent', agentTransferUtterances),
            {
              name: 'FallbackIntent',
              parentIntentSignature: 'AMAZON.FallbackIntent',
              fulfillmentCodeHook: { enabled: true },
            },
          ],
        },
      ],
    });

    const speechBotVersion = new lex.CfnBotVersion(this, 'SpeechBotVersion', {
      botId: speechBot.attrId,
      botVersionLocaleSpecification: [
        { localeId: speechLocale, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
      ],
    });

    const speechBotAlias = new lex.CfnBotAlias(this, 'SpeechBotAlias', {
      botId: speechBot.attrId,
      botVersion: speechBotVersion.attrBotVersion,
      botAliasName: 'live',
      botAliasLocaleSettings: [
        {
          localeId: speechLocale,
          botAliasLocaleSetting: {
            enabled: true,
            codeHookSpecification: {
              lambdaCodeHook: {
                lambdaArn: facilityInfoSpeech.functionArn,
                codeHookInterfaceVersion: '1.0',
              },
            },
          },
        },
      ],
      conversationLogSettings: {
        textLogSettings: [
          {
            enabled: true,
            destination: {
              cloudWatch: {
                cloudWatchLogGroupArn: speechConversations.logGroupArn,
                logPrefix: 'facility-info-speech/',
              },
            },
          },
        ],
      },
    });

    facilityInfoSpeech.addPermission('LexInvoke', {
      principal: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      sourceArn: speechBotAlias.attrArn,
    });

    const speechBotConnectInstanceId = cdk.Arn.split(
      connectInstanceArn,
      cdk.ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName;

    const speechBotAssociation = {
      InstanceId: speechBotConnectInstanceId,
      LexV2Bot: { AliasArn: speechBotAlias.attrArn },
    };

    new cr.AwsCustomResource(this, 'SpeechBotConnectAssociation', {
      onCreate: {
        service: 'connect',
        action: 'AssociateBot',
        parameters: speechBotAssociation,
        physicalResourceId: cr.PhysicalResourceId.of(`${speechBotConnectInstanceId}-facility-info-speech-bot`),
      },
      onDelete: {
        service: 'connect',
        action: 'DisassociateBot',
        parameters: speechBotAssociation,
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['connect:AssociateBot', 'connect:DisassociateBot'],
          resources: [connectInstanceArn, `${connectInstanceArn}/*`],
        }),
        new iam.PolicyStatement({
          actions: [
            'lex:DescribeBotAlias',
            'lex:CreateResourcePolicy',
            'lex:UpdateResourcePolicy',
            'lex:DeleteResourcePolicy',
          ],
          resources: [speechBotAlias.attrArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

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

    const deployRole = new iam.Role(this, 'DeployRole', {
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${githubRepository}:ref:refs/heads/main`,
        },
      }),
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
    new cdk.CfnOutput(this, 'FacilityInfoFunctionName', { value: facilityInfo.functionName });
    new cdk.CfnOutput(this, 'FacilityInfoSpeechFunctionName', { value: facilityInfoSpeech.functionName });
    new cdk.CfnOutput(this, 'SpeechBotAliasArn', { value: speechBotAlias.attrArn });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'MeasurementLogGroup', { value: measurements.logGroupName });
  }
}
