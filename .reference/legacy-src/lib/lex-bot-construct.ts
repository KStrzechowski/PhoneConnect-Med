import * as cdk from 'aws-cdk-lib';
import * as lex from 'aws-cdk-lib/aws-lex';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface LexBotProps {
  botName: string;
  fulfillmentLambdas: {
    verifyPatient: lambda.Function;
    sendOtp: lambda.Function;
    verifyOtp: lambda.Function;
    getPatientData: lambda.Function;
    getAppointments: lambda.Function;
    bookAppointment: lambda.Function;
    cancelAppointment: lambda.Function;
    rescheduleAppointment: lambda.Function;
    getSlots: lambda.Function;
    getFacilityConfig: lambda.Function;
  };
}

export class LexBotConstruct extends Construct {
  public readonly botId: string;
  public readonly botAliasId: string;

  constructor(scope: Construct, id: string, props: LexBotProps) {
    super(scope, id);

    // IAM Role for Lex
    const lexRole = new iam.Role(this, 'LexRole', {
      roleName: 'infolinia-lex-role',
      assumedBy: new iam.ServicePrincipal('lexv2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonLexRunBotsOnly'),
      ],
    });

    // Grant Lex permission to invoke fulfillment lambdas
    const allLambdas = Object.values(props.fulfillmentLambdas);
    allLambdas.forEach(fn => {
      fn.addPermission(`LexInvoke-${fn.functionName}`, {
        principal: new iam.ServicePrincipal('lexv2.amazonaws.com'),
        action: 'lambda:InvokeFunction',
        sourceArn: `arn:aws:lex:eu-central-1:${cdk.Stack.of(this).account}:bot-alias/*`,
      });
    });

    // Helper to build fulfillment code hook
    const fulfillmentHook = (fn: lambda.Function): lex.CfnBot.FulfillmentCodeHookSettingProperty => ({
      enabled: true,
      postFulfillmentStatusSpecification: {
        successResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Operacja zakończona pomyślnie.' } },
          }],
          allowInterrupt: true,
        },
        failureResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Wystąpił błąd. Proszę spróbować ponownie lub poczekać na połączenie z agentem.' } },
          }],
          allowInterrupt: true,
        },
        timeoutResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Przekroczono czas oczekiwania. Łączę z agentem.' } },
          }],
          allowInterrupt: false,
        },
      },
    });

    // Helper: build slot elicitation prompt
    const slotPrompt = (text: string): lex.CfnBot.PromptSpecificationProperty => ({
      maxRetries: 3,
      messageGroupsList: [{ message: { plainTextMessage: { value: text } } }],
      allowInterrupt: true,
    });

    // Helper: build slot type value
    const slotValue = (value: string, synonyms: string[] = []): lex.CfnBot.SlotTypeValueProperty => ({
      sampleValue: { value },
      synonyms: synonyms.map(s => ({ value: s })),
    });

    // =========================================================
    // SLOT TYPES
    // =========================================================
    const slotTypes: lex.CfnBot.SlotTypeProperty[] = [
      {
        name: 'SpecjalizacjaType',
        description: 'Specjalizacje medyczne dostępne w placówce',
        valueSelectionSetting: {
          resolutionStrategy: 'TOP_RESOLUTION',
          advancedRecognitionSetting: { audioRecognitionStrategy: 'UseSlotValuesAsCustomVocabulary' },
        },
        slotTypeValues: [
          slotValue('internista', ['lekarz pierwszego kontaktu', 'ogólny', 'lekarz rodzinny']),
          slotValue('kardiolog', ['kardiologia', 'serce']),
          slotValue('dermatolog', ['dermatologia', 'skóra']),
          slotValue('ortopeda', ['ortopedia', 'kości']),
          slotValue('neurolog', ['neurologia']),
          slotValue('okulista', ['okulistyka', 'wzrok', 'oczy']),
          slotValue('ginekolog', ['ginekologia']),
          slotValue('urolog', ['urologia']),
          slotValue('psychiatra', ['psychiatria', 'psycholog']),
          slotValue('endokrynolog', ['endokrynologia', 'hormony']),
        ],
      },
      {
        name: 'PoraDniaType',
        description: 'Preferowana pora dnia wizyty',
        valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
        slotTypeValues: [
          slotValue('rano', ['poranek', 'z rana', 'przed południem', 'rano coś', 'godziny poranne']),
          slotValue('południe', ['w południe', 'koło południa', 'środek dnia', 'w okolicach południa']),
          slotValue('popołudnie', ['po południu', 'wieczorem', 'po pracy', 'po czternastej', 'późno']),
        ],
      },
      {
        name: 'PotwierdzeniType',
        description: 'Potwierdzenie lub odmowa',
        valueSelectionSetting: { resolutionStrategy: 'TOP_RESOLUTION' },
        slotTypeValues: [
          slotValue('tak', ['potwierdzam', 'zgadza się', 'oczywiście', 'tak jest', 'dobrze', 'ok', 'w porządku']),
          slotValue('nie', ['nie zgadza się', 'błąd', 'anuluj', 'zmień', 'cofnij', 'nie to']),
        ],
      },
    ];

    // =========================================================
    // INTENTS
    // =========================================================

    // --- GLOBAL INTENTS ---

    const mainMenuIntent: lex.CfnBot.IntentProperty = {
      name: 'MainMenuIntent',
      description: 'Powitanie i rozpoznanie głównej intencji pacjenta',
      sampleUtterances: [
        { utterance: 'dzień dobry' },
        { utterance: 'cześć' },
        { utterance: 'hej' },
        { utterance: 'chciałbym skorzystać z infolinii' },
        { utterance: 'menu' },
        { utterance: 'co mogę zrobić' },
        { utterance: 'pomoc' },
        { utterance: 'co oferujecie' },
        { utterance: 'chcę coś załatwić' },
        { utterance: 'wróć do menu' },
        { utterance: 'powrót' },
        { utterance: 'początek' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getFacilityConfig),
      intentClosingSetting: {
        closingResponse: {
          messageGroupsList: [{
            message: {
              plainTextMessage: {
                value: 'Witam w infolinii medycznej. Mogę pomóc w rejestracji wizyt, udostępnieniu informacji o placówce lub danych pacjenta. W czym mogę pomóc?',
              },
            },
          }],
          allowInterrupt: true,
        },
        isActive: true,
      },
    };

    const infoIntent: lex.CfnBot.IntentProperty = {
      name: 'InfoIntent',
      description: 'Informacje ogólne o placówce – godziny, adres, kontakt',
      sampleUtterances: [
        { utterance: 'jakie są godziny otwarcia' },
        { utterance: 'kiedy jesteście czynni' },
        { utterance: 'gdzie się znajdujecie' },
        { utterance: 'jaki jest adres' },
        { utterance: 'podaj adres' },
        { utterance: 'jak do was dojechać' },
        { utterance: 'informacje o przychodni' },
        { utterance: 'godziny pracy' },
        { utterance: 'telefon do rejestracji' },
        { utterance: 'kontakt' },
        { utterance: 'numer telefonu' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getFacilityConfig),
    };

    const repeatIntent: lex.CfnBot.IntentProperty = {
      name: 'RepeatIntent',
      description: 'Powtórzenie ostatniego komunikatu systemu',
      sampleUtterances: [
        { utterance: 'powtórz' },
        { utterance: 'słucham' },
        { utterance: 'nie słyszałem' },
        { utterance: 'nie dosłyszałem' },
        { utterance: 'jeszcze raz' },
        { utterance: 'co powiedziałeś' },
        { utterance: 'nie zrozumiałem' },
        { utterance: 'proszę powtórzyć' },
      ],
      fulfillmentCodeHook: { enabled: false },
      intentClosingSetting: {
        closingResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Powtarzam poprzedni komunikat.' } },
          }],
          allowInterrupt: true,
        },
        isActive: true,
      },
    };

    const agentTransferIntent: lex.CfnBot.IntentProperty = {
      name: 'AgentTransferIntent',
      description: 'Transfer połączenia do agenta',
      sampleUtterances: [
        { utterance: 'połącz z agentem' },
        { utterance: 'chcę rozmawiać z człowiekiem' },
        { utterance: 'poproś o człowieka' },
        { utterance: 'agent' },
        { utterance: 'konsultant' },
        { utterance: 'pracownik' },
        { utterance: 'recepcja' },
        { utterance: 'proszę do kogoś żywego' },
        { utterance: 'chcę z kimś porozmawiać' },
      ],
      fulfillmentCodeHook: { enabled: false },
      intentClosingSetting: {
        closingResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Łączę z agentem. Proszę czekać.' } },
          }],
          allowInterrupt: false,
        },
        isActive: true,
      },
    };

    const fallbackIntent: lex.CfnBot.IntentProperty = {
      name: 'FallbackIntent',
      description: 'Obsługa nierozpoznanych wypowiedzi',
      parentIntentSignature: 'AMAZON.FallbackIntent',
      fulfillmentCodeHook: { enabled: false },
      intentClosingSetting: {
        closingResponse: {
          messageGroupsList: [{
            message: {
              plainTextMessage: {
                value: 'Przepraszam, nie zrozumiałem. Możesz powiedzieć na przykład: rejestracja wizyty, moje dane lub godziny otwarcia.',
              },
            },
          }],
          allowInterrupt: true,
        },
        isActive: true,
      },
    };

    // --- AUTHENTICATION INTENTS ---

    const authIntent: lex.CfnBot.IntentProperty = {
      name: 'AuthIntent',
      description: 'Uwierzytelnianie pacjenta – zbieranie PESEL i numeru telefonu',
      sampleUtterances: [
        { utterance: 'zaloguj mnie' },
        { utterance: 'chcę się zalogować' },
        { utterance: 'weryfikacja' },
        { utterance: 'moje konto' },
        { utterance: 'sprawdź moje dane' },
      ],
      slots: [
        {
          name: 'Pesel',
          slotTypeName: 'AMAZON.Number',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Proszę podać swój numer PESEL.'),
          },
        },
        {
          name: 'Telefon',
          slotTypeName: 'AMAZON.PhoneNumber',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Proszę podać numer telefonu zarejestrowany w systemie.'),
          },
        },
      ],
      slotPriorities: [
        { priority: 1, slotName: 'Pesel' },
        { priority: 2, slotName: 'Telefon' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.verifyPatient),
    };

    const otpIntent: lex.CfnBot.IntentProperty = {
      name: 'OtpIntent',
      description: 'Weryfikacja kodu OTP otrzymanego przez SMS',
      sampleUtterances: [
        { utterance: 'mój kod to {KodOtp}' },
        { utterance: 'kod {KodOtp}' },
        { utterance: '{KodOtp}' },
        { utterance: 'podaję kod' },
      ],
      slots: [
        {
          name: 'KodOtp',
          slotTypeName: 'AMAZON.Number',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Proszę podać sześciocyfrowy kod, który właśnie wysłaliśmy SMS-em na Twój numer telefonu.'),
          },
        },
      ],
      slotPriorities: [{ priority: 1, slotName: 'KodOtp' }],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.verifyOtp),
    };

    const resendOtpIntent: lex.CfnBot.IntentProperty = {
      name: 'ResendOtpIntent',
      description: 'Ponowne wysłanie kodu OTP na numer pacjenta',
      sampleUtterances: [
        { utterance: 'wyślij ponownie' },
        { utterance: 'nie dostałem kodu' },
        { utterance: 'wyślij kod jeszcze raz' },
        { utterance: 'prześlij kod ponownie' },
        { utterance: 'SMS nie dotarł' },
        { utterance: 'nie przyszedł SMS' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.sendOtp),
    };

    // --- AUTHENTICATED INTENTS ---

    const patientDataIntent: lex.CfnBot.IntentProperty = {
      name: 'PatientDataIntent',
      description: 'Pobranie i odtworzenie danych pacjenta',
      sampleUtterances: [
        { utterance: 'moje dane' },
        { utterance: 'pokaż moje dane' },
        { utterance: 'jakie macie moje dane' },
        { utterance: 'dane pacjenta' },
        { utterance: 'mój profil' },
        { utterance: 'dane osobowe' },
        { utterance: 'sprawdź moje dane' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getPatientData),
    };

    const appointmentsIntent: lex.CfnBot.IntentProperty = {
      name: 'AppointmentsIntent',
      description: 'Pobranie listy zarezerwowanych wizyt pacjenta',
      sampleUtterances: [
        { utterance: 'moje wizyty' },
        { utterance: 'jakie mam wizyty' },
        { utterance: 'pokaż moje terminy' },
        { utterance: 'lista wizyt' },
        { utterance: 'kiedy mam wizytę' },
        { utterance: 'zaplanowane wizyty' },
        { utterance: 'moje rezerwacje' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getAppointments),
    };

    const bookingIntent: lex.CfnBot.IntentProperty = {
      name: 'BookingIntent',
      description: 'Rejestracja nowej wizyty – zbieranie specjalizacji i pory dnia',
      sampleUtterances: [
        { utterance: 'chcę umówić wizytę' },
        { utterance: 'zarejestruj mnie' },
        { utterance: 'umów mnie na wizytę' },
        { utterance: 'chcę się zarejestrować' },
        { utterance: 'rejestracja wizyty' },
        { utterance: 'potrzebuję wizyty' },
        { utterance: 'umówić się do lekarza' },
        { utterance: 'chcę umówić się do {Specjalizacja}' },
        { utterance: 'umów mnie do {Specjalizacja} {PoraDnia}' },
        { utterance: 'chcę do {Specjalizacja} {PoraDnia}' },
        { utterance: 'zarejestruj mnie do {Specjalizacja}' },
        { utterance: 'wizyta u {Specjalizacja}' },
        { utterance: 'potrzebuję wizyty u {Specjalizacja} {PoraDnia}' },
      ],
      slots: [
        {
          name: 'Specjalizacja',
          slotTypeName: 'SpecjalizacjaType',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Do jakiego specjalisty chciałbyś się zarejestrować? Na przykład: internista, kardiolog, dermatolog.'),
            sampleUtterances: [
              { utterance: 'do {Specjalizacja}' },
              { utterance: '{Specjalizacja}' },
            ],
          },
        },
        {
          name: 'PoraDnia',
          slotTypeName: 'PoraDniaType',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Jaką porę dnia preferujesz? Rano, południe, czy popołudnie?'),
            sampleUtterances: [
              { utterance: '{PoraDnia}' },
              { utterance: 'wolę {PoraDnia}' },
            ],
          },
        },
      ],
      slotPriorities: [
        { priority: 1, slotName: 'Specjalizacja' },
        { priority: 2, slotName: 'PoraDnia' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getSlots),
    };

    const nextSlotsIntent: lex.CfnBot.IntentProperty = {
      name: 'NextSlotsIntent',
      description: 'Pobranie kolejnej puli dostępnych terminów',
      sampleUtterances: [
        { utterance: 'następne' },
        { utterance: 'pokaż więcej' },
        { utterance: 'inne terminy' },
        { utterance: 'inne opcje' },
        { utterance: 'więcej terminów' },
        { utterance: 'kolejne' },
        { utterance: 'żaden nie pasuje' },
        { utterance: 'nie ten' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.getSlots),
    };

    const confirmBookingIntent: lex.CfnBot.IntentProperty = {
      name: 'ConfirmBookingIntent',
      description: 'Potwierdzenie rezerwacji wybranego terminu',
      sampleUtterances: [
        { utterance: 'tak' },
        { utterance: 'potwierdzam' },
        { utterance: 'zgadza się' },
        { utterance: 'dobra' },
        { utterance: 'ok' },
        { utterance: 'ten termin' },
        { utterance: 'wybierz ten' },
        { utterance: 'rezerwuj' },
        { utterance: 'zapisz mnie' },
      ],
      slots: [
        {
          name: 'WybranyTermin',
          slotTypeName: 'AMAZON.Date',
          valueElicitationSetting: {
            slotConstraint: 'Optional',
            promptSpecification: slotPrompt('Który termin wybierasz?'),
          },
        },
      ],
      slotPriorities: [{ priority: 1, slotName: 'WybranyTermin' }],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.bookAppointment),
    };

    const cancelAppointmentIntent: lex.CfnBot.IntentProperty = {
      name: 'CancelAppointmentIntent',
      description: 'Odwołanie istniejącej wizyty',
      sampleUtterances: [
        { utterance: 'odwołaj wizytę' },
        { utterance: 'anuluj wizytę' },
        { utterance: 'chcę odwołać wizytę' },
        { utterance: 'nie przyjdę na wizytę' },
        { utterance: 'zrezygnuję z wizyty' },
        { utterance: 'usuń moją wizytę' },
      ],
      slots: [
        {
          name: 'WizytaId',
          slotTypeName: 'AMAZON.AlphaNumeric',
          valueElicitationSetting: {
            slotConstraint: 'Optional',
            promptSpecification: slotPrompt('Odczytuję Twoje wizyty. Która ma zostać odwołana?'),
          },
        },
      ],
      slotPriorities: [{ priority: 1, slotName: 'WizytaId' }],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.cancelAppointment),
    };

    const rescheduleIntent: lex.CfnBot.IntentProperty = {
      name: 'RescheduleIntent',
      description: 'Przełożenie wizyty na inny termin',
      sampleUtterances: [
        { utterance: 'chcę przełożyć wizytę' },
        { utterance: 'zmień termin wizyty' },
        { utterance: 'przesuń wizytę' },
        { utterance: 'inny termin' },
        { utterance: 'zmień moją wizytę' },
        { utterance: 'przełóż wizytę' },
      ],
      slots: [
        {
          name: 'WizytaId',
          slotTypeName: 'AMAZON.AlphaNumeric',
          valueElicitationSetting: {
            slotConstraint: 'Optional',
            promptSpecification: slotPrompt('Którą wizytę chcesz przełożyć?'),
          },
        },
        {
          name: 'NowaPoraDnia',
          slotTypeName: 'PoraDniaType',
          valueElicitationSetting: {
            slotConstraint: 'Required',
            promptSpecification: slotPrompt('Jaką porę dnia preferujesz dla nowego terminu? Rano, południe czy popołudnie?'),
          },
        },
      ],
      slotPriorities: [
        { priority: 1, slotName: 'WizytaId' },
        { priority: 2, slotName: 'NowaPoraDnia' },
      ],
      fulfillmentCodeHook: fulfillmentHook(props.fulfillmentLambdas.rescheduleAppointment),
    };

    const confirmActionIntent: lex.CfnBot.IntentProperty = {
      name: 'ConfirmActionIntent',
      description: 'Zatwierdzenie bieżącej akcji',
      sampleUtterances: [
        { utterance: 'tak potwierdzam' },
        { utterance: 'tak jest' },
        { utterance: 'dokładnie' },
        { utterance: 'właśnie to' },
        { utterance: 'właśnie tak' },
      ],
      fulfillmentCodeHook: { enabled: false },
    };

    const denyActionIntent: lex.CfnBot.IntentProperty = {
      name: 'DenyIntent',
      description: 'Anulowanie bieżącej akcji i powrót do poprzedniego kroku',
      sampleUtterances: [
        { utterance: 'nie' },
        { utterance: 'wróć' },
        { utterance: 'zmień' },
        { utterance: 'anuluj' },
        { utterance: 'cofnij' },
        { utterance: 'nie to' },
        { utterance: 'nie zgadza się' },
        { utterance: 'inaczej' },
      ],
      fulfillmentCodeHook: { enabled: false },
      intentClosingSetting: {
        closingResponse: {
          messageGroupsList: [{
            message: { plainTextMessage: { value: 'Dobrze, wracamy do poprzedniego kroku. W czym mogę pomóc?' } },
          }],
          allowInterrupt: true,
        },
        isActive: true,
      },
    };

    // =========================================================
    // BOT DEFINITION
    // =========================================================
    const bot = new lex.CfnBot(this, 'InfoliniaBot', {
      name: props.botName,
      description: 'Bot konwersacyjny infolinii medycznej – Amazon Lex V2',
      roleArn: lexRole.roleArn,
      dataPrivacy: { childDirected: false },
      idleSessionTtlInSeconds: 300,
      autoBuildBotLocales: true,
      botLocales: [
        {
          localeId: 'pl_PL',
          description: 'Język polski',
          nluConfidenceThreshold: 0.75,
          voiceSettings: {
            voiceId: 'Ewa',
            engine: 'neural',
          },
          slotTypes: slotTypes,
          intents: [
            // Global
            mainMenuIntent,
            infoIntent,
            repeatIntent,
            agentTransferIntent,
            fallbackIntent,
            // Auth
            authIntent,
            otpIntent,
            resendOtpIntent,
            // Authenticated
            patientDataIntent,
            appointmentsIntent,
            bookingIntent,
            nextSlotsIntent,
            confirmBookingIntent,
            cancelAppointmentIntent,
            rescheduleIntent,
            confirmActionIntent,
            denyActionIntent,
          ],
        },
      ],
    });

    // Bot version
    const botVersion = new lex.CfnBotVersion(this, 'InfoliniaBotVersion', {
      botId: bot.ref,
      botVersionLocaleSpecification: [
        {
          localeId: 'pl_PL',
          botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' },
        },
      ],
      description: 'v1 – initial release',
    });

    // Bot alias (for Connect integration)
    const botAlias = new lex.CfnBotAlias(this, 'InfoliniaBotAlias', {
      botId: bot.ref,
      botAliasName: 'production',
      botVersion: botVersion.attrBotVersion,
      description: 'Production alias – używany przez Amazon Connect',
      botAliasLocaleSettings: [
        {
          localeId: 'pl_PL',
          botAliasLocaleSetting: {
            enabled: true,
          },
        },
      ],
      sentimentAnalysisSettings: { detectSentiment: false },
    });

    this.botId = bot.ref;
    this.botAliasId = botAlias.ref;

    // Outputs
    new cdk.CfnOutput(cdk.Stack.of(this), 'LexBotAliasId', {
      value: botAlias.ref,
      description: 'Lex Bot Alias ID – użyj tego w konfiguracji Amazon Connect',
    });
  }
}
