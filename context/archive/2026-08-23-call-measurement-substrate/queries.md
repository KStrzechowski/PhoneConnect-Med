# Logs Insights queries — call measurement substrate

Every handler writes one record per invocation to the shared measurement log group. Its name is
the `MeasurementLogGroup` stack output:

```bash
aws cloudformation describe-stacks --stack-name PhoneConnect-Med-InfraStack \
  --query "Stacks[0].Outputs[?OutputKey=='MeasurementLogGroup'].OutputValue" --output text
```

## The record shape, and why the queries read `message.`

The function runs with `loggingFormat: JSON`, and the wrapper hands `console.log` the record
object rather than a string. The runtime therefore wraps each record in its own envelope, and the
whole log event is valid JSON — which is what lets Logs Insights auto-discover the fields:

```json
{
  "timestamp": "2026-08-25T18:30:01.275Z",
  "level": "INFO",
  "requestId": "bd8ae192-deb0-4a1f-8e14-a0f017e8ec18",
  "message": {
    "kind": "invocation",
    "ts": "2026-08-25T18:30:01.185Z",
    "handler": "connect-health",
    "durationMs": 90,
    "outcome": "error",
    "contactId": "11111111-2222-3333-4444-555555555555",
    "downstreamMs": 89
  }
}
```

The record's own fields are therefore addressed as `message.kind`, `message.durationMs` and so on.
`requestId` comes free with the envelope and identifies the single invocation.

This was settled by running the bundled handler against `public.ecr.aws/lambda/nodejs:24` under the
Runtime Interface Emulator. Two shapes were rejected on the evidence: under the **default TEXT**
format the runtime prefixes each line with `timestamp<TAB>requestId<TAB>INFO<TAB>`, leaving the
event invalid JSON and every field undiscovered; and under JSON format with a **stringified**
record, `message` arrives as an escaped string rather than an object, so `message.kind` does not
resolve either. Only `loggingFormat: JSON` plus an object argument produces a queryable record.

If a future handler's records are not discoverable, check those two things before anything else.

## 1. Reconstruct a single call — FR-008

Path taken, outcome and duration for one contact id, in order.

```
fields @timestamp, message.handler, message.outcome, message.durationMs, message.downstreamMs, message.variant, message.authPath
| filter message.kind = 'invocation' and message.contactId = 'CONTACT_ID'
| sort @timestamp asc
```

## 2. Latency split by variant — NFR (p95 < 2s)

The headline comparison figure, plus the count of records that cannot contribute to it because the
contact flow did not pass `variant`.

```
filter message.kind = 'invocation'
| stats count(*) as n,
        pct(message.durationMs, 95) as p95,
        pct(message.downstreamMs, 95) as downstreamP95
  by message.variant
```

`downstreamP95` is what discharges the PRD guardrail that the stand-in must not dominate measured
latency: it is the share of `p95` spent waiting on the mock.

Records with no `variant` group into their own row, identifiable by having no `message.variant`
value in that row — that row's own `n` is the missing count directly. An earlier version of this
query added a derived `missingVariant` column computed as `count(*) - count(message.variant)`.
That column is gone: Logs Insights omits an aggregate over an entirely-absent field from a row's
JSON rather than returning `0`, but the console still renders the missing cell as `0` in its
table view — showing `0` on precisely the row meant to warn that records are missing a variant.
Reading the no-variant row's own `n` has no such failure mode.

Demo sessions are excluded from absolute figures by adding `and message.authPath != 'demo'` to the
filter, once S-04 starts setting it.

## 3. Export the dataset — do not rely on retention

Retention is a rolling 90-day window and the submission date is unknown (PRD Open Question 1), so
measurements taken early enough would be gone before the write-up. Export after each measurement
run and commit the file.

```bash
LOG_GROUP=$(aws cloudformation describe-stacks --stack-name PhoneConnect-Med-InfraStack \
  --query "Stacks[0].Outputs[?OutputKey=='MeasurementLogGroup'].OutputValue" --output text)

QUERY_ID=$(aws logs start-query \
  --log-group-name "$LOG_GROUP" \
  --start-time $(date -d '90 days ago' +%s) \
  --end-time $(date +%s) \
  --query-string "fields @timestamp, message.handler, message.outcome, message.durationMs, message.downstreamMs, message.variant, message.authPath, message.contactId | filter message.kind = 'invocation' | sort @timestamp asc | limit 10000" \
  --query queryId --output text)

until [ "$(aws logs get-query-results --query-id "$QUERY_ID" --query status --output text)" = "Complete" ]; do sleep 2; done

aws logs get-query-results --query-id "$QUERY_ID" \
  > context/changes/call-measurement-substrate/dataset.json
```

**Standing instruction.** The final measurement dataset is committed to this repository once the
measurement runs are complete. The thesis cites the committed file, never a live query.
