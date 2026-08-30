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
