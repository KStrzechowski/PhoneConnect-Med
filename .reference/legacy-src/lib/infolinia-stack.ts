import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import { Construct } from 'constructs';
import { LexBotConstruct } from './lex-bot-construct';

export class InfoliniaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // =========================================================
    // 1. DYNAMODB TABLES
    // =========================================================

    // Sessions table – OTP sessions, TTL-based expiry
    const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
      tableName: 'infolinia-sessions',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY, // PoC only
      pointInTimeRecovery: false,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Call logs table – all invocations
    const callLogsTable = new dynamodb.Table(this, 'CallLogsTable', {
      tableName: 'infolinia-call-logs',
      partitionKey: { name: 'contactId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Facility config table – per-phone-number facility settings
    const facilityTable = new dynamodb.Table(this, 'FacilityTable', {
      tableName: 'infolinia-facilities',
      partitionKey: { name: 'phoneNumber', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // =========================================================
    // 2. S3 BUCKET – call recordings & reports
    // =========================================================
    const recordingsBucket = new s3.Bucket(this, 'RecordingsBucket', {
      bucketName: `infolinia-recordings-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
          id: 'expire-old-recordings',
        },
      ],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // =========================================================
    // 3. SNS TOPIC – OTP SMS delivery
    // =========================================================
    const otpTopic = new sns.Topic(this, 'OtpTopic', {
      topicName: 'infolinia-otp',
      displayName: 'Infolinia OTP SMS',
    });

    // Alert topic for CloudWatch alarms
    const alertTopic = new sns.Topic(this, 'AlertTopic', {
      topicName: 'infolinia-alerts',
      displayName: 'Infolinia Alarms',
    });

    // =========================================================
    // 4. SECRETS MANAGER – HIS API credentials
    // =========================================================
    const hisApiSecret = new secretsmanager.Secret(this, 'HisApiSecret', {
      secretName: 'infolinia/his-api',
      description: 'Credentials for HIS API integration',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ apiKey: 'REPLACE_ME', baseUrl: 'https://his.example.com/api' }),
        generateStringKey: 'apiKey',
      },
    });

    // =========================================================
    // 5. IAM ROLE FOR LAMBDAS (shared base role)
    // =========================================================
    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: 'infolinia-lambda-role',
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Grant DynamoDB access
    sessionsTable.grantReadWriteData(lambdaRole);
    callLogsTable.grantReadWriteData(lambdaRole);
    facilityTable.grantReadData(lambdaRole);

    // Grant SNS publish
    otpTopic.grantPublish(lambdaRole);

    // Grant Secrets Manager read
    hisApiSecret.grantRead(lambdaRole);

    // =========================================================
    // 6. COMMON LAMBDA ENVIRONMENT VARIABLES
    // =========================================================
    const commonEnv: Record<string, string> = {
      SESSIONS_TABLE: sessionsTable.tableName,
      CALL_LOGS_TABLE: callLogsTable.tableName,
      FACILITY_TABLE: facilityTable.tableName,
      OTP_TOPIC_ARN: otpTopic.topicArn,
      HIS_SECRET_NAME: hisApiSecret.secretName,
      LOG_LEVEL: 'INFO',
      NODE_ENV: 'production',
    };

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(8),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: commonEnv,
      architecture: lambda.Architecture.ARM_64,
    };

    // =========================================================
    // 7. LAMBDA FUNCTIONS
    // =========================================================

    const verifyPatientFn = new lambda.Function(this, 'VerifyPatientFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-verify-patient',
      description: 'Weryfikuje parę PESEL + telefon w systemie HIS',
      code: lambda.Code.fromAsset('lambda/verify-patient'),
      handler: 'index.handler',
    });

    const sendOtpFn = new lambda.Function(this, 'SendOtpFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-send-otp',
      description: 'Generuje i wysyła kod OTP przez SNS SMS',
      code: lambda.Code.fromAsset('lambda/send-otp'),
      handler: 'index.handler',
    });

    const verifyOtpFn = new lambda.Function(this, 'VerifyOtpFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-verify-otp',
      description: 'Weryfikuje kod OTP i TTL sesji',
      code: lambda.Code.fromAsset('lambda/verify-otp'),
      handler: 'index.handler',
    });

    const getPatientDataFn = new lambda.Function(this, 'GetPatientDataFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-get-patient-data',
      description: 'Pobiera dane pacjenta z HIS',
      code: lambda.Code.fromAsset('lambda/get-patient-data'),
      handler: 'index.handler',
    });

    const getAppointmentsFn = new lambda.Function(this, 'GetAppointmentsFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-get-appointments',
      description: 'Pobiera listę wizyt pacjenta z HIS',
      code: lambda.Code.fromAsset('lambda/get-appointments'),
      handler: 'index.handler',
    });

    const bookAppointmentFn = new lambda.Function(this, 'BookAppointmentFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-book-appointment',
      description: 'Rezerwuje wizytę w HIS',
      code: lambda.Code.fromAsset('lambda/book-appointment'),
      handler: 'index.handler',
    });

    const cancelAppointmentFn = new lambda.Function(this, 'CancelAppointmentFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-cancel-appointment',
      description: 'Odwołuje wizytę w HIS',
      code: lambda.Code.fromAsset('lambda/cancel-appointment'),
      handler: 'index.handler',
    });

    const rescheduleAppointmentFn = new lambda.Function(this, 'RescheduleAppointmentFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-reschedule-appointment',
      description: 'Przekłada wizytę na inny termin w HIS',
      code: lambda.Code.fromAsset('lambda/reschedule-appointment'),
      handler: 'index.handler',
    });

    const getSlotsFn = new lambda.Function(this, 'GetSlotsFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-get-slots',
      description: 'Pobiera dostępne terminy z HIS wg specjalizacji i pory dnia',
      code: lambda.Code.fromAsset('lambda/get-slots'),
      handler: 'index.handler',
    });

    const getFacilityConfigFn = new lambda.Function(this, 'GetFacilityConfigFn', {
      ...lambdaDefaults,
      functionName: 'infolinia-get-facility-config',
      description: 'Pobiera konfigurację placówki na podstawie numeru telefonu',
      code: lambda.Code.fromAsset('lambda/get-facility-config'),
      handler: 'index.handler',
    });

    // =========================================================
    // 8. MOCK HIS API GATEWAY
    // =========================================================
    const mockHisLambda = new lambda.Function(this, 'MockHisLambda', {
      ...lambdaDefaults,
      functionName: 'infolinia-mock-his',
      description: 'Mock systemu HIS – zastępuje realny HIS w środowisku PoC',
      code: lambda.Code.fromAsset('lambda/mock-his'),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(10),
      environment: {
        ...commonEnv,
        HIS_ENV: 'mock',
      },
    });

    const mockHisApi = new apigateway.RestApi(this, 'MockHisApi', {
      restApiName: 'infolinia-mock-his',
      description: 'Mock HIS REST API dla PoC infolinii medycznej',
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
      },
    });

    const mockHisIntegration = new apigateway.LambdaIntegration(mockHisLambda);

    // /patients
    const patients = mockHisApi.root.addResource('patients');
    patients.addMethod('GET', mockHisIntegration); // list/search
    const patientById = patients.addResource('{pesel}');
    patientById.addMethod('GET', mockHisIntegration); // get by PESEL

    // /appointments
    const appointments = mockHisApi.root.addResource('appointments');
    appointments.addMethod('GET', mockHisIntegration); // list by patient
    appointments.addMethod('POST', mockHisIntegration); // create
    const appointmentById = appointments.addResource('{appointmentId}');
    appointmentById.addMethod('GET', mockHisIntegration);
    appointmentById.addMethod('PUT', mockHisIntegration); // reschedule
    appointmentById.addMethod('DELETE', mockHisIntegration); // cancel

    // /slots
    const slots = mockHisApi.root.addResource('slots');
    slots.addMethod('GET', mockHisIntegration); // get available slots

    // /facilities
    const facilities = mockHisApi.root.addResource('facilities');
    const facilityByPhone = facilities.addResource('{phoneNumber}');
    facilityByPhone.addMethod('GET', mockHisIntegration);

    // Pass API URL to lambdas
    const hisApiUrl = mockHisApi.url;
    [
      verifyPatientFn, getPatientDataFn, getAppointmentsFn,
      bookAppointmentFn, cancelAppointmentFn, rescheduleAppointmentFn,
      getSlotsFn,
    ].forEach(fn => {
      fn.addEnvironment('HIS_API_URL', hisApiUrl);
    });

    // =========================================================
    // 9. LEX BOT CONSTRUCT
    // =========================================================
    const lexBot = new LexBotConstruct(this, 'LexBot', {
      botName: 'InfoliniaBot',
      fulfillmentLambdas: {
        verifyPatient: verifyPatientFn,
        sendOtp: sendOtpFn,
        verifyOtp: verifyOtpFn,
        getPatientData: getPatientDataFn,
        getAppointments: getAppointmentsFn,
        bookAppointment: bookAppointmentFn,
        cancelAppointment: cancelAppointmentFn,
        rescheduleAppointment: rescheduleAppointmentFn,
        getSlots: getSlotsFn,
        getFacilityConfig: getFacilityConfigFn,
      },
    });

    // =========================================================
    // 10. CLOUDWATCH ALARMS
    // =========================================================

    // Lambda error rate alarm
    const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'infolinia-lambda-errors',
      alarmDescription: 'Lambda error rate > 5% in 5 minutes',
      metric: new cloudwatch.MathExpression({
        expression: '(errors / invocations) * 100',
        usingMetrics: {
          errors: new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Errors',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          invocations: new cloudwatch.Metric({
            namespace: 'AWS/Lambda',
            metricName: 'Invocations',
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        },
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    lambdaErrorAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

    // Lambda p95 latency alarm
    const latencyAlarm = new cloudwatch.Alarm(this, 'LatencyAlarm', {
      alarmName: 'infolinia-lambda-latency-p95',
      alarmDescription: 'Lambda p95 duration > 2000ms',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Duration',
        statistic: 'p95',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 2000,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    latencyAlarm.addAlarmAction(new cwactions.SnsAction(alertTopic));

    // =========================================================
    // 11. OUTPUTS
    // =========================================================
    new cdk.CfnOutput(this, 'MockHisApiUrl', {
      value: mockHisApi.url,
      description: 'Mock HIS API URL',
      exportName: 'InfoliniaHisApiUrl',
    });

    new cdk.CfnOutput(this, 'SessionsTableName', {
      value: sessionsTable.tableName,
      description: 'DynamoDB Sessions Table',
    });

    new cdk.CfnOutput(this, 'RecordingsBucketName', {
      value: recordingsBucket.bucketName,
      description: 'S3 Recordings Bucket',
    });

    new cdk.CfnOutput(this, 'LexBotId', {
      value: lexBot.botId,
      description: 'Lex V2 Bot ID',
    });
  }
}
