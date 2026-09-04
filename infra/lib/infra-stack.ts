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

function say(value: string): lex.CfnBot.MessageGroupProperty {
  return { message: { plainTextMessage: { value } } };
}

function slotValue(value: string, synonyms: string[]): lex.CfnBot.SlotTypeValueProperty {
  return { sampleValue: { value }, synonyms: synonyms.map((synonym) => ({ value: synonym })) };
}

function keypadOnlyAttempt(maxLength: number): lex.CfnBot.PromptAttemptSpecificationProperty {
  return {
    allowedInputTypes: { allowAudioInput: false, allowDtmfInput: true },
    allowInterrupt: false,
    audioAndDtmfInputSpecification: {
      startTimeoutMs: 10000,
      dtmfSpecification: {
        deletionCharacter: '*',
        endCharacter: '#',
        endTimeoutMs: 5000,
        maxLength,
      },
    },
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

const authUtterances = [
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

const otpUtterances = ['chcę podać kod', 'mam kod weryfikacyjny', 'podam kod z sms'];

const bookingUtterances = [
  'chcę umówić wizytę',
  'chcę się zapisać do lekarza',
  'chciałbym się zapisać',
  'potrzebuję wizyty',
  'potrzebuję terminu',
  'chcę się umówić do {specialty}',
  'chcę wizytę u {specialty}',
  'zapisz mnie do {specialty}',
  'zarejestruj mnie do {specialty}',
  'potrzebuję terminu u {specialty}',
  'czy jest wolny termin do {specialty}',
  'chcę się dostać do {specialty}',
  'chcę się umówić do {specialty} {timeOfDay}',
  'chcę się dostać do {specialty} {timeOfDay}',
  'umów mnie do {specialty} {timeOfDay}',
  'szukam terminu {timeOfDay}',
  'umów mnie {timeOfDay}',
];

const listAppointmentsUtterances = [
  'chcę usłyszeć moje wizyty',
  'jakie mam zaplanowane wizyty',
  'jakie mam terminy',
  'sprawdź moje wizyty',
  'przypomnij mi moje wizyty',
  'kiedy mam wizytę',
  'czy mam jakieś umówione wizyty',
  'wymień moje wizyty',
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
      roleName: 'phoneconnect-med-mock-instance',
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
      functionName: 'phoneconnect-med-connect-health',
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
      functionName: 'phoneconnect-med-facility-info',
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

    const authenticate = new NodejsFunction(this, 'Authenticate', {
      functionName: 'phoneconnect-med-authenticate',
      entry: path.join(repoRoot, 'lambdas/authenticate/index.ts'),
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

    authenticate.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'AuthenticateFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: authenticate.functionArn,
    });

    const sendOtp = new NodejsFunction(this, 'SendOtp', {
      functionName: 'phoneconnect-med-send-otp',
      entry: path.join(repoRoot, 'lambdas/send-otp/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(2),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    sendOtp.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] }),
    );

    sendOtp.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'SendOtpFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: sendOtp.functionArn,
    });

    const otpVerify = new NodejsFunction(this, 'OtpVerify', {
      functionName: 'phoneconnect-med-otp-verify',
      entry: path.join(repoRoot, 'lambdas/otp-verify/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(2),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    otpVerify.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'OtpVerifyFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: otpVerify.functionArn,
    });

    const booking = new NodejsFunction(this, 'Booking', {
      functionName: 'phoneconnect-med-booking',
      entry: path.join(repoRoot, 'lambdas/booking/index.ts'),
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

    booking.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'BookingFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: booking.functionArn,
    });

    const appointmentList = new NodejsFunction(this, 'AppointmentList', {
      functionName: 'phoneconnect-med-appointment-list',
      entry: path.join(repoRoot, 'lambdas/appointment-list/index.ts'),
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

    appointmentList.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'AppointmentListFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: appointmentList.functionArn,
    });

    const facilityInfoSpeech = new NodejsFunction(this, 'FacilityInfoSpeech', {
      functionName: 'phoneconnect-med-facility-info-speech',
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

    facilityInfoSpeech.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ['sns:Publish'], resources: ['*'] }),
    );

    const speechConversations = new logs.LogGroup(this, 'SpeechConversations', {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const speechBotRole = new iam.Role(this, 'SpeechBotRole', {
      roleName: 'phoneconnect-med-speech-bot',
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
          slotTypes: [
            {
              name: 'KeyedPesel',
              valueSelectionSetting: { resolutionStrategy: 'ORIGINAL_VALUE' },
              slotTypeValues: [{ sampleValue: { value: '00000000000' } }],
            },
            {
              name: 'KeyedPhone',
              valueSelectionSetting: { resolutionStrategy: 'ORIGINAL_VALUE' },
              slotTypeValues: [{ sampleValue: { value: '000000000' } }],
            },
            {
              name: 'KeyedOtpCode',
              valueSelectionSetting: { resolutionStrategy: 'ORIGINAL_VALUE' },
              slotTypeValues: [{ sampleValue: { value: '000000' } }],
            },
            {
              name: 'Specialty',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: [
                slotValue('kardiolog', ['lekarz od serca', 'kardiologia', 'serce']),
                slotValue('dermatolog', ['lekarz od skóry', 'dermatologia', 'skóra']),
                slotValue('okulista', ['lekarz od oczu', 'okulistyka', 'oczy', 'wzrok']),
                slotValue('laryngolog', ['lekarz od gardła', 'laryngologia', 'uszy', 'gardło']),
                slotValue('neurolog', ['neurologia']),
                slotValue('ortopeda', ['ortopedia', 'kości', 'staw']),
                slotValue('internista', ['lekarz rodzinny', 'lekarz pierwszego kontaktu', 'internistyczna']),
                slotValue('ginekolog', ['ginekologia']),
                slotValue('pediatra', ['lekarz dziecięcy', 'pediatria']),
                slotValue('endokrynolog', ['endokrynologia', 'hormony', 'tarczyca']),
                slotValue('chirurg', ['chirurgia']),
                slotValue('urolog', ['urologia']),
                slotValue('psychiatra', ['psychiatria']),
                slotValue('alergolog', ['alergologia', 'alergia']),
                slotValue('reumatolog', ['reumatologia']),
              ],
            },
            {
              name: 'TimeOfDay',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: [
                slotValue('rano', ['z rana', 'rankiem', 'o poranku', 'wcześnie']),
                slotValue('przed południem', ['przedpołudniem', 'dopołudnia']),
                slotValue('po południu', ['popołudniu', 'popołudniowe']),
                slotValue('wieczorem', ['na wieczór', 'wieczór', 'późno']),
              ],
            },
          ],
          intents: [
            globalIntent('MainMenuIntent', mainMenuUtterances),
            globalIntent('InfoIntent', infoUtterances),
            globalIntent('RepeatLastMessageIntent', repeatUtterances),
            globalIntent('AgentTransferIntent', agentTransferUtterances),
            globalIntent('ListAppointmentsIntent', listAppointmentsUtterances),
            {
              name: 'AuthIntent',
              sampleUtterances: authUtterances.map((utterance) => ({ utterance })),
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [
                { slotName: 'pesel', priority: 1 },
                { slotName: 'phone', priority: 2 },
              ],
              slots: [
                {
                  name: 'pesel',
                  slotTypeName: 'KeyedPesel',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [
                        say('Wprowadź numer PESEL na klawiaturze telefonu, a następnie naciśnij krzyżyk.'),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(11),
                        Retry1: keypadOnlyAttempt(11),
                        Retry2: keypadOnlyAttempt(11),
                      },
                    },
                  },
                },
                {
                  name: 'phone',
                  slotTypeName: 'KeyedPhone',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [
                        say('Wprowadź swój numer telefonu na klawiaturze, a następnie naciśnij krzyżyk.'),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(15),
                        Retry1: keypadOnlyAttempt(15),
                        Retry2: keypadOnlyAttempt(15),
                      },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [
                    say(
                      'Podano numer PESEL {pesel} oraz numer telefonu {phone}. Czy dane są poprawne? Powiedz tak albo nie.',
                    ),
                  ],
                },
                declinationResponse: {
                  messageGroupsList: [say('Proszę podać dane jeszcze raz.')],
                },
                declinationNextStep: {
                  dialogAction: { type: 'ElicitSlot', slotToElicit: 'pesel' },
                  intent: {
                    slots: [
                      { slotName: 'pesel', slotValueOverride: {} },
                      { slotName: 'phone', slotValueOverride: {} },
                    ],
                  },
                },
              },
            },
            {
              name: 'OtpIntent',
              sampleUtterances: otpUtterances.map((utterance) => ({ utterance })),
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [{ slotName: 'otpCode', priority: 1 }],
              slots: [
                {
                  name: 'otpCode',
                  slotTypeName: 'KeyedOtpCode',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [
                        say(
                          'Wprowadź otrzymany kod na klawiaturze telefonu, a następnie naciśnij krzyżyk. ' +
                            'Aby otrzymać nowy kod, naciśnij dziewięć.',
                        ),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(6),
                        Retry1: keypadOnlyAttempt(6),
                        Retry2: keypadOnlyAttempt(6),
                      },
                    },
                  },
                },
              ],
            },
            {
              name: 'BookingIntent',
              sampleUtterances: bookingUtterances.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [
                { slotName: 'specialty', priority: 1 },
                { slotName: 'timeOfDay', priority: 2 },
                { slotName: 'selectedSlot', priority: 3 },
              ],
              slots: [
                {
                  name: 'specialty',
                  slotTypeName: 'Specialty',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Do jakiego specjalisty chce się Pani/Pan umówić?')],
                    },
                  },
                },
                {
                  name: 'timeOfDay',
                  slotTypeName: 'TimeOfDay',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [
                        say(
                          'Jaka pora dnia Pani/Panu odpowiada: rano, przed południem, po południu, czy wieczorem?',
                        ),
                      ],
                    },
                  },
                },
                {
                  name: 'selectedSlot',
                  slotTypeName: 'AMAZON.Number',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Który numer Pani/Pan wybiera?')],
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Czy się zgadza? Powiedz tak albo nie.')],
                },
                declinationResponse: {
                  messageGroupsList: [say('Dobrze, wybierzmy inny termin.')],
                },
                declinationNextStep: {
                  dialogAction: { type: 'ElicitSlot', slotToElicit: 'selectedSlot' },
                  intent: {
                    slots: [{ slotName: 'selectedSlot', slotValueOverride: {} }],
                  },
                },
              },
            },
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
      roleName: 'phoneconnect-med-deploy',
      assumedBy: new iam.OpenIdConnectPrincipal(githubOidcProvider, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${githubRepository}:ref:refs/heads/main`,
        },
      }),
    });
    images.grantPullPush(deployRole);

    // MockInstance's AMI (latestAmazonLinux2023) can change between deploys, which forces EC2 to
    // replace the instance under a new id/ARN. Scope by the CloudFormation-managed stack-name tag
    // instead of a specific instance ARN so this permission doesn't go stale on replacement.
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:StartInstances', 'ssm:SendCommand'],
        resources: ['*'],
        conditions: { StringEquals: { 'aws:ResourceTag/aws:cloudformation:stack-name': this.stackName } },
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:SendCommand'],
        resources: [
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
    new cdk.CfnOutput(this, 'AuthenticateFunctionName', { value: authenticate.functionName });
    new cdk.CfnOutput(this, 'SendOtpFunctionName', { value: sendOtp.functionName });
    new cdk.CfnOutput(this, 'OtpVerifyFunctionName', { value: otpVerify.functionName });
    new cdk.CfnOutput(this, 'BookingFunctionName', { value: booking.functionName });
    new cdk.CfnOutput(this, 'AppointmentListFunctionName', { value: appointmentList.functionName });
    new cdk.CfnOutput(this, 'FacilityInfoSpeechFunctionName', { value: facilityInfoSpeech.functionName });
    new cdk.CfnOutput(this, 'SpeechBotAliasArn', { value: speechBotAlias.attrArn });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'MeasurementLogGroup', { value: measurements.logGroupName });
  }
}
