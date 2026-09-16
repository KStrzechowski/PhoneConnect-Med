import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const polishUtterances = [
  'chcę się zalogować',
  'zaloguj mnie',
  'chcę się zidentyfikować',
  'chcę potwierdzić tożsamość',
  'chcę się uwierzytelnić',
  'podam swoje dane',
  'mogę podać PESEL',
  'mam podać numer PESEL',
  'jak się zalogować',
];

const englishUtterances = [
  'I want to log in',
  'log me in',
  'I need to identify myself',
  "I'd like to confirm my identity",
  'I want to authenticate',
  'I can give you my details',
  "I'll give you my PESEL number",
  'how do I log in',
  'I need to verify who I am',
];

function say(value: string): lex.CfnBot.MessageGroupProperty {
  return { message: { plainTextMessage: { value } } };
}

function authIntent(
  utterances: string[],
  closingMessage: string,
): lex.CfnBot.IntentProperty {
  return {
    name: 'AuthIntent',
    sampleUtterances: utterances.map((utterance) => ({ utterance })),
    intentClosingSetting: { closingResponse: { messageGroupsList: [say(closingMessage)] } },
  };
}

function fallbackIntent(closingMessage: string): lex.CfnBot.IntentProperty {
  return {
    name: 'FallbackIntent',
    parentIntentSignature: 'AMAZON.FallbackIntent',
    intentClosingSetting: { closingResponse: { messageGroupsList: [say(closingMessage)] } },
  };
}

export class SpikeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    const connectInstanceArn: string | undefined = this.node.tryGetContext('connectInstanceArn');
    if (!connectInstanceArn) {
      throw new Error(
        'Missing context value connectInstanceArn. Pass the Connect instance ARN, ' +
          'for example: cdk synth -c connectInstanceArn=arn:aws:connect:eu-central-1:<account>:instance/<id>',
      );
    }

    const conversations = new logs.LogGroup(this, 'Conversations', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const botRole = new iam.Role(this, 'BotRole', {
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
    });
    botRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['polly:SynthesizeSpeech'], resources: ['*'] }),
    );
    conversations.grantWrite(botRole);

    const bot = new lex.CfnBot(this, 'Bot', {
      name: 'PhoneConnect-Med-LanguageDetectionSpike',
      roleArn: botRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: 'pl_PL',
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Ola', engine: 'neural' },
          intents: [
            authIntent(polishUtterances, 'Dziękuję.'),
            fallbackIntent('Nie zrozumiałam.'),
          ],
        },
        {
          localeId: 'en_US',
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Joanna', engine: 'neural' },
          intents: [
            authIntent(englishUtterances, 'Thank you.'),
            fallbackIntent("I didn't understand that."),
          ],
        },
      ],
    });

    const botVersion = new lex.CfnBotVersion(this, 'BotVersion', {
      botId: bot.attrId,
      botVersionLocaleSpecification: [
        { localeId: 'pl_PL', botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
        { localeId: 'en_US', botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
      ],
    });

    const botAlias = new lex.CfnBotAlias(this, 'BotAlias', {
      botId: bot.attrId,
      botVersion: botVersion.attrBotVersion,
      botAliasName: 'spike',
      botAliasLocaleSettings: [
        { localeId: 'pl_PL', botAliasLocaleSetting: { enabled: true } },
        { localeId: 'en_US', botAliasLocaleSetting: { enabled: true } },
      ],
      conversationLogSettings: {
        textLogSettings: [
          {
            enabled: true,
            destination: {
              cloudWatch: {
                cloudWatchLogGroupArn: conversations.logGroupArn,
                logPrefix: 'spike/',
              },
            },
          },
        ],
      },
    });

    const connectInstanceId = cdk.Arn.split(
      connectInstanceArn,
      cdk.ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName;

    const botAssociation = { InstanceId: connectInstanceId, LexV2Bot: { AliasArn: botAlias.attrArn } };

    new cr.AwsCustomResource(this, 'ConnectBotAssociation', {
      onCreate: {
        service: 'connect',
        action: 'AssociateBot',
        parameters: botAssociation,
        physicalResourceId: cr.PhysicalResourceId.of(`${connectInstanceId}-language-detect-spike-bot`),
      },
      onDelete: {
        service: 'connect',
        action: 'DisassociateBot',
        parameters: botAssociation,
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
          resources: [botAlias.attrArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    new cdk.CfnOutput(this, 'SpikeBotAliasArn', { value: botAlias.attrArn });
    new cdk.CfnOutput(this, 'SpikeConversationLogGroup', { value: conversations.logGroupName });
  }
}
