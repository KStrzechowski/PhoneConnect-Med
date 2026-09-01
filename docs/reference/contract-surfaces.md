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
  - **Set by:** `lambdas/facility-info-speech/index.ts`'s `AuthIntent` branch, to `'true'` on
    every non-shortcut outcome (no match, matched-wrong-number, or a downstream failure) —
    `AuthIntent` isn't itself `AgentTransferIntent`, so the contact flow needs an explicit signal
    to route to the agent queue after this intent closes, the same way it already reads
    `fallbackCount` to decide loop-back vs. transfer.
  - **Read by:** the contact flow, via `$.Lex.SessionAttributes.transfer`, branching to the agent
    queue when present.
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
- **Set by / read by:** every Get Customer Input block in every contact flow, alongside that
  block's own menu-specific digits.
- **Why it matters:** these two digits are reserved across the whole system. A future menu must
  never reassign `0` or `*` to a menu-specific choice — doing so would silently break the global
  commands FR-003/FR-006 guarantee from any point in the call. Nothing in the repo enforces this;
  flows are hand-built and outside IaC.
