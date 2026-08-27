import * as cdk from 'aws-cdk-lib/core';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

const locale = 'pl-PL';
const peselLength = 11;

const keypadAttempt: lex.CfnBot.PromptAttemptSpecificationProperty = {
  allowedInputTypes: { allowAudioInput: true, allowDtmfInput: true },
  allowInterrupt: false,
  audioAndDtmfInputSpecification: {
    startTimeoutMs: 10000,
    audioSpecification: { endTimeoutMs: 2000, maxLengthMs: 15000 },
    dtmfSpecification: {
      deletionCharacter: '*',
      endCharacter: '#',
      endTimeoutMs: 5000,
      maxLength: peselLength,
    },
  },
};

const spokenAttempt: lex.CfnBot.PromptAttemptSpecificationProperty = {
  allowedInputTypes: { allowAudioInput: true, allowDtmfInput: false },
  allowInterrupt: true,
};

function say(value: string): lex.CfnBot.MessageGroupProperty {
  return { message: { plainTextMessage: { value } } };
}

export class SpikeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
      name: 'PhoneConnect-Med-Spike',
      roleArn: botRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: locale,
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Ola', engine: 'neural' },
          slotTypes: [
            {
              name: 'KeyedDigits',
              valueSelectionSetting: { resolutionStrategy: 'ORIGINAL_VALUE' },
              slotTypeValues: [{ sampleValue: { value: '00000000000' } }],
            },
          ],
          intents: [
            {
              name: 'AuthIntent',
              sampleUtterances: [
                { utterance: 'chcę się zalogować' },
                { utterance: 'zaloguj mnie' },
                { utterance: 'chcę się zidentyfikować' },
                { utterance: 'chcę potwierdzić tożsamość' },
                { utterance: 'chcę się uwierzytelnić' },
                { utterance: 'podam swoje dane' },
                { utterance: 'mogę podać PESEL' },
                { utterance: 'mam podać numer PESEL' },
                { utterance: 'jak się zalogować' },
              ],
              slotPriorities: [
                { slotName: 'pesel', priority: 1 },
                { slotName: 'confirmation', priority: 2 },
              ],
              slots: [
                {
                  name: 'pesel',
                  slotTypeName: 'KeyedDigits',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [
                        say(
                          'Wprowadź numer PESEL na klawiaturze telefonu, a następnie naciśnij krzyżyk.',
                        ),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadAttempt,
                        Retry1: keypadAttempt,
                        Retry2: keypadAttempt,
                      },
                    },
                  },
                },
                {
                  name: 'confirmation',
                  slotTypeName: 'AMAZON.Confirmation',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      messageGroupsList: [say('Czy numer jest poprawny? Powiedz tak albo nie.')],
                      promptAttemptsSpecification: {
                        Initial: spokenAttempt,
                        Retry1: spokenAttempt,
                        Retry2: spokenAttempt,
                      },
                    },
                  },
                },
              ],
              intentClosingSetting: {
                closingResponse: { messageGroupsList: [say('Dziękuję.')] },
              },
            },
            {
              name: 'FallbackIntent',
              parentIntentSignature: 'AMAZON.FallbackIntent',
              intentClosingSetting: {
                closingResponse: { messageGroupsList: [say('Nie zrozumiałam.')] },
              },
            },
          ],
        },
      ],
    });

    const version = new lex.CfnBotVersion(this, 'BotVersion', {
      botId: bot.attrId,
      botVersionLocaleSpecification: [
        { localeId: locale, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
      ],
    });

    const alias = new lex.CfnBotAlias(this, 'BotAlias', {
      botId: bot.attrId,
      botVersion: version.attrBotVersion,
      botAliasName: 'spike',
      botAliasLocaleSettings: [{ localeId: locale, botAliasLocaleSetting: { enabled: true } }],
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

    const association = { InstanceId: connectInstanceId, LexV2Bot: { AliasArn: alias.attrArn } };

    new cr.AwsCustomResource(this, 'ConnectBotAssociation', {
      onCreate: {
        service: 'connect',
        action: 'AssociateBot',
        parameters: association,
        physicalResourceId: cr.PhysicalResourceId.of(`${connectInstanceId}-spike-bot`),
      },
      onDelete: {
        service: 'connect',
        action: 'DisassociateBot',
        parameters: association,
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
          resources: [alias.attrArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    new cdk.CfnOutput(this, 'SpikeBotAliasArn', { value: alias.attrArn });
    new cdk.CfnOutput(this, 'SpikeConversationLogGroup', { value: conversations.logGroupName });
  }
}
