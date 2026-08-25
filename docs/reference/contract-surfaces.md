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
