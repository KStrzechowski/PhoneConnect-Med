import * as path from 'node:path';
import * as crypto from 'node:crypto';
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
const speechLocaleEn = 'en_US';

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

function saySSML(value: string): lex.CfnBot.MessageGroupProperty {
  return { message: { ssmlMessage: { value: `<speak>${value}</speak>` } } };
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

function voiceAttempt(): lex.CfnBot.PromptAttemptSpecificationProperty {
  return {
    allowedInputTypes: { allowAudioInput: true, allowDtmfInput: false },
    allowInterrupt: false,
    audioAndDtmfInputSpecification: {
      startTimeoutMs: 8000,
      audioSpecification: {
        endTimeoutMs: 1500,
        maxLengthMs: 20000,
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
  'chciałbym się zidentyfikować',
  'chciałabym się zidentyfikować',
  'chcę potwierdzić tożsamość',
  'chcę się uwierzytelnić',
  'podam swoje dane',
  'mogę podać PESEL',
  'mam podać numer PESEL',
  'jak się zalogować',
];

const otpUtterances = [
  'chcę podać kod',
  'chciałbym podać kod',
  'chciałabym podać kod',
  'mam kod weryfikacyjny',
  'podam kod z sms',
];

const bookingUtterances = [
  // no slots yet
  'chcę umówić wizytę',
  'chciałbym umówić wizytę',
  'chciałabym umówić wizytę',
  'chcę się zapisać do lekarza',
  'chciałbym się zapisać',
  'chciałabym się zapisać',
  'potrzebuję wizyty',
  'potrzebuję terminu',
  'muszę umówić wizytę',
  'proszę o umówienie wizyty',
  'poproszę o wizytę',
  'czy mogę umówić wizytę',
  'czy jest możliwość umówienia wizyty',
  'zależy mi na wizycie',

  // specialty only
  'chcę się umówić do {specialty}',
  'chciałbym się umówić do {specialty}',
  'chciałabym się umówić do {specialty}',
  'chciałbym umówić się do {specialty}',
  'chciałabym umówić się do {specialty}',
  'chcę wizytę u {specialty}',
  'chcę wizytę do {specialty}',
  'wizyta do {specialty}',
  'wizyta u {specialty}',
  'termin do {specialty}',
  'termin u {specialty}',
  'zapisz mnie do {specialty}',
  'zarejestruj mnie do {specialty}',
  'potrzebuję terminu u {specialty}',
  'potrzebuję wizyty u {specialty}',
  'muszę się umówić do {specialty}',
  'proszę o wizytę do {specialty}',
  'poproszę o wizytę do {specialty}',
  'czy jest wolny termin do {specialty}',
  'czy mogę się umówić do {specialty}',
  'czy jest możliwość zapisania się do {specialty}',
  'chcę się dostać do {specialty}',
  'wolałbym się umówić do {specialty}',
  'wolałabym się umówić do {specialty}',

  // specialty + date
  'chcę się umówić do {specialty} na {preferredDate}',
  'chciałbym się umówić do {specialty} na {preferredDate}',
  'chciałabym się umówić do {specialty} na {preferredDate}',
  'chciałbym umówić się do {specialty} na {preferredDate}',
  'chciałabym umówić się do {specialty} na {preferredDate}',
  'chcę się dostać do {specialty} na {preferredDate}',
  'umów mnie do {specialty} na {preferredDate}',
  'wizyta do {specialty} na {preferredDate}',
  'termin do {specialty} na {preferredDate}',
  'proszę o wizytę do {specialty} na {preferredDate}',
  'zapisz mnie do {specialty} na {preferredDate}',
  'czy jest wolny termin do {specialty} na {preferredDate}',

  // date only (exact day)
  'szukam terminu na {preferredDate}',
  'umów mnie na {preferredDate}',
  'chciałbym umówić się na {preferredDate}',
  'chciałabym umówić się na {preferredDate}',
  'chciałbym się umówić na {preferredDate}',
  'chciałabym się umówić na {preferredDate}',
  'na {preferredDate}',
  'w {preferredDate}',
  'do {preferredDate}',
  'czy jest coś wolnego {preferredDate}',
  'czy macie coś wolnego na {preferredDate}',

  // date only (starting from / after)
  'od {preferredDateAfter}',
  'po {preferredDateAfter}',
  'zaczynając od {preferredDateAfter}',
  'poczynając od {preferredDateAfter}',
  'szukam terminu po {preferredDateAfter}',
  'umów mnie po {preferredDateAfter}',
  'chciałbym umówić się po {preferredDateAfter}',
  'chciałabym umówić się po {preferredDateAfter}',
  'chcę się umówić do {specialty} po {preferredDateAfter}',
  'czy jest coś wolnego po {preferredDateAfter}',

  // specialty + time (at/after)
  'chcę się umówić do {specialty} na {preferredTime}',

  // time only (at/after)
  'umów mnie na {preferredTime}',
  'chciałbym umówić się na {preferredTime}',
  'chciałabym umówić się na {preferredTime}',
  'na {preferredTime}',
  'o {preferredTime}',
  'o godzinie {preferredTime}',
  'od godziny {preferredTime}',
  'koło {preferredTime}',
  'około {preferredTime}',
  'po godzinie {preferredTime}',

  // time only (before) — always qualified with "godziny"/"godziną": a bare "do {ordinal}"/"przed
  // {ordinal}" is ambiguous with a day-of-month and Lex will sometimes misparse "po szesnastym
  // września" as time 16:00 + bare date "września" (defaulting to the 1st) if an unqualified
  // "po {preferredTime}" template is also declared.
  'przed {preferredTimeBefore}',
  'przed godziną {preferredTimeBefore}',
  'do godziny {preferredTimeBefore}',

  // time of day (rano / przed południem / po południu / wieczorem)
  '{preferredTimeOfDay}',
  'chcę się umówić do {specialty} {preferredTimeOfDay}',
  'chciałbym się umówić do {specialty} {preferredTimeOfDay}',
  'chciałabym się umówić do {specialty} {preferredTimeOfDay}',
  'wizyta do {specialty} {preferredTimeOfDay}',
  'chcę się umówić {preferredTimeOfDay}',
  'umów mnie {preferredTimeOfDay}',
  'czy jest coś wolnego {preferredTimeOfDay}',
  'chcę się umówić do {specialty} na {preferredDate} {preferredTimeOfDay}',
  'wizyta do {specialty} na {preferredDate} {preferredTimeOfDay}',

  // date + time, no specialty
  'umów mnie na {preferredDate} na {preferredTime}',
  'na {preferredDate} na {preferredTime}',
  'na {preferredDate} o {preferredTime}',
  'na {preferredDate} na godzinę {preferredTime}',
  'na {preferredDate} przed {preferredTimeBefore}',

  // specialty + date + time
  'chcę się umówić do {specialty} na {preferredDate} na {preferredTime}',
  'chciałbym się umówić do {specialty} na {preferredDate} na {preferredTime}',
  'chciałabym się umówić do {specialty} na {preferredDate} na {preferredTime}',
  'chciałbym umówić się do {specialty} na {preferredDate} na {preferredTime}',
  'chciałabym umówić się do {specialty} na {preferredDate} na {preferredTime}',
  'chcę się umówić do {specialty} na {preferredDate} na godzinę {preferredTime}',
  'chciałbym się umówić do {specialty} na {preferredDate} na godzinę {preferredTime}',
  'chciałabym się umówić do {specialty} na {preferredDate} na godzinę {preferredTime}',
  'zapisz mnie do {specialty} na {preferredDate} na {preferredTime}',
  'wizyta do {specialty} na {preferredDate} na {preferredTime}',
  'termin do {specialty} na {preferredDate} o {preferredTime}',
  'chcę się umówić do {specialty} na {preferredDate} przed {preferredTimeBefore}',
  'termin do {specialty} na {preferredDate} przed godziną {preferredTimeBefore}',

  // numbered choice by spoken time instead of by number
  '{selectedTime}',
  'godzina {selectedTime}',
  'wybieram {selectedTime}',
  'poproszę {selectedTime}',
  'poproszę o {selectedTime}',
  'chcę {selectedTime}',
  'o {selectedTime}',
  'ta o {selectedTime}',
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
  'co mam zaplanowane',
  'czy mam coś zaplanowanego',
  'chcę sprawdzić moje terminy',
];

const cancelUtterances = [
  'odwołaj wizytę',
  'chcę odwołać wizytę',
  'chciałbym odwołać wizytę',
  'chciałabym odwołać wizytę',
  'chcę odwołać',
  'muszę odwołać termin',
  'muszę odwołać wizytę',
  'anuluj moją wizytę',
  'proszę usunąć moją wizytę',
  'proszę anulować wizytę',
  'nie przyjdę na wizytę',
  'nie dam rady przyjść na wizytę',
  'chcę zrezygnować z wizyty',
  'chciałbym zrezygnować z wizyty',
  'chciałabym zrezygnować z wizyty',
  'czy mogę odwołać wizytę',
];

const rescheduleUtterances = [
  'chcę przełożyć wizytę',
  'chciałbym przełożyć wizytę',
  'chciałabym przełożyć wizytę',
  'chcę przesunąć wizytę',
  'chcę zmienić termin',
  'zmień termin',
  'zmiana terminu',
  'chcę zmienić datę wizyty',
  'przenieś moją wizytę',
  'nie mogę w tym terminie, chcę inny',
  'czy można przełożyć',
  'czy mogę przełożyć wizytę na inny dzień',
  'muszę zmienić termin wizyty',
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

const mainMenuUtterancesEn = [
  'hello',
  'hi',
  'hello, I am calling the clinic',
  'what can I do here',
  'what can I do with you',
  'what are my options',
  'menu',
  'main menu',
  'go back to the menu',
  'let us start over',
  'from the beginning',
  'how can you help me',
  'I do not know what to choose',
  'what is next',
];

const infoUtterancesEn = [
  'what are your opening hours',
  'when do you open',
  'when do you close',
  'what hours are you open',
  'is the clinic open today',
  'are you open on Saturday',
  'where are you located',
  'what is your address',
  'give me your address',
  'where can I find you',
  'what street is the clinic on',
  'how do I get to you',
  'information about the clinic',
  'I want to know about the facility',
];

const repeatUtterancesEn = [
  'repeat',
  'repeat please',
  'say that again',
  'again',
  'sorry?',
  'I did not catch that',
  'I did not hear that',
  'I did not understand',
  'can you repeat that',
  'could you repeat that',
  'what did you say',
  'sorry, I did not hear you',
];

const authUtterancesEn = [
  'I want to log in',
  'log me in',
  'I want to identify myself',
  'I would like to identify myself',
  'I want to confirm my identity',
  'I want to authenticate',
  'I will give my details',
  'I can give my PESEL number',
  'do I give my PESEL number',
  'how do I log in',
];

const otpUtterancesEn = [
  'I want to give the code',
  'I would like to give the code',
  'I have a verification code',
  'I will give the code from the text message',
];

const bookingUtterancesEn = [
  // no slots yet
  'I want to book an appointment',
  'I want to see a doctor',
  'I would like to make an appointment',
  'I need an appointment',
  'I need a time slot',
  'I have to book an appointment',
  'can I book an appointment',
  'is it possible to book an appointment',

  // specialty only
  'I want to book with a {specialty}',
  'I would like to book with a {specialty}',
  'I want an appointment with a {specialty}',
  'book me with a {specialty}',
  'register me with a {specialty}',
  'I need a slot with a {specialty}',
  'is there a free slot with a {specialty}',
  'I want to get in with a {specialty}',
  'can I book with a {specialty}',
  'I would prefer to see a {specialty}',

  // specialty + date
  'I want to book with a {specialty} on {preferredDate}',
  'I would like to book with a {specialty} on {preferredDate}',
  'I want to get in with a {specialty} on {preferredDate}',
  'book me with a {specialty} on {preferredDate}',
  'register me with a {specialty} on {preferredDate}',

  // date only (exact day)
  'I am looking for a slot on {preferredDate}',
  'book me for {preferredDate}',
  'I would like an appointment on {preferredDate}',
  'on {preferredDate}',
  'until {preferredDate}',
  'do you have anything free on {preferredDate}',

  // date only (starting from / after)
  'from {preferredDateAfter}',
  'after {preferredDateAfter}',
  'starting from {preferredDateAfter}',
  'I am looking for a slot after {preferredDateAfter}',
  'book me for anytime after {preferredDateAfter}',
  'do you have anything free after {preferredDateAfter}',
  'I want to book with a {specialty} after {preferredDateAfter}',

  // specialty/time only (at/after) — "from"/"after" alone are ambiguous with
  // {preferredDateAfter} (e.g. "after the 16th" vs "after 4pm"); keep only qualifiers that can't
  // also read as a date.
  'I want to book with a {specialty} at {preferredTime}',
  'book me at {preferredTime}',
  'I would like an appointment at {preferredTime}',
  'at {preferredTime}',
  'around {preferredTime}',

  // time only (before) — "until" alone is ambiguous with the exact-date "until {preferredDate}".
  'before {preferredTimeBefore}',

  // time of day (morning / late morning / afternoon / evening)
  '{preferredTimeOfDay}',
  'I want to book with a {specialty} {preferredTimeOfDay}',
  'I would like to book with a {specialty} {preferredTimeOfDay}',
  'book me with a {specialty} {preferredTimeOfDay}',
  'do you have anything free {preferredTimeOfDay}',
  'I want to book with a {specialty} on {preferredDate} {preferredTimeOfDay}',

  // date + time, no specialty
  'book me for {preferredDate} at {preferredTime}',
  'book me for {preferredDate} before {preferredTimeBefore}',

  // specialty + date + time
  'I want to book with a {specialty} on {preferredDate} at {preferredTime}',
  'I would like to book with a {specialty} on {preferredDate} at {preferredTime}',
  'book me with a {specialty} for {preferredDate} at {preferredTime}',
  'I want to book with a {specialty} on {preferredDate} before {preferredTimeBefore}',

  // numbered choice by spoken time instead of by number
  '{selectedTime}',
  'I will take {selectedTime}',
  "I'll take {selectedTime}",
  'the one at {selectedTime}',
  'at {selectedTime}',
];

const listAppointmentsUtterancesEn = [
  'I want to hear my appointments',
  'what appointments do I have',
  'what are my scheduled appointments',
  'check my appointments',
  'remind me of my appointments',
  'when is my appointment',
  'do I have any appointments booked',
  'list my appointments',
  'what do I have scheduled',
  'do I have anything scheduled',
];

const cancelUtterancesEn = [
  'cancel my appointment',
  'I want to cancel my appointment',
  'I would like to cancel my appointment',
  'I want to cancel',
  'I need to cancel my appointment',
  'cancel my booking',
  'please remove my appointment',
  'please cancel my appointment',
  'I will not be coming to my appointment',
  'I cannot make it to my appointment',
  'I want to give up my appointment',
  'can I cancel my appointment',
];

const rescheduleUtterancesEn = [
  'I want to reschedule my appointment',
  'I would like to reschedule my appointment',
  'I want to move my appointment',
  'I want to change my appointment time',
  'change the time',
  'change of appointment',
  'I want to change the date of my appointment',
  'move my appointment',
  'I cannot make that time, I want another one',
  'can I reschedule',
  'can I reschedule my appointment for another day',
  'I need to change my appointment',
];

const agentTransferUtterancesEn = [
  'connect me to an agent',
  'connect me to reception',
  'transfer me to reception',
  'I want to talk to a human',
  'I want to talk to a person',
  'I want to speak with someone',
  'I do not want to talk to a machine',
  'a human please',
  'can I speak to a representative',
  'give me someone from support',
  'I need help from a staff member',
  'operator',
  'representative',
  'help',
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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
      timeout: cdk.Duration.seconds(8),
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

    const appointmentCancel = new NodejsFunction(this, 'AppointmentCancel', {
      functionName: 'phoneconnect-med-appointment-cancel',
      entry: path.join(repoRoot, 'lambdas/appointment-cancel/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(8),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    appointmentCancel.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'AppointmentCancelFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: appointmentCancel.functionArn,
    });

    const appointmentReschedule = new NodejsFunction(this, 'AppointmentReschedule', {
      functionName: 'phoneconnect-med-appointment-reschedule',
      entry: path.join(repoRoot, 'lambdas/appointment-reschedule/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(8),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    appointmentReschedule.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'AppointmentRescheduleFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: appointmentReschedule.functionArn,
    });

    const agentAppointment = new NodejsFunction(this, 'AgentAppointment', {
      functionName: 'phoneconnect-med-agent-appointment',
      entry: path.join(repoRoot, 'lambdas/agent-appointment/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [functionSecurityGroup],
      allowPublicSubnet: true,
      environment: { MOCK_BASE_URL: `http://${instance.instancePrivateIp}:${mockPort}` },
      timeout: cdk.Duration.seconds(8),
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });

    agentAppointment.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'AgentAppointmentFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: agentAppointment.functionArn,
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
      timeout: cdk.Duration.seconds(8),
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

    const speechBotLocales: lex.CfnBot.BotLocaleProperty[] = [
        {
          localeId: speechLocale,
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Ola', engine: 'neural' },
          slotTypes: [
            {
              name: 'KeyedPesel',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{11}' },
              },
            },
            {
              name: 'KeyedPhone',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{1,15}' },
              },
            },
            {
              name: 'KeyedOtpCode',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{1,6}' },
              },
            },
            {
              name: 'Specialty',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: [
                slotValue('kardiolog', ['kardiologa', 'lekarz od serca', 'kardiologia', 'serce']),
                slotValue('dermatolog', ['dermatologa', 'lekarz od skóry', 'dermatologia', 'skóra']),
                slotValue('okulista', ['okulisty', 'lekarz od oczu', 'okulistyka', 'oczy', 'wzrok']),
                slotValue('laryngolog', [
                  'laryngologa',
                  'lekarz od gardła',
                  'lekarz od uszu nosa i gardła',
                  'laryngologia',
                  'uszy',
                  'gardło',
                ]),
                slotValue('neurolog', ['neurologa', 'lekarz od nerwów', 'neurologia']),
                slotValue('ortopeda', ['ortopedy', 'ortopedia', 'kości', 'staw']),
                slotValue('internista', [
                  'internisty',
                  'lekarz rodzinny',
                  'lekarza rodzinnego',
                  'lekarz pierwszego kontaktu',
                  'lekarz ogólny',
                  'lekarz poz',
                  'internistyczna',
                ]),
                slotValue('ginekolog', ['ginekologa', 'ginekologia']),
                slotValue('pediatra', ['pediatry', 'lekarz dziecięcy', 'lekarza dziecięcego', 'pediatria']),
                slotValue('endokrynolog', ['endokrynologa', 'endokrynologia', 'hormony', 'tarczyca']),
                slotValue('chirurg', ['chirurga', 'chirurgia']),
                slotValue('urolog', ['urologa', 'lekarz od dróg moczowych', 'urologia']),
                slotValue('psychiatra', ['psychiatry', 'psychiatria']),
                slotValue('alergolog', ['alergologa', 'alergologia', 'alergia']),
                slotValue('reumatolog', ['reumatologa', 'lekarz od reumatyzmu', 'reumatologia']),
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
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
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
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [
                    saySSML(
                      'Podano numer PESEL <say-as interpret-as="digits">{pesel}</say-as> oraz numer telefonu ' +
                        '<say-as interpret-as="digits">{phone}</say-as>. Czy dane są poprawne? Powiedz tak albo nie.',
                    ),
                  ],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
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
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
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
                { slotName: 'preferredDate', priority: 2 },
                { slotName: 'preferredDateAfter', priority: 3 },
                { slotName: 'preferredTime', priority: 4 },
                { slotName: 'preferredTimeBefore', priority: 5 },
                { slotName: 'preferredTimeOfDay', priority: 6 },
                { slotName: 'selectedSlot', priority: 7 },
                { slotName: 'selectedTime', priority: 8 },
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
                      messageGroupsList: [say('Do jakiego specjalisty chcą się Państwo umówić?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
                {
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Jaki dzień Państwu odpowiada?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredDateAfter',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Od jakiego dnia mamy szukać terminu?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTime',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('O której godzinie Państwu odpowiada?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTimeBefore',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Do której godziny Państwu odpowiada?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTimeOfDay',
                  slotTypeName: 'TimeOfDay',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Jaka pora dnia Państwu odpowiada?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
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
                      messageGroupsList: [say('Który numer Państwo wybierają?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
                {
                  name: 'selectedTime',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Który numer, albo o której godzinie, Państwo wybierają?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Czy się zgadza? Powiedz tak albo nie.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say('Dobrze, wybierzmy inny termin.')],
                },
                declinationNextStep: {
                  dialogAction: { type: 'ElicitSlot', slotToElicit: 'preferredDate' },
                  intent: {
                    slots: [
                      { slotName: 'preferredDate', slotValueOverride: {} },
                      { slotName: 'preferredDateAfter', slotValueOverride: {} },
                      { slotName: 'preferredTime', slotValueOverride: {} },
                      { slotName: 'preferredTimeBefore', slotValueOverride: {} },
                      { slotName: 'preferredTimeOfDay', slotValueOverride: {} },
                      { slotName: 'selectedSlot', slotValueOverride: {} },
                      { slotName: 'selectedTime', slotValueOverride: {} },
                    ],
                  },
                },
              },
            },
            {
              name: 'CancelAppointmentIntent',
              sampleUtterances: cancelUtterances.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [{ slotName: 'selectedSlot', priority: 1 }],
              slots: [
                {
                  name: 'selectedSlot',
                  slotTypeName: 'AMAZON.Number',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Który numer Państwo wybierają?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Czy się zgadza? Powiedz tak albo nie.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say('Dobrze, zostawiam tę wizytę bez zmian.')],
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
              name: 'RescheduleIntent',
              sampleUtterances: rescheduleUtterances.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [
                { slotName: 'timeOfDay', priority: 1 },
                { slotName: 'selectedSlot', priority: 2 },
              ],
              slots: [
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
                          'Jaka pora dnia Państwu odpowiada: rano, przed południem, po południu, czy wieczorem?',
                        ),
                      ],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
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
                      messageGroupsList: [say('Który numer Państwo wybierają?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Czy się zgadza? Powiedz tak albo nie.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
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
        {
          localeId: speechLocaleEn,
          nluConfidenceThreshold: 0.4,
          voiceSettings: { voiceId: 'Joanna', engine: 'neural' },
          slotTypes: [
            {
              name: 'KeyedPesel',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{11}' },
              },
            },
            {
              name: 'KeyedPhone',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{1,15}' },
              },
            },
            {
              name: 'KeyedOtpCode',
              parentSlotTypeSignature: 'AMAZON.AlphaNumeric',
              valueSelectionSetting: {
                resolutionStrategy: 'ORIGINAL_VALUE',
                regexFilter: { pattern: '[0-9]{1,6}' },
              },
            },
            {
              name: 'Specialty',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: [
                slotValue('kardiolog', ['cardiologist', 'heart doctor', 'cardiology', 'heart']),
                slotValue('dermatolog', ['dermatologist', 'skin doctor', 'dermatology', 'skin']),
                slotValue('okulista', ['ophthalmologist', 'eye doctor', 'ophthalmology', 'eyes', 'vision']),
                slotValue('laryngolog', ['ent doctor', 'ent', 'ear nose and throat doctor', 'throat doctor']),
                slotValue('neurolog', ['neurologist', 'neurology']),
                slotValue('ortopeda', ['orthopedist', 'orthopedics', 'bones', 'joint']),
                slotValue('internista', ['family doctor', 'general practitioner', 'internal medicine']),
                slotValue('ginekolog', ['gynecologist', 'gynecology']),
                slotValue('pediatra', ['pediatrician', 'pediatrics', 'child doctor']),
                slotValue('endokrynolog', ['endocrinologist', 'endocrinology', 'hormones', 'thyroid']),
                slotValue('chirurg', ['surgeon', 'surgery']),
                slotValue('urolog', ['urologist', 'urology']),
                slotValue('psychiatra', ['psychiatrist', 'psychiatry']),
                slotValue('alergolog', ['allergist', 'allergy', 'allergology']),
                slotValue('reumatolog', ['rheumatologist', 'rheumatology']),
              ],
            },
            {
              name: 'TimeOfDay',
              valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
              slotTypeValues: [
                slotValue('rano', ['morning', 'early morning', 'early']),
                slotValue('przed południem', ['late morning', 'before noon', 'before midday']),
                slotValue('po południu', ['afternoon', 'in the afternoon']),
                slotValue('wieczorem', ['evening', 'in the evening', 'late']),
              ],
            },
          ],
          intents: [
            globalIntent('MainMenuIntent', mainMenuUtterancesEn),
            globalIntent('InfoIntent', infoUtterancesEn),
            globalIntent('RepeatLastMessageIntent', repeatUtterancesEn),
            globalIntent('AgentTransferIntent', agentTransferUtterancesEn),
            globalIntent('ListAppointmentsIntent', listAppointmentsUtterancesEn),
            {
              name: 'AuthIntent',
              sampleUtterances: authUtterancesEn.map((utterance) => ({ utterance })),
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
                        say('Enter your PESEL number on the keypad, then press the pound key.'),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(11),
                        Retry1: keypadOnlyAttempt(11),
                        Retry2: keypadOnlyAttempt(11),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
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
                        say('Enter your phone number on the keypad, then press the pound key.'),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(15),
                        Retry1: keypadOnlyAttempt(15),
                        Retry2: keypadOnlyAttempt(15),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [
                    saySSML(
                      'You entered PESEL number <say-as interpret-as="digits">{pesel}</say-as> and phone number ' +
                        '<say-as interpret-as="digits">{phone}</say-as>. Is that correct? Please say yes or no.',
                    ),
                  ],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say('Please enter your details again.')],
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
              sampleUtterances: otpUtterancesEn.map((utterance) => ({ utterance })),
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
                          'Enter the code you received on the keypad, then press the pound key. ' +
                            'To get a new code, press nine.',
                        ),
                      ],
                      promptAttemptsSpecification: {
                        Initial: keypadOnlyAttempt(6),
                        Retry1: keypadOnlyAttempt(6),
                        Retry2: keypadOnlyAttempt(6),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: false },
                    },
                  },
                },
              ],
            },
            {
              name: 'BookingIntent',
              sampleUtterances: bookingUtterancesEn.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [
                { slotName: 'specialty', priority: 1 },
                { slotName: 'preferredDate', priority: 2 },
                { slotName: 'preferredDateAfter', priority: 3 },
                { slotName: 'preferredTime', priority: 4 },
                { slotName: 'preferredTimeBefore', priority: 5 },
                { slotName: 'preferredTimeOfDay', priority: 6 },
                { slotName: 'selectedSlot', priority: 7 },
                { slotName: 'selectedTime', priority: 8 },
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
                      messageGroupsList: [say('Which specialist would you like to see?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
                {
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('What day would work for you?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredDateAfter',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('What day should we start searching from?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTime',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('What time would work for you?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTimeBefore',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('What time should it be before?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
                {
                  name: 'preferredTimeOfDay',
                  slotTypeName: 'TimeOfDay',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('What time of day would work for you?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
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
                      messageGroupsList: [say('Which number would you like to choose?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
                {
                  name: 'selectedTime',
                  slotTypeName: 'AMAZON.Time',
                  valueElicitationSetting: {
                    slotConstraint: 'Optional',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Which number, or what time, would you like to choose?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                    slotCaptureSetting: {
                      elicitationCodeHook: { enableCodeHookInvocation: true },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Is that correct? Please say yes or no.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say("Okay, let's choose another time.")],
                },
                declinationNextStep: {
                  dialogAction: { type: 'ElicitSlot', slotToElicit: 'preferredDate' },
                  intent: {
                    slots: [
                      { slotName: 'preferredDate', slotValueOverride: {} },
                      { slotName: 'preferredDateAfter', slotValueOverride: {} },
                      { slotName: 'preferredTime', slotValueOverride: {} },
                      { slotName: 'preferredTimeBefore', slotValueOverride: {} },
                      { slotName: 'preferredTimeOfDay', slotValueOverride: {} },
                      { slotName: 'selectedSlot', slotValueOverride: {} },
                      { slotName: 'selectedTime', slotValueOverride: {} },
                    ],
                  },
                },
              },
            },
            {
              name: 'CancelAppointmentIntent',
              sampleUtterances: cancelUtterancesEn.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [{ slotName: 'selectedSlot', priority: 1 }],
              slots: [
                {
                  name: 'selectedSlot',
                  slotTypeName: 'AMAZON.Number',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: false,
                      messageGroupsList: [say('Which number would you like to choose?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Is that correct? Please say yes or no.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say("Okay, I'll leave that appointment unchanged.")],
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
              name: 'RescheduleIntent',
              sampleUtterances: rescheduleUtterancesEn.map((utterance) => ({ utterance })),
              dialogCodeHook: { enabled: true },
              fulfillmentCodeHook: { enabled: true },
              slotPriorities: [
                { slotName: 'timeOfDay', priority: 1 },
                { slotName: 'selectedSlot', priority: 2 },
              ],
              slots: [
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
                          'What time of day works for you: morning, late morning, afternoon, or evening?',
                        ),
                      ],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
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
                      messageGroupsList: [say('Which number would you like to choose?')],
                      promptAttemptsSpecification: {
                        Initial: voiceAttempt(),
                        Retry1: voiceAttempt(),
                        Retry2: voiceAttempt(),
                      },
                    },
                  },
                },
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: false,
                  messageGroupsList: [say('Is that correct? Please say yes or no.')],
                  promptAttemptsSpecification: {
                    Initial: voiceAttempt(),
                    Retry1: voiceAttempt(),
                    Retry2: voiceAttempt(),
                  },
                },
                declinationResponse: {
                  messageGroupsList: [say("Okay, let's choose another time.")],
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
    ];

    const speechBot = new lex.CfnBot(this, 'SpeechBot', {
      name: 'PhoneConnect-Med-FacilityInfoSpeech',
      roleArn: speechBotRole.roleArn,
      dataPrivacy: { ChildDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: speechBotLocales,
    });

    // AWS::Lex::BotVersion only creates a fresh version when the DRAFT actually changed, and
    // CloudFormation only calls it at all when this resource's own properties change — which they
    // never do, since sourceBotVersion is always the literal string 'DRAFT'. Without a content
    // hash in the logical id, editing an intent/slot never rolls the alias onto a new version.
    const speechBotLocalesHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(speechBotLocales))
      .digest('hex')
      .slice(0, 10);

    const speechBotVersion = new lex.CfnBotVersion(this, `SpeechBotVersion${speechBotLocalesHash}`, {
      botId: speechBot.attrId,
      botVersionLocaleSpecification: [
        { localeId: speechLocale, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
        { localeId: speechLocaleEn, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
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
        {
          localeId: speechLocaleEn,
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
    new cdk.CfnOutput(this, 'AppointmentCancelFunctionName', { value: appointmentCancel.functionName });
    new cdk.CfnOutput(this, 'AppointmentRescheduleFunctionName', { value: appointmentReschedule.functionName });
    new cdk.CfnOutput(this, 'AgentAppointmentFunctionName', { value: agentAppointment.functionName });
    new cdk.CfnOutput(this, 'FacilityInfoSpeechFunctionName', { value: facilityInfoSpeech.functionName });
    new cdk.CfnOutput(this, 'SpeechBotAliasArn', { value: speechBotAlias.attrArn });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'MeasurementLogGroup', { value: measurements.logGroupName });
  }
}
