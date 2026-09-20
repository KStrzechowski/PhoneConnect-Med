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
    allowInterrupt: true,
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
    allowInterrupt: true,
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
  'jakie macie tu opcje',
  'z czym mogę się do was zgłosić',
  'zacznijmy tę rozmowę od nowa',
  'wróćmy na sam początek',
  'co mogę u was zrobić przez telefon',
  'jakie usługi oferujecie przez telefon',
  'w czym możesz mi pomóc',
  'jakie sprawy mogę załatwić',
  'wymień co potrafisz',
  'nie wiem co tu jest do zrobienia',
  'od czego mam zacząć',
  'wróć do początku rozmowy',
  'pokaż mi dostępne opcje',
  'dobry wieczór co tu można załatwić',
  'a co ty właściwie potrafisz',
  'nie wiem jak to działa co mam powiedzieć',
  'czy mam coś powiedzieć czy nacisnąć',
  'pomyliłem się przy wyborze wróćmy na początek',
  'jak korzystać z tego systemu',
  'co tu w ogóle można zrobić',
  'powiedz mi co potrafisz zrobić',
  'co mogę zrobić przez telefon',
  'z czym mogę do was zadzwonić',
  'wymień dostępne opcje',
  'zacznij jeszcze raz od początku',
  'nie wiem czym mogę się tu zająć',
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
  'w jakich godzinach można się do was zgłosić',
  'do której macie dziś otwarte',
  'czy w sobotę przyjmujecie pacjentów',
  'jak długo jesteście dziś czynni',
  'od której do której pracuje przychodnia',
  'kiedy najpóźniej mogę przyjść',
  'czy jesteście czynni w weekend',
  'pod jakim adresem mieści się przychodnia',
  'w jakiej okolicy jesteście',
  'jak trafić do przychodni',
  'przy jakiej ulicy znajduje się placówka',
  'w jakiej miejscowości działa placówka',
  'czy przy przychodni można zostawić samochód',
  'czy jest tu dostęp dla osób na wózkach',
  'jak dojechać do was autobusem',
  'czy w budynku jest winda albo podjazd',
  'na jaki numer mogę do was zadzwonić',
  'podaj numer kontaktowy przychodni',
  'czy macie adres e-mail',
  'jak się z wami skontaktować',
  'gdzie mogę zaparkować samochód',
  'czy przy przychodni jest parking dla pacjentów',
  'jak dojechać do przychodni autobusem',
  'który autobus jedzie pod przychodnię',
  'jak dojść do was z dworca',
  'czy blisko was jest przystanek',
  'podajcie numer telefonu do przychodni',
  'jaki jest numer do recepcji',
  'czy jest u was apteka',
  'czy w budynku jest punkt pobrań krwi',
  'czy jest winda albo podjazd dla wózków',
  'do której czynne jest w piątek',
  'o której kończycie pracę',
  'kiedy zamykacie przychodnię',
  'czy pracujecie w weekendy',
  'czy jesteście otwarci w święta',
  'czy w niedzielę można się do was zgłosić',
  'jakie są godziny pracy rejestracji',
  'w jakim budynku się mieścicie',
  'na którym piętrze jest przychodnia',
  'jak was znaleźć',
  'czy mogę zostawić samochód pod budynkiem czy trzeba szukać parkingu',
  'jakim tramwajem dojadę do waszej przychodni',
  'czy w dni świąteczne przyjmujecie pacjentów',
  'czy w piątki jesteście otwarci dłużej niż w inne dni',
  'czy macie inny numer kontaktowy bo ten jest ciągle zajęty',
  'gdzie dokładnie jest wasza klinika',
  'podajcie adres przychodni',
  'czy jest gdzie zaparkować przy przychodni',
  'jak najszybciej do was dotrzeć z dworca',
  'gdzie jest wejście do przychodni',
  'czy pracujecie też w niedziele',
  'do której godziny przyjmujecie pacjentów',
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
  'słabo cię słyszę, powtórz proszę',
  'nie złapałam tego, co powiedziałeś',
  'zgubiłem się, powtórz to',
  'nie dosłyszałem ostatniej części, powtórz',
  'możesz powiedzieć to jeszcze raz',
  'jeszcze raz poproszę',
  'nie zrozumiałam, proszę powtórzyć',
  'ech, nie dosłyszałam',
  'powtórz ostatnie zdanie',
  'nie usłyszałem bo był hałas w tle powtórz ostatnią wiadomość',
  'dziecko krzyczało i nie usłyszałem możesz powtórzyć',
  'co to było',
  'jak jak co powiedziałeś',
  'przepraszam co mówiłeś',
  'przerwało mi i nie usłyszałem',
  'powiedz jeszcze raz bo nie słyszałem',
  'nie zrozumiałem mów wolniej',
  'nie dosłyszałem co powiedziałeś',
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
  'muszę potwierdzić kim jestem',
  'chcę się przedstawić systemowi',
  'podam dane żeby mnie rozpoznać',
  'jak mogę się uwierzytelnić',
  'mogę podać swoje dane osobowe',
  'chcę zostać zidentyfikowany jako pacjent',
  'zidentyfikuj mnie proszę',
  'chcę się zalogować jako pacjent',
  'chcę przejść weryfikację',
  'przeprowadźcie weryfikację mojej tożsamości',
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

  // symptoms, no specialty named
  'dokucza mi brzuch od kilku dni',
  'mam ostry ból w boku',
  'boli mnie w krzyżu',
  'coś mi dolega i chcę się zbadać',
  'nie czuję się dobrze i chciałbym do lekarza',
  'mam niepokojące objawy i potrzebuję lekarza',
  'od kilku dni kręci mi się w głowie',
  'mam nawracające bóle głowy',
  'męczy mnie ból kolana',
  'piecze mnie skóra i mam czerwone plamy',
  'mam podrażnione oko od wczoraj',
  'boli mnie ucho i mam gorączkę',
  'mam ciągłe zmęczenie i osłabienie',
  'nie mogę spać po nocach i chcę porozmawiać ze specjalistą',
  'zauważyłem niepokojącą zmianę na ciele',
  'mam duszności przy wysiłku',
  'łapią mnie skurcze w nodze',
  'mam nudności od rana i wymioty',
  'moje dziecko od wczoraj gorączkuje',
  'córka ma ból ucha i musi być zbadana',
  'męża od tygodnia boli kręgosłup, chcemy go umówić',
  'chcę sprawdzić co mi jest',
  'proszę o pomoc lekarza, bo źle się czuję',
  'potrzebuję jakiegoś lekarza',
  'chciałbym jak najszybciej do lekarza',
  'kaszlę od dwóch tygodni i muszę do lekarza',
  'mam gorączkę chcę się zapisać',
  'muszę pilnie zobaczyć lekarza',
  'chciałabym zobaczyć się z lekarzem w tym tygodniu',
  'zapisz mnie do lekarza rodzinnego',
  'chcę do lekarza bo mnie łupie w krzyżu',
  'potrzebuję wizyty u laryngologa',
  'poproszę termin do dermatologa',

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
  'czy jest coś wolnego {preferredDate}',
  'czy macie coś wolnego na {preferredDate}',

  // date only (starting from / after)
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

  // time of day (rano / przed południem / po południu / wieczorem)
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
  'powiedz mi o moich umówionych wizytach',
  'jakie terminy mam u was zarezerwowane',
  'na kiedy mam zarezerwowane wizyty',
  'przeczytaj mi moje wizyty',
  'czy mam gdzieś rezerwację',
  'ile mam umówionych wizyt',
  'w jakie dni mam wizyty',
  'z kim i kiedy mam wizytę',
  'sprawdź czy mam zarezerwowany termin',
  'chcę wiedzieć o swoich rezerwacjach',
  'przypomnij mi kiedy mam być u lekarza',
  'do jakiego lekarza jestem zapisany',
  'czy widnieję w grafiku',
  'wymień moje rezerwacje',
  'kiedy jest mój najbliższy termin',
  'czy jest coś na mnie zarezerwowane',
  'kiedy mam wizytę u internisty',
  'czy mam zapisaną wizytę u ginekologa',
  'czy mam coś umówione na przyszły tydzień',
  'czy w tym tygodniu mam jakąś wizytę',
  'jaką mam wizytę na jutro',
  'na który dzień jestem zapisany',
  'czy jestem już gdzieś zapisana',
  'czy mam zarezerwowaną wizytę u neurologa',
  'sprawdź czy jestem umówiony na jakiś termin',
  'jakie mam nadchodzące terminy',
  'przypomnij mi na kiedy jestem zapisany',
  'co mam w kalendarzu wizyt',
  'pokaż mi listę moich rezerwacji',
  'o której godzinie mam wizytę',
  'na którą godzinę jestem zapisany',
  'do którego lekarza jestem umówiona',
  'u kogo mam wizytę w tym tygodniu',
  'kiedy przychodzę do kardiologa',
  'czy mam wizytę u ortopedy',
  'czy moja córka ma umówioną wizytę',
  'sprawdź czy syn ma wyznaczony termin',
  'czy termin w piątek jest nadal aktualny',
  'chcę potwierdzić termin mojej wizyty',
  'jaki dzień mam wizytę',
  'czy wizyta na jutro jest zarezerwowana',
  'zapomniałem kiedy mam przyjść',
  'przypomnijcie mi godzinę mojej wizyty',
  'czy jestem wpisany na jakąś wizytę',
  'jaki mam termin u lekarza',
  'kiedy i do kogo mam wizytę',
  'mam coś umówione na ten miesiąc',
  'sprawdźcie moje zapisy',
  'na kiedy wyznaczono mi wizytę',
  'powiedz mi termin mojej wizyty',
  'chcę usłyszeć kiedy mam być w przychodni',
  'nie pamiętam kiedy mam wizytę czy mogę to sprawdzić',
  'zapomniałam na którą godzinę mam się stawić',
  'chciałbym się upewnić kiedy mam umówioną wizytę',
  'czy możecie sprawdzić na kiedy jestem zapisany do lekarza',
  'umawiałem się jakiś czas temu ale nie pamiętam terminu',
  'nie wiem czy dobrze zapisałam datę wizyty co u was widnieje',
  'chcę potwierdzić na którą godzinę mam wizytę u specjalisty',
  'kiedy syn ma wizytę u lekarza',
  'sprawdź termin wizyty mojej córki',
  'w którym dniu mam być u lekarza',
  'ile mam jeszcze umówionych wizyt',
  'jakie wizyty mam u waszych specjalistów',
  'zapisałem się tydzień temu i nie pamiętam do kogo',
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
  'proszę wykreślić mnie z tej wizyty',
  'chcę zgłosić rezygnację z wizyty',
  'skreślcie moją wizytę z grafiku',
  'nie będę mogła skorzystać z umówionej wizyty',
  'niestety muszę zrezygnować z terminu',
  'proszę o odwołanie wizyty',
  'chcę skreślić moją wizytę',
  'wykreślcie mnie z umówionego terminu',
  'nie stawię się na wizytę',
  'nie mogę przyjść na umówioną wizytę',
  'proszę odwołać moją rezerwację',
  'odwołaj wizytę u kardiologa',
  'chcę odwołać wizytę do dermatologa',
  'rezygnuję z wizyty u okulisty',
  'nie będę mógł przyjść do ortopedy',
  'zachorowałem i nie przyjdę na wizytę',
  'jestem chora więc nie będę na wizycie',
  'wypadł mi urlop i nie mogę być na terminie',
  'mam awarię w domu i nie dotrę na wizytę',
  'dziecko jest chore więc rezygnujemy z terminu',
  'nie zdążę na umówioną wizytę odwołajcie ją',
  'kolidują mi plany z wizytą proszę ją odwołać',
  'zmieniły mi się plany i wizyta jest już zbędna',
  'wyjechałem i nie będzie mnie na wizycie',
  'znalazłam inną przychodnię więc rezygnuję z terminu',
  'odwołaj mi wizytę zaplanowaną na wtorek',
  'proszę anulować termin z czwartku',
  'chcę odwołać jutrzejszy termin',
  'anuluj wizytę z przyszłego tygodnia',
  'skasuj mi rezerwację na piątek rano',
  'rezygnuję z wizyty w sobotę',
  'chcę wycofać się z umówionej wizyty',
  'zwolnię ten termin odwołajcie go',
  'zdejmijcie mnie z grafiku',
  'skasujcie tę rezerwację',
  'proszę o skasowanie wizyty',
  'usuńcie moją rezerwację wizyty',
  'anulujcie mój termin',
  'odwołajcie mój termin do lekarza',
  'anuluj wizytę u internisty',
  'odwołajcie wizytę u neurologa',
  'zrezygnuję z terminu u ginekologa',
  'nie zdążę dzisiaj na wizytę',
  'nie dotrę dziś na umówioną wizytę',
  'zachorowałem i nie przyjdę do lekarza',
  'moje dziecko jest chore odwołuję wizytę',
  'muszę odwołać wizytę mojego syna',
  'muszę odwołać wizytę mojej mamy',
  'skasujcie wizytę',
  'proszę skasować moją rezerwację',
  'chcę wykasować termin',
  'anulowanie wizyty',
  'odwołanie terminu',
  'nie będę mógł się dziś stawić do lekarza',
  'rezygnacja z wizyty',
  'usuńcie mnie z grafiku na jutro',
];

const rescheduleUtterances = [
  // no slots yet
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
  'chcę ustalić inny termin wizyty',
  'proszę o zmianę terminu mojej wizyty',
  'da się zmienić godzinę mojej wizyty',
  'chciałbym umówić się na inny dzień niż wcześniej ustalony',
  'wolałabym mieć tę wizytę w innym terminie',
  'przełóżcie mi wizytę',
  'przeniesienie wizyty',
  'muszę przesunąć umówioną wizytę',
  'czy dałoby się to przesunąć',
  'zmieńcie mi datę wizyty',
  'potrzebuję innej daty na moją wizytę',
  'ten termin mi nie odpowiada',
  'chcę przełożyć wizytę do kardiologa',
  'przenieś wizytę do ortopedy',
  'chcę zmienić termin wizyty u laryngologa',
  'wolałbym późniejszy termin wizyty',
  'wolałabym wcześniejszy termin wizyty',
  'ten dzień mi nie pasuje, może być inny',
  'w tym terminie mam inne zobowiązania',
  'potrzebuję przenieść tę wizytę na inny termin',
  'mam kolizję w kalendarzu, zmieńmy termin',
  'czy termin można jeszcze zmienić',
  'wolałbym być umówiony w innym dniu',
  'ta pora jest dla mnie niewygodna, może później',
  'przełóż moją wizytę ze środy na piątek',
  'przenieście wizytę z poniedziałku na wtorek',
  'wizytę z jutra chcę przesunąć na pojutrze',
  'przesuńcie mój termin',
  'przeniesiemy tę wizytę na inny dzień',
  'zmieńmy datę mojej wizyty',
  'chcę inny dzień na wizytę',
  'nowy termin dla mojej wizyty poproszę',
  'chcę przełożyć wizytę u internisty',
  'przesuńcie wizytę do ginekologa',
  'przełóż wizytę na później',
  'przesuńcie mnie na wcześniejszą godzinę',
  'ta wizyta jest za wcześnie, chcę później',

  // date only (exact day) — bare "na/w/do {preferredDate}" lives only in bookingUtterances:
  // Lex requires sample utterances to be unique across all intents in a locale, so the two
  // intents can't both declare the same bare template.
  'chcę przełożyć wizytę na {preferredDate}',
  'chciałbym przełożyć wizytę na {preferredDate}',
  'chciałabym przełożyć wizytę na {preferredDate}',
  'chcę przełożyć wizytę po {preferredDateAfter}',
  'chcę przełożyć wizytę {preferredTimeOfDay}',
  'chciałbym przełożyć wizytę {preferredTimeOfDay}',
  'chciałabym przełożyć wizytę {preferredTimeOfDay}',
  'chcę przełożyć wizytę na {preferredDate} na {preferredTime}',
  'chcę przełożyć wizytę na {preferredDate} {preferredTimeOfDay}',
  'chcę zmienić datę mojej wizyty na inną',
  'czy mogę przyjść w innym dniu niż mam umówione',
  'zamieńcie mi termin na inny',
  'przenieście mnie na następny tydzień',
  'przełożenie wizyty',
  'chcę zmienić termin mojej wizyty u kardiologa',
  'proszę o inny termin zamiast obecnego',
  'nie zdążę na ten termin czy mogę przyjść w innym',
  'nie mogę w tym dniu ale mogę w inny',
  'wolałbym wcześniejszy termin niż mam',
  'zamieńcie mi wizytę na inny dzień',
  'moja mama nie będzie w tym terminie proszę o zmianę na późniejszy',
  'nie chcę rezygnować tylko przełożyć wizytę',
  'mam wizytę ale mi się coś pomyliło i chcę ją zamienić',
  'chcę przesunąć wizytę na wcześniej',
  'proszę o zmianę terminu na następny tydzień',
  'czy da się przenieść wizytę na inny dzień w tym samym tygodniu',
  'wizytę mam we wtorek ale wolałbym w środę',
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
  'połączcie mnie z prawdziwą osobą',
  'przełączcie mnie na kogoś z personelu',
  'chcę mówić z żywym pracownikiem',
  'dajcie mi kogoś z obsługi pacjenta',
  'to nie działa, proszę o rozmowę z osobą',
  'czy jest ktoś żywy na linii',
  'proszę przekierować mnie do pracownika',
  'wolę rozmawiać z człowiekiem niż z systemem',
  'połącz mnie z żywym człowiekiem',
  'chcę żywego człowieka',
  'przełącz mnie na pracownika przychodni',
  'proszę o połączenie z rejestratorką',
  'daj mnie do rejestracji',
  'poproszę recepcję',
  'chcę z kimś normalnym porozmawiać',
  'nie rozumiem tego systemu połącz mnie z człowiekiem',
  'czy jest tam jakiś człowiek',
  'potrzebuję konsultanta',
  'proszę o połączenie z konsultantem',
  'przełączcie mnie do kogoś z obsługi',
  'połączcie mnie z osobą która mi pomoże',
  'daj mi kogoś kto mnie zrozumie',
  'poproszę kogoś z obsługi',
  'dawajcie mi człowieka',
  'nie rozumiesz mnie chcę żywą osobę',
  'daj mi kogoś kto pracuje w przychodni',
  'proszę o rozmowę z pracownikiem',
  'połącz mnie z rejestracją proszę',
  'chcę rozmawiać z prawdziwym człowiekiem',
  'przełącz mnie na konsultanta',
  'czy jest tam ktoś żywy',
  'wolę porozmawiać z kimś z rejestracji',
];

const outOfScopeUtterances = [
  'jaki jest cennik usług',
  'ile płacę za konsultację',
  'czy wizyta jest płatna',
  'ile kosztuje badanie',
  'czy mogę zapłacić kartą',
  'chcę przedłużyć receptę',
  'potrzebuję recepty',
  'czy lekarz wypisze mi receptę',
  'skończyły mi się leki i potrzebuję nowych',
  'mam zażalenie na obsługę',
  'chcę zgłosić reklamację',
  'jestem niezadowolony z leczenia',
  'chcę wystawić L4',
  'potrzebuję zwolnienia lekarskiego',
  'czy są już moje wyniki',
  'chcę dowiedzieć się o wyniki badań',
  'gdzie mogę odebrać wyniki',
  'potrzebuję skierowania na badania',
  'chcę odebrać dokumentację medyczną',
  'potrzebuję kopii historii choroby',
  'wystawcie mi rachunek',
  'potrzebuję zaświadczenia lekarskiego',
  'czy mogę brać te dwa leki razem',
  'jakie są skutki uboczne tego leku',
  'co oznacza ten wynik badania',
  'czy to jest groźne',
  'czy mogę pić alkohol przy antybiotyku',
  'mam pytanie do lekarza',
  'szukam apteki',
  'jak dostać się do szpitala',
  'dzwonię z ubezpieczalni',
  'dzwonię w sprawie ubezpieczenia',
  'chcę porozmawiać z kadrami',
  'macie wolne miejsca pracy',
  'pomyliłem numer',
  'to nie ta przychodnia',
  'dodzwoniłem się w złe miejsce',
  'opowiedz mi dowcip',
  'czy będzie dziś padać',
  'kto wygrał mecz',
  'zamów mi taksówkę',
  'poleć mi dobrą restaurację',
  'jak się nazywasz',
  'co słychać',
  'raz dwa trzy test',
  'nic nie chcę',
  'nie wiem po co dzwonię',
  'ile trzeba dopłacić do wizyty',
  'czy lekarz przyjmuje bezpłatnie',
  'jakie są opłaty za wizyty',
  'czy wizyta jest refundowana',
  'ile wynosi opłata za wizytę domową',
  'chcę wystawić fakturę na firmę',
  'potrzebuję zaświadczenia o stanie zdrowia',
  'poproszę o wydanie dokumentacji z wizyty',
  'kiedy mogę odebrać wyniki po wizycie',
  'czy wynik badania jest już dostępny',
  'jak wyglądają moje wyniki krwi',
  'gdzie zrobić badanie moczu',
  'jak przygotować się do badania USG',
  'czy muszę być na czczo',
  'czy lekarz wystawi mi skierowanie do specjalisty',
  'potrzebuję skierowania na rehabilitację',
  'jak dostać skierowanie na operację',
  'chcę zgłosić uwagi do pracy lekarza',
  'mam zażalenie na czas oczekiwania w poczekalni',
  'jak długo czeka się na zabieg operacyjny',
  'gdzie mogę zrobić rentgen',
  'lekarz zapisał mi lek a nie mogę go kupić',
  'czy lekarz może zmienić mi dawkę leku',
  'chcę zapytać o interakcje leków',
  'dzwonię z innej przychodni',
  'jestem z laboratorium',
  'ile kosztuje wizyta u kardiologa prywatnie',
  'czy przyjmujecie w ramach NFZ czy prywatnie',
  'jaka jest cena wizyty',
  'ile kosztują badania',
  'czy wizyta na NFZ jest bezpłatna',
  'czy mogę zapłacić za wizytę przelewem',
  'czy przyjmujecie karty medyczne',
  'chcę zamówić receptę na leki stałe',
  'czy mogę dostać receptę bez wizyty',
  'proszę o receptę online',
  'lekarz ma mi wystawić receptę na tabletki',
  'chcę odebrać zaświadczenie',
  'gdzie mogę odebrać orzeczenie',
  'potrzebuję zwolnienia z pracy dla dziecka',
  'proszę o fakturę VAT na firmę',
  'kiedy dostanę dokumentację medyczną',
  'czy wyniki moich badań są gotowe',
  'chcę sprawdzić wynik morfologii',
  'kiedy będą wyniki z laboratorium',
  'potrzebuję skierowania do szpitala',
  'kto może wystawić skierowanie na tomografię',
  'chcę złożyć skargę na pracownika rejestracji',
  'jestem niezadowolony z obsługi w przychodni',
  'czy mogę dostać poradę lekarską przez telefon',
  'czy dodzwoniłem się do pizzerii',
  'jaka jest dziś pogoda',
  'to nie ten numer',
  'dzwonię do banku',
  'opowiedz coś ciekawego',
  'zaśpiewaj mi piosenkę',
  'faktura za usługę',
  'rachunek za wizytę',
  'proszę o duplikat faktury',
  'zaświadczenie o zdolności do pracy',
  'zaświadczenie że jestem zdrowy',
  'skarga na lekarza',
  'zażalenie na personel',
  'czy można brać ibuprofen razem z innymi lekami',
  'jakie leki na przeziębienie',
  'co wziąć na gorączkę',
  'jakie są objawy grypy',
  'numer do apteki',
  'numer do szpitala',
  'numer do urzędu',
  'skierowanie na rezonans',
  'skierowanie na badania bez wizyty',
  'wyniki po wizycie jeszcze nie przyszły',
  'eee yyy hmm',
  'mhm no tak',
  'aaa halo halo ktoś tu jest',
  'słychać mnie halo',
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
  'what can I take care of over the phone',
  'which things can I arrange here',
  'what services do you offer by phone',
  'what can you do for me',
  'tell me what you can do',
  'what options are there',
  'I am not sure where to begin',
  'where do I start',
  'take me back to the beginning',
  'start again please',
  'show me what is available',
  'good evening what can I do here',
  'what are the options',
  'what services can I use here',
  'how does this work',
  'tell me what I can do',
  'go back to the beginning',
  'help me choose',
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
  'what is the phone number of the clinic',
  'how can I contact the clinic',
  'do you have an email address',
  'what number can I call you on',
  'is there a car park at the clinic',
  'where can I leave my car',
  'which bus goes to the clinic',
  'how can I reach you by public transport',
  'is the clinic accessible for wheelchairs',
  'do you have a lift in the building',
  'what days are you open',
  'until what time are you open today',
  'are you open on Sundays',
  'what are the working hours of the clinic',
  'in which part of town are you',
  'which city are you in',
  'tell me where the clinic is',
  'what is the location of the clinic',
  'where can I park my car',
  'how can I get there by bus',
  'how far are you from the train station',
  'is there a pharmacy in the building',
  'until what time are you open on friday',
  'what time do you close',
  'are you open at the weekend',
  'do you work on public holidays',
  'which floor is the clinic on',
  'how do I find you',
  'what are the reception hours',
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
  'pardon me',
  'sorry I missed that',
  'could you say that once more',
  'say it one more time',
  'I could not hear that, please repeat',
  'repeat the last sentence',
  'come again',
  'what was that',
  'one more time please',
  'what did you just say',
  'I could not hear you',
  'say the last thing again',
  'please repeat the last sentence',
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
  'I need to verify who I am',
  'I would like to verify my identity',
  'let me give you my PESEL',
  'I want to identify myself as a patient',
  'identify me please',
  'I can provide my personal details',
  'how do I verify myself',
  'I would like to sign in',
  'let me log in',
  'how can I give my ID number',
  'I need to identify myself',
  'how do I authenticate',
  'user login',
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

  // symptoms, no specialty named
  'my stomach has been bothering me for days',
  'I have a sharp pain in my side',
  'my lower back hurts',
  'something is wrong and I want to get checked',
  'I do not feel well and I would like to see a doctor',
  'I have worrying symptoms and need a doctor',
  'I keep getting headaches',
  'my knee hurts a lot',
  'my skin is burning and I have red patches',
  'my ear hurts and I have a fever',
  'I feel tired and weak all the time',
  'my child has had a fever since yesterday',
  'I want to find out what is wrong with me',

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
  'I need to see someone about my health',
  'I would like to get in to see a doctor',
  'I want to be seen by a doctor',
  'I am calling to arrange a visit',
  'I have pain in my knee and want to be examined',
  'my back hurts and I need a doctor',
  'I have had a fever for two days',
  'I keep coughing and feel weak',
  'I have a nasty rash on my arm',
  'my eyes hurt and are watering',
  'I have severe headaches and want a check up',
  'my stomach has been hurting all week',
  'my child has a high temperature',
  'my ear has been hurting for days',
  'my heart pounds when I walk fast',
  'I do not feel well and need a doctor',
  'something is wrong with my shoulder',
  'I have trouble sleeping and need advice from a specialist',
  'I would like to have a medical check',
  'I need to see a doctor',
  'I would like a check-up',
  'book me a doctor',
  'can I get a slot for an ultrasound',
  'I need a doctor for my husband',
  'I need an appointment with a dentist',
  'do you have free slots today',
  'I want an appointment for my child',
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
  'tell me about my booked visits',
  'which dates do I have reserved',
  'read me my appointments',
  'do I have a reservation somewhere',
  'how many appointments do I have',
  'which doctor am I booked with',
  'when is my nearest appointment',
  'is there anything booked for me',
  'am I booked to see a doctor',
  'do I have a visit coming up',
  'am I scheduled for anything',
  'check whether I have an appointment',
  'when do I see my doctor next',
  'what visits do I have next week',
  'do I have an appointment with the cardiologist',
  'I forgot when my appointment is',
  'what time is my visit',
  'when is my next appointment',
  'which doctor am I seeing',
  'do I have a visit booked this week',
  'can you check my booking',
  'tell me the time of my appointment',
  'what day is my appointment',
  'is my appointment still on',
  'what appointments are booked for my child',
  'I need to confirm my appointment time',
  'when am I supposed to come in',
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
  'I am sick and cannot come to my appointment',
  'I have to skip my appointment',
  'something came up so I cannot attend my visit',
  'I will be out of town on the day of my appointment',
  'my child is ill so we have to cancel the visit',
  'I do not need my appointment anymore',
  'please take me off the schedule',
  'drop my appointment please',
  'scrap my booking',
  'withdraw my appointment',
  'delete my reservation',
  'cancel the visit I have on Tuesday',
  'cancel my appointment for tomorrow',
  'please cancel my Friday appointment',
  'I want to cancel my visit with the cardiologist',
  'remove my appointment with the neurologist',
  'cancel my visit next week',
  'I have a conflict so please cancel my visit',
  'I no longer want to keep this appointment',
  'free up my time slot',
  'I cannot come to my appointment today',
  'I will not be able to make it',
  'please cancel my visit',
  'I need to call off my visit',
  'my child is sick so I have to cancel',
  'remove my booking please',
  'I am not coming to the clinic tomorrow',
  'cancellation of my appointment',
  'delete my visit',
  'sorry I cannot attend my visit',
];

const rescheduleUtterancesEn = [
  // no slots yet
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
  'can I move my visit to a different day',
  'I would like to postpone my appointment',
  'please postpone my visit',
  'I need to push my appointment back',
  'can we find another time for my appointment',
  'this time does not suit me',
  'I need a different time for my visit',
  'is it possible to change my visit to another date',
  'I would like to shift my appointment',
  'bring my appointment forward',
  'put my visit off until later',
  'I need another day for my appointment',
  'my appointment clashes with something, can we change it',
  'can I get a later slot for my visit',
  'can I get an earlier slot for my appointment',
  'switch my appointment from Monday to Wednesday',
  'move my visit from tomorrow to the day after',
  'change my cardiologist appointment to another day',
  'I would rather come on a different day',
  'the time of my appointment does not work for me',

  // date only (exact day) — bare "on/until {preferredDate}" live only in bookingUtterancesEn:
  // Lex requires sample utterances to be unique across all intents in a locale.
  'reschedule my appointment for {preferredDate}',
  'move my appointment to {preferredDate}',

  // date only (starting from / after) — bare "from/after {preferredDateAfter}" live only in bookingUtterancesEn.
  'reschedule my appointment for after {preferredDateAfter}',

  // time only (at/after) — bare variants live only in bookingUtterancesEn.

  // time only (before) — bare variant lives only in bookingUtterancesEn.

  // time of day — bare "{preferredTimeOfDay}" lives only in bookingUtterancesEn.
  'reschedule my appointment {preferredTimeOfDay}',

  // date + time
  'on {preferredDate} at {preferredTime}',
  'on {preferredDate} before {preferredTimeBefore}',
  'reschedule my appointment for {preferredDate} at {preferredTime}',
  'reschedule my appointment for {preferredDate} {preferredTimeOfDay}',
  'can I move my appointment to another day',
  'please shift my appointment to next week',
  'can we change the date of my visit',
  'I want to push my appointment back',
  'can I come later instead',
  'switch my appointment to another day',
  'rescheduling please',
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
  'let me talk to a real person',
  'put me through to a staff member',
  'I would rather speak to a human',
  'get someone from the clinic on the line',
  'I want a real person',
  'can I talk to a human please',
  'put me through to the front desk',
  'I need to speak with the reception',
  'connect me with a real person',
  'is there a person I can talk to',
  'transfer me to a staff member',
  'I would rather talk to someone',
  'get me a live agent',
  'let me speak to an operator',
];

const outOfScopeUtterancesEn = [
  'what is the price list',
  'how much do you charge for a consultation',
  'is the appointment paid',
  'how much does the test cost',
  'can I pay by card',
  'I need to renew my prescription',
  'I need a prescription',
  'I ran out of my medication',
  'I want to file a complaint',
  'I am unhappy with the service',
  'I need a sick note',
  'I need a medical leave certificate',
  'are my test results ready',
  'where can I pick up my results',
  'I need a referral for tests',
  'I want a copy of my medical records',
  'I need an invoice',
  'can I take these two medicines together',
  'what are the side effects of this medicine',
  'what does this test result mean',
  'is this dangerous',
  'I am looking for a pharmacy',
  'how do I get to the hospital',
  'I am calling from an insurance company',
  'I dialed the wrong number',
  'this is not the right clinic',
  'tell me a joke',
  'will it rain today',
  'who won the match',
  'call me a taxi',
  'how are you doing',
  'I do not want anything',
  'how much extra do I pay for the visit',
  'are the visits free of charge',
  'I need a certificate about my health',
  'when can I collect my results after the visit',
  'how do I prepare for an ultrasound',
  'do I have to fast before the test',
  'I need a referral for rehabilitation',
  'how do I get a referral for surgery',
  'I want to give feedback about the doctor',
  'where can I get an x-ray',
  'the doctor prescribed a drug I cannot buy',
  'I am calling from another clinic',
  'do you accept national health insurance',
  'I need a receipt for my visit',
  'I want my lab results',
  'I need a prescription for my regular medication',
  'can I get medical advice over the phone',
  'I need a certificate for my employer',
  'is this the hotel',
  'what is the weather like',
  'I want to order food',
  'I want to complain about a nurse',
  'I need a doctor note for work',
  'how long is the wait for surgery',
  'who are you',
];

export class InfraStack extends cdk.Stack {
  public readonly speechBot: lex.CfnBot;
  public readonly speechBotAlias: lex.CfnBotAlias;

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
                slotValue('kardiolog', ['kardiologa', 'lekarz od serca', 'kardiologia', 'serce', 'serca']),
                slotValue('dermatolog', [
                  'dermatologa',
                  'lekarz od skóry',
                  'dermatologia',
                  'skóra',
                  'wysypka',
                  'wysypki',
                  'pieprzyk',
                  'pieprzyki',
                  'trądzik',
                ]),
                slotValue('okulista', ['okulisty', 'lekarz od oczu', 'okulistyka', 'oczy', 'wzrok']),
                slotValue('laryngolog', [
                  'laryngologa',
                  'lekarz od gardła',
                  'lekarz od uszu nosa i gardła',
                  'laryngologia',
                  'uszy',
                  'gardło',
                  'gardła',
                  'zatoki',
                ]),
                slotValue('neurolog', ['neurologa', 'lekarz od nerwów', 'neurologia', 'głowa', 'głowy', 'migrena', 'migreny']),
                slotValue('ortopeda', [
                  'ortopedy',
                  'ortopedia',
                  'kości',
                  'staw',
                  'kolano',
                  'kolana',
                  'kręgosłup',
                  'kręgosłupa',
                  'biodro',
                  'ramię',
                ]),
                slotValue('internista', [
                  'internisty',
                  'lekarz rodzinny',
                  'lekarza rodzinnego',
                  'lekarz pierwszego kontaktu',
                  'lekarz ogólny',
                  'lekarz poz',
                  'internistyczna',
                ]),
                slotValue('ginekolog', ['ginekologa', 'ginekologia', 'ciąża', 'ciąży']),
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
            globalIntent('OutOfScopeIntent', outOfScopeUtterances),
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                  allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              slots: [
                {
                  name: 'specialty',
                  slotTypeName: 'Specialty',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('Do jakiego specjalisty chcą się Państwo umówić?')],
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
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('Jaki dzień, i o której godzinie, Państwu odpowiada?')],
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: true,
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
                      allowInterrupt: true,
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
                  allowInterrupt: true,
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
                { slotName: 'selectedSlot', priority: 1 },
                { slotName: 'preferredDate', priority: 2 },
                { slotName: 'preferredDateAfter', priority: 3 },
                { slotName: 'preferredTime', priority: 4 },
                { slotName: 'preferredTimeBefore', priority: 5 },
                { slotName: 'preferredTimeOfDay', priority: 6 },
              ],
              slots: [
                {
                  name: 'selectedSlot',
                  slotTypeName: 'AMAZON.Number',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
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
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('Jaki dzień, i o której godzinie, Państwu odpowiada?')],
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: true,
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
                    slots: [
                      { slotName: 'selectedSlot', slotValueOverride: {} },
                      { slotName: 'preferredDate', slotValueOverride: {} },
                      { slotName: 'preferredDateAfter', slotValueOverride: {} },
                      { slotName: 'preferredTime', slotValueOverride: {} },
                      { slotName: 'preferredTimeBefore', slotValueOverride: {} },
                      { slotName: 'preferredTimeOfDay', slotValueOverride: {} },
                    ],
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
          nluConfidenceThreshold: 0.2,
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
            globalIntent('OutOfScopeIntent', outOfScopeUtterancesEn),
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                  allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              slots: [
                {
                  name: 'specialty',
                  slotTypeName: 'Specialty',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('Which specialist would you like to see?')],
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
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('What day, and what time, would work for you?')],
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: true,
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
                      allowInterrupt: true,
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
                  allowInterrupt: true,
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
                { slotName: 'selectedSlot', priority: 1 },
                { slotName: 'preferredDate', priority: 2 },
                { slotName: 'preferredDateAfter', priority: 3 },
                { slotName: 'preferredTime', priority: 4 },
                { slotName: 'preferredTimeBefore', priority: 5 },
                { slotName: 'preferredTimeOfDay', priority: 6 },
              ],
              slots: [
                {
                  name: 'selectedSlot',
                  slotTypeName: 'AMAZON.Number',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
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
                  name: 'preferredDate',
                  slotTypeName: 'AMAZON.Date',
                  valueElicitationSetting: {
                    slotConstraint: 'Required',
                    promptSpecification: {
                      maxRetries: 2,
                      allowInterrupt: true,
                      messageGroupsList: [say('What day, and what time, would work for you?')],
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
                      allowInterrupt: true,
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
              ],
              intentConfirmationSetting: {
                promptSpecification: {
                  maxRetries: 2,
                  allowInterrupt: true,
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
                    slots: [
                      { slotName: 'selectedSlot', slotValueOverride: {} },
                      { slotName: 'preferredDate', slotValueOverride: {} },
                      { slotName: 'preferredDateAfter', slotValueOverride: {} },
                      { slotName: 'preferredTime', slotValueOverride: {} },
                      { slotName: 'preferredTimeBefore', slotValueOverride: {} },
                      { slotName: 'preferredTimeOfDay', slotValueOverride: {} },
                    ],
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

    this.speechBot = new lex.CfnBot(this, 'SpeechBot', {
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
      botId: this.speechBot.attrId,
      botVersionLocaleSpecification: [
        { localeId: speechLocale, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
        { localeId: speechLocaleEn, botVersionLocaleDetails: { sourceBotVersion: 'DRAFT' } },
      ],
    });

    this.speechBotAlias = new lex.CfnBotAlias(this, 'SpeechBotAlias', {
      botId: this.speechBot.attrId,
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
      sourceArn: this.speechBotAlias.attrArn,
    });

    const speechBotConnectInstanceId = cdk.Arn.split(
      connectInstanceArn,
      cdk.ArnFormat.SLASH_RESOURCE_NAME,
    ).resourceName;

    const speechBotAssociation = {
      InstanceId: speechBotConnectInstanceId,
      LexV2Bot: { AliasArn: this.speechBotAlias.attrArn },
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
          resources: [this.speechBotAlias.attrArn],
        }),
      ]),
      installLatestAwsSdk: false,
    });

    const languageDetect = new NodejsFunction(this, 'LanguageDetect', {
      functionName: 'phoneconnect-med-language-detect',
      entry: path.join(repoRoot, 'lambdas/language-detect-spike/index.ts'),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_24_X,
      timeout: cdk.Duration.seconds(55),
      environment: { BOT_ID: this.speechBot.attrId, BOT_ALIAS_ID: this.speechBotAlias.attrBotAliasId },
      logGroup: measurements,
      loggingFormat: lambda.LoggingFormat.JSON,
    });
    languageDetect.configureAsyncInvoke({ retryAttempts: 0 });

    languageDetect.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['kinesisvideo:GetDataEndpoint', 'kinesisvideo:GetMedia'],
        resources: ['*'],
      }),
    );
    languageDetect.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ['transcribe:StartStreamTranscription'], resources: ['*'] }),
    );
    languageDetect.role?.addToPrincipalPolicy(
      new iam.PolicyStatement({ actions: ['lex:RecognizeText'], resources: [this.speechBotAlias.attrArn] }),
    );

    languageDetect.addPermission('ConnectInvoke', {
      principal: new iam.ServicePrincipal('connect.amazonaws.com'),
      sourceArn: connectInstanceArn,
    });

    new connect.CfnIntegrationAssociation(this, 'LanguageDetectFunctionAssociation', {
      instanceId: connectInstanceArn,
      integrationType: 'LAMBDA_FUNCTION',
      integrationArn: languageDetect.functionArn,
    });

    new cdk.CfnOutput(this, 'LanguageDetectFunctionName', { value: languageDetect.functionName });

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
    new cdk.CfnOutput(this, 'SpeechBotAliasArn', { value: this.speechBotAlias.attrArn });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'MeasurementLogGroup', { value: measurements.logGroupName });
  }
}
