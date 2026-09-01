# Inteligentna Infolinia Medyczna – PoC

System automatycznej obsługi połączeń głosowych oparty na **Amazon Connect + Amazon Lex V2**, zaimplementowany w architekturze serverless AWS.

## Struktura projektu

```
infolinia/
├── bin/
│   └── app.ts                    # CDK app entry point
├── lib/
│   ├── infolinia-stack.ts        # Główny stack CDK (wszystkie zasoby AWS)
│   └── lex-bot-construct.ts      # Construct bota Amazon Lex V2 (16 intencji)
├── lambda/
│   ├── shared/
│   │   ├── types.ts              # Wspólne typy (Lex, Connect, HIS, DynamoDB)
│   │   └── utils.ts              # Klient HIS, helpery DynamoDB, walidacja PESEL/tel, buildery odpowiedzi Lex
│   ├── verify-patient/           # Weryfikacja pary PESEL+telefon + wysyłka OTP
│   ├── send-otp/                 # Ponowne wysłanie OTP
│   ├── verify-otp/               # Weryfikacja kodu OTP (TTL, próby)
│   ├── get-patient-data/         # Dane pacjenta z HIS
│   ├── get-appointments/         # Lista wizyt pacjenta
│   ├── get-slots/                # Dostępne terminy (spec + pora dnia + offset)
│   ├── book-appointment/         # Rezerwacja wizyty
│   ├── cancel-appointment/       # Odwołanie wizyty
│   ├── reschedule-appointment/   # Przełożenie wizyty
│   ├── get-facility-config/      # Konfiguracja placówki (routing po numerze tel)
│   └── mock-his/                 # Mock systemu HIS – REST API Gateway
├── tsconfig.json
├── cdk.json
└── package.json
```

## Wymagania

- Node.js 20+
- AWS CLI skonfigurowane (`aws configure`)
- AWS CDK v2 (`npm install -g aws-cdk`)

## Instalacja i wdrożenie

```bash
# Zainstaluj zależności
npm install

# Bootstrap CDK (jednorazowo per konto/region)
npx cdk bootstrap aws://ACCOUNT_ID/eu-central-1

# Podgląd zmian
npx cdk diff

# Wdrożenie
npx cdk deploy --require-approval never
```

## Zasoby tworzone przez CDK

| Zasób | Nazwa | Opis |
|-------|-------|------|
| DynamoDB | `infolinia-sessions` | Sesje OTP z TTL |
| DynamoDB | `infolinia-call-logs` | Logi wywołań Lambda |
| DynamoDB | `infolinia-facilities` | Konfiguracja placówek |
| S3 | `infolinia-recordings-{account}` | Nagrania i raporty |
| SNS | `infolinia-otp` | Wysyłka SMS z kodami OTP |
| SNS | `infolinia-alerts` | Alerty CloudWatch |
| Secrets Manager | `infolinia/his-api` | Credentials do HIS |
| Lambda | `infolinia-verify-patient` | Weryfikacja PESEL+tel w HIS |
| Lambda | `infolinia-send-otp` | Ponowne wysłanie OTP |
| Lambda | `infolinia-verify-otp` | Weryfikacja kodu OTP |
| Lambda | `infolinia-get-patient-data` | Dane pacjenta |
| Lambda | `infolinia-get-appointments` | Lista wizyt |
| Lambda | `infolinia-get-slots` | Dostępne terminy |
| Lambda | `infolinia-book-appointment` | Rezerwacja wizyty |
| Lambda | `infolinia-cancel-appointment` | Odwołanie wizyty |
| Lambda | `infolinia-reschedule-appointment` | Przełożenie wizyty |
| Lambda | `infolinia-get-facility-config` | Konfiguracja placówki |
| Lambda | `infolinia-mock-his` | Mock systemu HIS |
| API Gateway | `infolinia-mock-his` | REST API mockujące HIS |
| Lex V2 | `InfoliniaBot` | Bot z 16 intencjami, język PL |
| CloudWatch Alarm | `infolinia-lambda-errors` | Alert przy błędach > 5% |
| CloudWatch Alarm | `infolinia-lambda-latency-p95` | Alert przy latencji > 2000ms |

## Bot Lex V2 – intencje

### Globalne (dostępne zawsze)
| Intencja | Opis |
|----------|------|
| `MainMenuIntent` | Przywitanie, menu główne |
| `InfoIntent` | Informacje o placówce |
| `RepeatLastMessageIntent` | Powtórzenie komunikatu |
| `AgentTransferIntent` | Transfer do agenta |
| `FallbackIntent` | Nierozpoznane wypowiedzi |

### Uwierzytelnianie
| Intencja | Opis |
|----------|------|
| `AuthIntent` | Zbieranie PESEL + telefon |
| `OtpIntent` | Weryfikacja kodu OTP |
| `ResendOtpIntent` | Ponowne wysłanie OTP |

### Wymagające uwierzytelnienia
| Intencja | Opis |
|----------|------|
| `PatientDataIntent` | Dane pacjenta |
| `AppointmentsIntent` | Lista wizyt |
| `BookingIntent` | Rejestracja wizyty (spec + pora dnia) |
| `NextSlotsIntent` | Kolejna pula terminów |
| `ConfirmBookingIntent` | Potwierdzenie rezerwacji |
| `CancelAppointmentIntent` | Odwołanie wizyty |
| `RescheduleIntent` | Przełożenie wizyty |
| `ConfirmActionIntent` | Potwierdzenie akcji |
| `DenyIntent` | Anulowanie akcji |

## Mock HIS – endpointy API Gateway

```
GET    /patients              Lista pacjentów (opcjonalnie ?phone=)
GET    /patients/{pesel}      Dane pacjenta
GET    /appointments          Lista wizyt (?pesel= opcjonalnie)
POST   /appointments          Nowa wizyta { pesel, slotId }
GET    /appointments/{id}     Jedna wizyta
PUT    /appointments/{id}     Przełożenie wizyty { newSlotId }
DELETE /appointments/{id}     Odwołanie wizyty
GET    /slots                 Dostępne terminy (?specialization=&timeOfDay=&limit=&offset=)
GET    /facilities/{phone}    Konfiguracja placówki
```

## Uwierzytelnianie pacjenta – przepływ

```
Pacjent podaje PESEL
    → walidacja formatu + cyfra kontrolna (Lambda)
Pacjent podaje numer telefonu
    → walidacja formatu (Connect)
CLID == telefon?
    → TAK: uwierzytelnienie bez OTP
    → NIE: wysyłka OTP przez SNS → weryfikacja kodu (maks. 3 próby, TTL 5 min)
```

## Konfiguracja Amazon Connect

Po wdrożeniu CDK:
1. Skopiuj `LexBotAliasId` z outputów CDK
2. W konsoli Amazon Connect → Channels → Amazon Lex → dodaj bota `InfoliniaBot`
3. Skonfiguruj Contact Flow używając bloku `Get customer input` z aliasem bota
4. Skonfiguruj numer telefoniczny i przypisz do Contact Flow

## Dane testowe (mock HIS)

| PESEL | Imię | Telefon |
|-------|------|---------|
| 80010112345 | Jan Kowalski | 600100200 |
| 90020256789 | Anna Nowak | 700200300 |
| 75030367890 | Piotr Wiśniewski | 500300400 |
