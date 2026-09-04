# Contract surfaces

Load-bearing names that cross a boundary nothing in this repository can enforce — hand-built
contact flows, console configuration, external systems. Changing one of these silently breaks
something that no test will catch.

## `Details.Parameters.variant`

- **Set by:** every contact flow's Invoke AWS Lambda function block, as a flow parameter.
- **Read by:** `lambdas/measure/index.ts`, into the per-invocation record's `variant` field.
- **Allowed values:** `keypad`, `speech`. Anything else is discarded and the record counts as
  missing.
- **Why it matters:** it is the only thing that separates the two variants in the measurement
  data. A record without it cannot contribute to the A-vs-B comparison, which is the hypothesis
  the whole project tests. Flows are hand-built and outside IaC, so nothing enforces this at
  deploy time — the p95 query in
  `context/changes/call-measurement-substrate/queries.md` reports how many records are missing it
  so the gap stays visible.

## `lastMessageText` contact attribute

- **Set by:** a Set Contact Attributes block placed before every Play Prompt in every contact
  flow, writing the exact text about to be spoken.
- **Read by:** the reserved repeat digit's branch at every Get Customer Input block, which plays
  back `$.Attributes.lastMessageText` verbatim before re-entering the same input block.
- **Why it matters:** this is the whole repeat mechanism (FR-003) — a stored-attribute
  convention, not a per-block loop-back. It is generic on purpose, introduced in S-01 so every
  later slice's menu can extend it rather than rebuild it. If a new Play Prompt forgets to set
  this attribute first, repeat silently plays stale (or no) text at that point in the flow.
  Nothing in the repo enforces this — flows are hand-built and outside IaC.

## Lex session attributes (facility-info-speech bot)

- **`contactId`**
  - **Set by:** the contact flow's Get Customer Input (Lex) block, from `$.ContactId`, passed as
    a Lex session attribute when the block invokes the bot.
  - **Read by:** `lambdas/facility-info-speech/index.ts`, to stamp the synthetic `ConnectEvent` it
    builds for `measured()`'s `contactId` field — a Lex fulfillment event carries no contact ID of
    its own.
- **`lastMessageText`**
  - **Set by:** every intent response in `lambdas/facility-info-speech/index.ts`, to whatever it
    just said.
  - **Read by:** `RepeatLastMessageIntent`'s handler, echoed back verbatim. The Lex-session-scoped analogue
    of the `lastMessageText` contact attribute above.
- **`fallbackCount`**
  - **Set by:** `lambdas/facility-info-speech/index.ts` — incremented on `FallbackIntent`, reset
    to `'0'` on every other intent.
  - **Read by:** the contact flow, via `$.Lex.SessionAttributes.fallbackCount`, to decide
    loop-back vs. transfer to the agent queue after each turn.
- **`callerNumber`** (S-03)
  - **Set by:** the contact flow's Get Customer Input (Lex) block, from
    `$.CustomerEndpoint.Address`, passed alongside `contactId` — a Lex fulfillment event carries
    no caller-ID field of its own.
  - **Read by:** `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch, as the third input
    to `@pcm/patient`'s `authenticate`, compared against the declared `phone` slot value.
- **`authenticated`** / **`patientId`** (S-03)
  - **Set by:** `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch, only on the
    caller-ID shortcut match (`authenticated: 'true'`, `patientId` the matched patient's id).
    Never set on any other outcome.
  - **Read by:** a future slice's intent handler, to check identity was already established in
    this session without recapturing it. The Lex-session-scoped analogue of the keypad variant's
    `authenticated` / `patientId` contact attributes below.
- **`transfer`** (S-03)
  - **Set by:** `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch, to `'true'` only on
    a genuine downstream failure (the mock unreachable) — no longer set on a non-shortcut match or
    no-match outcome, both of which now start an OTP challenge instead (see below).
  - **Read by:** the contact flow, via `$.Lex.SessionAttributes.transfer`, branching to the agent
    queue when present.
- **`otpRequired`** / **`isDemo`** / **`code`** / **`phone`** (S-04)
  - **Set by:** `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch, on every
    non-shortcut outcome (`otpRequired: 'true'`; `code`/`phone` empty and `isDemo: 'false'` for a
    no-match pair, so nothing observable distinguishes it from a real match). `OtpIntent` updates
    `code` again on a resend.
  - **Read by:** `OtpIntent`'s fulfillment, as the inputs to `@pcm/patient`'s `verifyOtpCode` and
    to the inline resend logic (fresh code generation and `sns:Publish`, when not a demo).
- **`otpMismatch`** (S-04)
  - **Set by:** `OtpIntent`'s fulfillment, to `'true'` when the entered code doesn't match.
  - **Read by:** the contact flow, via `$.Lex.SessionAttributes.otpMismatch`, to decide whether to
    re-elicit `OtpIntent` or transfer, mirroring the keypad variant's attempt counter.
- **Why it matters:** this is the speech variant's counterpart to the keypad variant's contact
  attributes and reserved digits — repeat and fallback/transfer state, carried in Lex session
  state instead. Nothing in the repo enforces this; flows are hand-built and outside IaC.

## Keypad contact attributes: `authenticated`, `patientId` (S-03)

- **Set by:** the keypad capture Contact Flow Module (console, not committed), from the
  `Authenticate` function's `authenticated` / `patientId` output fields, only when
  `authenticated` equals `'true'`.
- **Read by:** any future slice's contact flow that needs to know identity was already
  established in this call without recapturing it — the contact-attribute analogue of the Lex
  session attributes of the same name above.
- **Why it matters:** this is the keypad variant's persistence of the authenticated state across
  the rest of the call, set once by the Contact Flow Module so later flow blocks (and later
  slices) don't need to re-run verification. Nothing in the repo enforces this; flows are
  hand-built and outside IaC.

## Keypad contact attributes: `otpRequired`, `isDemo`, `code`, `phone` (S-04)

- **Set by:** the `Authenticate` function's non-shortcut output fields (`otpRequired: 'true'`,
  `isDemo`, `code`, `phone`, `patientId`), written to contact attributes by the keypad capture
  Contact Flow Module. A no-match pair gets the same fields with `code`/`phone` empty and
  `isDemo: 'false'` — the same neutrality guarantee as `authenticated`/`patientId` above.
- **Read by:** the OTP Contact Flow Module (console, not committed) — `phone`/`code`/`isDemo` are
  the `Details.Parameters` it passes to `SendOtp`, and `code`/`isDemo`/`patientId` are what it
  passes to `OtpVerify`. It also overwrites its own `code` contact attribute from `SendOtp`'s
  response after a resend.
- **Why it matters:** if a resend forgets to update the stored `code` attribute, verification
  silently always fails against the stale code. Nothing in the repo enforces this; flows are
  hand-built and outside IaC.

## Reserved resend digit: `9` (S-04)

- **Scope:** the OTP capture step only, in both variants — distinct from the global `0`/`*`
  digits above, which apply everywhere in a call.
- **Set by / read by:** the OTP Contact Flow Module's menu (keypad) and `OtpIntent`'s `otpCode`
  slot value (speech) — entering `9` triggers a resend instead of code entry, without consuming
  one of the three verification attempts.
- **Why it matters:** unlike `0`/`*`, this digit means "resend" only inside the OTP capture step;
  it carries no reserved meaning elsewhere in the call. Nothing in the repo enforces this; flows
  and bot config are hand-built and outside IaC.

## `Details.Parameters.pesel` / `.phone` / `.callerNumber` (S-03)

- **Set by:** the keypad capture Contact Flow Module (console, not committed) invoking the
  `Authenticate` function — `pesel` and `phone` from the confirmed keypad capture, `callerNumber`
  from `$.CustomerEndpoint.Address`.
- **Read by:** `lambdas/authenticate/index.ts`, as the three inputs to `@pcm/patient`'s
  `authenticate`.
- **Why it matters:** same class of gap as `Details.Parameters.variant` above — a hand-built
  Invoke AWS Lambda block that forgets one of these parameters silently sends an empty string
  through to verification rather than failing loudly. Nothing in the repo enforces this; flows
  are hand-built and outside IaC.

## Reserved global digits

- **`0`** — always transfers to the agent queue (FR-006), from any Get Customer Input block.
- **`*`** — always repeats the last spoken prompt, reading `lastMessageText` back verbatim
  (FR-003). See `lastMessageText` above.
- **`#`** (S-05) — always returns to the top-level main menu
  (`keypad-facility-info-main-menu-flow.json`), from any Get Customer Input block deep enough to
  need it. Assigned when `keypad-booking-flow.json` became this system's first genuinely deep
  sub-menu (specialty page → time-of-day → day choice → time choice → confirm); no flow before
  S-05 was deep enough to need it (see the lessons file's rule on assigning this digit only once a
  real sub-menu needs it). In-progress booking state (`specialty`, `timeOfDay`, `dayChoice`,
  `timeChoice`) is discarded on `#` — it is a fresh start, not a resume point.
- **Set by / read by:** every Get Customer Input block in every contact flow, alongside that
  block's own menu-specific digits.
- **Why it matters:** these three digits are reserved across the whole system. A future menu must
  never reassign `0`, `*`, or `#` to a menu-specific choice — doing so would silently break the
  global commands FR-003/FR-006 guarantee (or, for `#`, strand the caller with no way back to the
  main menu) from any point in the call. Nothing in the repo enforces this; flows are hand-built
  and outside IaC.

## `Details.Parameters.step` / `.specialty` / `.timeOfDay` / `.dayChoice` / `.timeChoice` (S-05)

- **Set by:** `keypad-booking-flow.json`'s four `InvokeExternalResource` blocks, invoking the
  `Booking` function — `step` is a literal (`days` / `times` / `confirm` / `book`) per block;
  `specialty` and `timeOfDay` come from the digit-menu selection earlier in the same flow;
  `dayChoice` / `timeChoice` are the raw `1`/`2`/`3` digits the caller pressed at the day/time
  menus, added once each is captured.
- **Read by:** `lambdas/booking/index.ts`, which re-derives the actual date/time from
  `dayChoice`/`timeChoice` via `@pcm/appointment`'s `resolveDay`/`resolveTime` on every call — the
  flow never stores or passes a resolved date/time itself (L-03: the digit-to-date mapping is a
  domain decision and lives only in the shared layer).
- **Why it matters:** same class of gap as `Details.Parameters.variant` above — a hand-built
  Invoke AWS Lambda block that forgets one of these silently sends an empty string through, and
  `findAvailableDays`/`resolveDay`/`resolveTime` all treat an empty specialty/timeOfDay as a
  genuine (if odd) empty search rather than failing loudly. Nothing in the repo enforces this;
  flows are hand-built and outside IaC.

## `selectedSlot`'s dual-purpose reuse (S-05, speech only)

- **Set by:** the caller, once for the day choice and again for the time choice, both times as the
  same `BookingIntent` slot (`selectedSlot`, `AMAZON.Number`) — the dialog code hook tracks which
  meaning is current via the `bookingStage` session attribute (`'day'` vs. `'time'`), not via two
  separate slots.
- **Reset by:** the dialog code hook, via `slotValueOverride: {}` on `selectedSlot` between the day
  and time turns (`elicitSlot('BookingIntent', 'selectedSlot', { ...slots, selectedSlot: null }, ...)`
  in `lambdas/facility-info-speech/index.ts`), and by `BookingIntent`'s `declinationNextStep` on the
  read-back decline path — the same `slotValueOverride` mechanic `AuthIntent`'s
  `declinationNextStep` already uses to reset `pesel`/`phone`, applied here to a single slot instead
  of two.
- **Why it matters:** a caller declining the confirmation must land back at the day offering with
  `specialty`/`timeOfDay` intact but `selectedSlot` cleared — clearing the wrong slot(s), or
  clearing none, would either lose the caller's specialty choice or resume mid-way through a stale
  day/time selection. Nothing in the repo enforces this; the Lex bot config is hand-built and
  outside IaC (see `infra/lib/infra-stack.ts`'s `BookingIntent` definition for the actual
  `declinationNextStep`).

## `needsAuth` (S-05)

- **Set by:** `lambdas/booking/index.ts` (returned as a Lambda output field, not a contact
  attribute) and `lambdas/facility-info-speech/index.ts`'s `BookingIntent` dialog code hook (as a
  Lex session attribute), both when the caller reaches for booking without `authenticated`/
  `authenticated` session attribute equal to `'true'`.
- **Read by, keypad:** nothing — see "Auth-gate redirect asymmetry between variants" below.
  `lambdas/booking/index.ts` still returns it defensively (matching the plan's original design), but
  `keypad-facility-info-main-menu-flow.json` and `keypad-authenticated-menu-flow.json` gate on the
  `authenticated` **contact attribute** directly, before ever invoking `Booking`, so this output
  field is not expected to be read by either committed keypad flow in normal operation.
- **Read by, speech:** the speech flow's `checkBookingNeedsAuth` branch (see
  `connect-flow-templates/flows/speech-bookingintent-fragment.md`), via
  `$.Lex.SessionAttributes.needsAuth`, looping back to re-prompt the caller so they can say an
  `AuthIntent` utterance.
- **Why it matters:** the two variants resolve the same requirement (an unauthenticated caller
  reaching for booking must authenticate first) through genuinely different mechanisms, documented
  next.

## Auth-gate redirect asymmetry between variants (S-05)

- **Keypad:** a flow-level branch. `keypad-facility-info-main-menu-flow.json`'s `2` digit
  (book an appointment) and `keypad-authenticated-menu-flow.json`'s `1` digit both exist —an
  unauthenticated caller pressing `2` at the main menu is `TransferToFlow`'d into
  `keypad-authenticate-flow.json` as-is (that flow's own hardcoded ending lands them on
  `keypad-authenticated-menu-flow.json`); an already-authenticated caller pressing `2` is
  transferred straight into `keypad-booking-flow.json`. The caller who was routed through
  authentication presses one more digit (`1`, "book an appointment") on the authenticated menu to
  actually enter booking — this is a deliberate adaptation, not the plan's original literal
  "resume exactly where booking left off": `keypad-authenticate-flow.json` is a standalone Contact
  Flow with a hardcoded transfer target (not a reusable Contact Flow Module the plan assumed), so a
  true same-turn resume was not buildable without either refactoring that already-verified S-03
  flow or duplicating its ~400 lines of PESEL/phone/OTP capture logic. Costs one extra keypress;
  avoids both alternatives.
- **Speech:** no flow-level redirect at all. `BookingIntent`'s dialog code hook closes with
  `needsAuth: 'true'` and a spoken prompt; the flow loops back to `elicitAgain` and the caller says
  an `AuthIntent` utterance in the same bot session, then simply restates their booking request —
  Lex V2 has no "switch intent" dialog action to resume `BookingIntent` automatically.
- **Why it matters:** the manual verification matrix (this plan's Phase 6) treats "routed through
  authentication, then able to book" as satisfying the requirement in both variants, not a literal
  same-turn resume — read 6.7 against this asymmetry, not against the plan's original prose.

## Speech confirmation read-back text (S-05)

- **Set by:** `lambdas/facility-info-speech/index.ts`'s `handleBookingDialog`, on the turn that
  transitions `bookingStage` to `'confirm'` — it returns a `ConfirmIntent` response whose `messages`
  field carries the templated read-back (`Umawiam Panią/Pana do {specialty}, {day}, godzina {time}.
  Czy się zgadza?`), which Lex plays instead of the intent's own confirmation prompt for that turn.
- **Not set by:** `BookingIntent`'s `intentConfirmationSetting` prompt in `infra/lib/infra-stack.ts` —
  that prompt is a static string (`Czy się zgadza? Powiedz tak albo nie.`), unlike `AuthIntent`'s
  `{pesel}`/`{phone}` Lex-native slot templating. `date`/`time` aren't `BookingIntent` slot values (they're
  derived, not elicited), so they can't be referenced in a Lex `{slot}` template the way `AuthIntent`'s
  PESEL/phone can — the Lambda's `messages` override is the mechanism that fills that gap.
- **Why it matters:** anyone changing `BookingIntent`'s `intentConfirmationSetting` prompt text in
  `infra-stack.ts` expecting it to change what the caller actually hears will be surprised — the
  Lambda's per-turn `messages` always wins for this intent's confirmation.

## Turn-count measurement convention for booking (S-05, FR-012)

- **Convention:** turns-to-completion for a booking session is the count of `InvocationRecord`s
  with `handler: 'booking'` (keypad) — or `handler: 'facility-info-speech'` carrying a
  `BookingIntent`-stage session attribute (speech) — sharing one `contactId`.
- **Why no schema change:** `InvocationRecord` already carries `handler` and (via the synthetic
  `ConnectEvent` `lambdas/facility-info-speech/index.ts` builds) `contactId` for every invocation;
  grouping by those two existing fields is sufficient, so this is a query-time convention, not a new
  field.
- **Read by:** whatever ad hoc CloudWatch Logs Insights query the measurement write-up runs at
  analysis time (see `context/changes/call-measurement-substrate/queries.md` for the existing
  query style this convention extends).
