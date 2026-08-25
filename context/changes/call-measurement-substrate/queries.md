# Logs Insights queries — call measurement substrate

Every handler writes one JSON line per invocation to the shared measurement log group. Its name is
the `MeasurementLogGroup` stack output:

```bash
aws cloudformation describe-stacks --stack-name PhoneConnect-Med-InfraStack \
  --query "Stacks[0].Outputs[?OutputKey=='MeasurementLogGroup'].OutputValue" --output text
```

## 0. Confirm the record shape before running anything else

Logs Insights auto-discovers fields only when the log event is itself valid JSON. The Node.js
Lambda runtime's default TEXT logging format may prefix each `console.log` line with a timestamp,
request id and level, which would leave `kind` and `durationMs` undiscovered and every query below
returning nothing.

Run this first and look at one record:

```
fields @message
| filter @message like 'invocation'
| limit 5
```

- `@message` is exactly `{"kind":"invocation",...}` — use **Form A** below.
- `@message` is `2026-08-25T16:07:11.184Z<TAB>abc-123<TAB>INFO<TAB>{"kind":...}` — the fields are
  not discoverable. Set `loggingFormat: lambda.LoggingFormat.JSON` on the function in
  `infra/lib/infra-stack.ts`, redeploy, and use **Form B**. Do not work around it with regex
  parsing in every query.

## 1. Reconstruct a single call — FR-008

Path taken, outcome and duration for one contact id, in order.

Form A:

```
fields @timestamp, handler, outcome, durationMs, downstreamMs, variant, authPath
| filter kind = 'invocation' and contactId = 'CONTACT_ID'
| sort @timestamp asc
```

Form B:

```
fields @timestamp, message.handler, message.outcome, message.durationMs, message.downstreamMs, message.variant, message.authPath
| filter message.kind = 'invocation' and message.contactId = 'CONTACT_ID'
| sort @timestamp asc
```

## 2. Latency split by variant — NFR (p95 < 2s)

The headline comparison figure, plus the count of records that cannot contribute to it because the
contact flow did not pass `variant`.

Form A:

```
filter kind = 'invocation'
| stats count(*) as n,
        pct(durationMs, 95) as p95,
        pct(downstreamMs, 95) as downstreamP95,
        sum(ispresent(variant) ? 0 : 1) as missingVariant
  by variant
```

Form B:

```
filter message.kind = 'invocation'
| stats count(*) as n,
        pct(message.durationMs, 95) as p95,
        pct(message.downstreamMs, 95) as downstreamP95,
        sum(ispresent(message.variant) ? 0 : 1) as missingVariant
  by message.variant
```

`downstreamP95` is what discharges the PRD guardrail that the stand-in must not dominate measured
latency: it is the share of `p95` spent waiting on the mock.

Records with no `variant` group into their own row. `missingVariant` restates that row's `n`
explicitly so the gap is visible without reading the grouping.

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
  --query-string "fields @timestamp, handler, outcome, durationMs, downstreamMs, variant, authPath, contactId | filter kind = 'invocation' | sort @timestamp asc | limit 10000" \
  --query queryId --output text)

until [ "$(aws logs get-query-results --query-id "$QUERY_ID" --query status --output text)" = "Complete" ]; do sleep 2; done

aws logs get-query-results --query-id "$QUERY_ID" \
  > context/changes/call-measurement-substrate/dataset.json
```

Adjust the `fields` list to match the form you used in step 0.

**Standing instruction.** The final measurement dataset is committed to this repository once the
measurement runs are complete. The thesis cites the committed file, never a live query.
