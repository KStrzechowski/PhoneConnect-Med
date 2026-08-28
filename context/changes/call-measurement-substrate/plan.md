# Call Measurement Substrate Implementation Plan

## Overview

Roadmap item **F-02**. Every handler invocation emits one structured record to stdout, collected
by CloudWatch Logs into a single log group retained for three months and queried with Logs
Insights. A shared wrapper makes emission structural rather than remembered, so no later slice
can silently skip it.

This exists ahead of any user-facing work because PRD §Success Criteria → Primary requires
latency to be recorded "from that moment on, so handling-time data accumulates from the first
slice rather than being retrofitted at the end". Data gathered before a retrofit would not be
comparable with data gathered after it.

## Current State Analysis

- `lambdas/connect-health/` is the only handler. It is a self-contained npm package with its own
  `package.json`, `package-lock.json` and `tsconfig.json`, and it runs TypeScript directly —
  `node --test` importing `./index.ts`, with `allowImportingTsExtensions` set.
- `infra/lib/infra-stack.ts:63-70` pins the bundler to that one directory via `projectRoot` and
  `depsLockFilePath`, so a second package sharing code is not currently reachable.
- The handler makes **no runtime AWS API calls**, deliberately. F-01 chose `natGateways: 0` with
  no interface endpoints; a single SDK call would force a ~$7.30/mo interface endpoint.
- `infra/lib/infra-stack.ts:77-80` gives the function a dedicated log group at `TWO_WEEKS`
  retention.
- `his/` has no logging of any kind and sits inside the measured request path.
- Nothing is deployed. Every automated step of F-01 has landed; **every manual verification step
  is unchecked** and `cdk deploy` has never run.

## Desired End State

A handler is exported through `measured(...)` and cannot run without emitting a record. Each
record carries a fixed core — contact id, variant, outcome, total duration, downstream duration,
auth path — plus whatever the handler adds. All handlers write to one log group retained three
months. Two committed Logs Insights queries answer the questions FR-008 and NFR-12 ask:
reconstruct a single call, and compute p95 latency split by variant.

Verified by: invoking the deployed function with the sample event, then running the committed
queries and seeing that invocation's record come back.

### Key Discoveries:

- **npm workspaces resolve through a symlink to the package's real path**, so Node's
  type-stripping still applies to a shared `.ts` file imported by package name. Verified
  empirically on Node 24.18.0 against a scratch workspace: a test importing `@pcm/measure`
  resolved and ran with no build step. This removes the one thing that would have forced a
  compile step into the shared package.
- **`console.log` reaches CloudWatch Logs from any network position.** The Lambda service
  delivers stdout out-of-band, not over the VPC ENI. This is what makes one emission contract
  work identically for VPC-attached handlers (facility info, pair verification) and non-VPC ones
  (the future SMS sender, per the roadmap's S-04 network-position note).
- **A function's `logGroup` prop can point several functions at one shared log group**
  (`infra/lib/infra-stack.ts:77`), and `console.log` then lands there with no SDK call. This is
  what makes a single query target possible across every handler.
- **`RetentionDays.THREE_MONTHS` exists** in the installed CDK. Volume is a few thousand records
  of a few hundred bytes — single-digit megabytes, inside CloudWatch Logs' free tier for both
  ingestion and storage.
- **The Connect event already carries the contact id** at
  `Details.ContactData.ContactId` (`lambdas/connect-health/event.sample.json:5`), and flow-set
  values arrive under `Details.Parameters`.
- Prior art at `.reference/legacy-src/lambda/shared/utils.ts:186` wrote call logs to DynamoDB.
  It predates F-01's no-runtime-AWS-calls decision and is not carried forward.

## What We're NOT Doing

- No dashboard, no alerting, no scheduled reporting. The roadmap caps this item at "an emission
  contract and a destination".
- No instrumentation inside `his/`. Downstream time is measured from the handler side (see
  Phase 2); the mock stays untouched.
- No DynamoDB table, no Kinesis stream, no object store. Deviates from the source thesis §3.3,
  which assigns invocation logs to DynamoDB — recorded as a deliberate deviation below.
- No custom CloudWatch metrics. p95 is computed by query, not emitted as a metric.
- No load generation. PRD §Non-Goals rules out load testing.
- No changes to `his/` or `infra/` package layout. The workspace covers `lambdas/*` only.
- No contact-flow work. Flows are hand-built and uncommitted; the `variant` parameter contract is
  documented here but wired by hand in the console when S-01 needs it.

## Implementation Approach

Three phases, ordered so the risky structural change happens against known behaviour. Phase 1 is
a pure restructuring with no behaviour change — if bundling breaks, it breaks against a handler
whose output you already know. Phase 2 introduces the wrapper and the record. Phase 3 proves the
data answers the questions rather than merely existing.

## Critical Implementation Details

**Deviation from the source thesis, to record in the write-up.** §3.3 assigns invocation logs to
DynamoDB. This plan writes them to CloudWatch Logs instead, because F-01's `natGateways: 0`
decision makes any SDK call in the request path cost either an interface endpoint (~$7.30/mo) or
added latency inside the 2-second p95 budget, and because stdout is the only destination that
behaves identically from VPC-attached and non-VPC handlers. This is the third recorded deviation,
alongside the caller-ID shortcut and two-step slot presentation.

**Retention is a rolling 90-day window per record, and the submission date is unknown** (PRD Open
Question 1). Measurements taken more than three months before the write-up would be gone. Phase 3
therefore includes exporting the final dataset to a committed file, which removes the dependency
on retention entirely.

**The `variant` field cannot be derived by the handler.** It is set by the contact flow and
arrives under `Details.Parameters`. Since flows are hand-built and outside IaC, this is a contract
maintained by hand: every flow's invoke block must pass `variant` as `keypad` or `speech`. A
record whose `variant` is absent is unusable for the A-vs-B comparison, so Phase 3's query reports
the count of records missing it.

## Phase 1: Workspace migration

### Overview

Convert `lambdas/` into an npm workspace so packages can share code, with no change to what the
deployed function does.

### Changes Required:

#### 1. Root workspace manifest

**File**: `package.json` (new, repository root)

**Intent**: Declare `lambdas/*` as workspace members so npm hoists their dependencies and links
siblings by name. `his/` and `infra/` stay outside — both have working builds (a Dockerfile that
copies `his/package*.json`, and CDK's own toolchain) that including them would disturb for no
benefit, since neither shares code with handlers.

**Contract**: `{ "private": true, "workspaces": ["lambdas/*"] }`. Root stays private and publishes
nothing.

#### 2. Collapse the per-lambda lockfile

**File**: `lambdas/connect-health/package-lock.json` (deleted), `package-lock.json` (new, root)

**Intent**: `npm install` at the root produces one lockfile covering every workspace member.

**Contract**: The root lockfile becomes the single `depsLockFilePath` for all handler bundling.

#### 3. Repoint CDK bundling

**File**: `infra/lib/infra-stack.ts`

**Intent**: Move `projectRoot` and `depsLockFilePath` from the single lambda directory to the
repository root so esbuild can resolve workspace siblings. `entry` still points at the specific
handler.

**Contract**: `projectRoot` and `depsLockFilePath` resolve to the repo root; `entry` unchanged at
`lambdas/connect-health/index.ts`. The emitted bundle must remain functionally identical.

### Success Criteria:

#### Automated Verification:

- Root install succeeds and links workspace members: `npm install`
- Handler tests still pass: `npm test --workspace connect-health`
- CDK synthesises: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Infra tests pass: `cd infra && npm test`
- The function bundles without resolution errors during synth

#### Manual Verification:

- The synthesised function asset is functionally unchanged from before the migration

---

## Phase 2: The measure module and its wrapper

### Overview

Introduce the shared package, export `connect-health` through it, and give every handler one
retained log group to write into.

### Changes Required:

#### 1. The shared measurement package

**File**: `lambdas/measure/package.json`, `lambdas/measure/index.ts` (both new)

**Intent**: Provide `measured(name, fn)`, which wraps a handler so that invoking it times the
call, catches a throw, stamps the core fields, and writes one JSON line to stdout. Handlers add
their own fields through a mutable record object the wrapper passes in. Also provide a small
helper that times a downstream call and records its duration.

**Contract**: Package name `@pcm/measure`, `"type": "module"`, `"exports": "./index.ts"` — no
build step, per the type-stripping finding above. The record's fixed core, which every emission
carries:

```ts
type Record = {
  kind: 'invocation';        // marker separating records from other stdout
  ts: string;                // ISO 8601
  handler: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  contactId?: string;        // Details.ContactData.ContactId
  variant?: 'keypad' | 'speech';   // Details.Parameters.variant
  authPath?: 'caller-id' | 'otp' | 'demo';
  downstreamMs?: number;
  [extra: string]: unknown;  // open extension
};
```

`contactId` and `variant` are extracted by the wrapper from the Connect event shape. `authPath` is
supplied by whichever handler resolves authentication (S-03/S-04). A throw sets `outcome: 'error'`
and re-raises — the wrapper records, it does not swallow, so FR-007's transfer-to-agent path still
sees the failure.

#### 2. Export the existing handler through the wrapper

**File**: `lambdas/connect-health/index.ts`, `lambdas/connect-health/package.json`

**Intent**: Wrap the existing handler and time its call to the mock, so the deployed function
begins emitting records. Behaviour visible to the caller stays identical — the same flat string
map comes back.

**Contract**: Declares `@pcm/measure` as a dependency. `handler` remains the exported name and the
returned payload shape is unchanged. `downstreamMs` covers the `fetch` to the mock only.

#### 3. One retained log group for every handler

**File**: `infra/lib/infra-stack.ts`

**Intent**: Replace the per-function log group with a single shared measurement log group at
three-month retention, so one query target covers every handler as slices are added and retention
is set once rather than per function.

**Contract**: A `LogGroup` at `RetentionDays.THREE_MONTHS` with `RemovalPolicy.DESTROY`, passed as
the `logGroup` prop of every function. If Lambda rejects a shared log group at deploy time, fall
back to per-function groups at the same retention and widen Phase 3's query to a name prefix.

### Success Criteria:

#### Automated Verification:

- Wrapper tests pass — core fields present, duration recorded, `outcome: 'error'` on a throw and
  the error re-raised: `npm test --workspace @pcm/measure`
- Handler tests pass and its response shape is unchanged: `npm test --workspace connect-health`
- A handler test asserts one `kind: 'invocation'` line is written per call
- CDK synthesises: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Template asserts the log group retains for 90 days: `cd infra && npm test`

#### Manual Verification:

- `cdk deploy` completes and the function reaches Active
- Invoking with `event.sample.json` returns the same payload as before the change
- A record appears in the shared log group carrying the sample event's contact id
- `downstreamMs` is present and is less than `durationMs`
- Stopping the mock instance produces a record with `outcome` reflecting the failure, not a
  missing record

---

## Phase 3: Query and end-to-end verification

### Overview

Prove the records answer FR-008 and NFR-12, and remove the dependency on log retention.

### Changes Required:

#### 1. Committed queries

**File**: `context/changes/call-measurement-substrate/queries.md` (new)

**Intent**: Two Logs Insights queries, saved so the same ones are used every time rather than
being retyped. The first reconstructs one call; the second produces the headline latency figure
split by variant and reports how many records are missing `variant`, since those are unusable for
the comparison.

**Contract**:

```
fields @timestamp, handler, outcome, durationMs, downstreamMs, variant, authPath
| filter kind = 'invocation' and contactId = 'CONTACT_ID'
| sort @timestamp asc
```

```
filter kind = 'invocation'
| stats count(*) as n,
        pct(durationMs, 95) as p95,
        pct(downstreamMs, 95) as downstreamP95
  by variant
```

#### 2. Dataset export step

**File**: `context/changes/call-measurement-substrate/queries.md`

**Intent**: Record the command that exports query results to a file, and the standing instruction
that the final measurement dataset is committed to the repository once runs complete — so the
thesis does not depend on a 90-day retention window whose end date is unknown.

**Contract**: A documented `aws logs start-query` / `get-query-results` invocation writing JSON to
a path under the change folder.

#### 3. Flow parameter contract

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register `variant` as a load-bearing name that hand-built contact flows must pass, so
the requirement survives outside this plan. Flows are not in IaC and nothing else enforces it.

**Contract**: An entry naming `Details.Parameters.variant` with allowed values `keypad` and
`speech`.

### Success Criteria:

#### Automated Verification:

- Both queries are syntactically valid Logs Insights

#### Manual Verification:

- The reconstruct query returns the invocation from Phase 2 when given its contact id
- The p95 query returns a row with a non-zero count
- Deliberately invoking without a `variant` parameter shows up as its own row with no `variant`
  value, whose `n` is the missing count
- The export command produces a file containing the queried records
- Path taken, outcome and duration are all reconstructable from a single call's records, per
  FR-008

---

## Testing Strategy

### Unit Tests:

- The wrapper stamps every core field on a successful invocation
- The wrapper records `outcome: 'error'` **and re-raises**, so FR-007's transfer path still fires
- `contactId` and `variant` are extracted from a Connect-shaped event, and absent without error
  from a bare invocation
- `downstreamMs` reflects only the downstream call, not total handler time
- Handler-supplied extension fields survive into the emitted record

### Integration Tests:

- Deployed function emits a retrievable record for a real invocation (Phase 2 manual)
- Committed queries return that record (Phase 3 manual)

### Manual Testing Steps:

1. Deploy, invoke with `event.sample.json`, confirm the response is unchanged
2. Find the record in the shared log group by the sample event's contact id
3. Run the reconstruct query with that contact id
4. Run the p95 query and confirm a non-zero count
5. Stop the mock instance, invoke again, confirm a record with a failure outcome
6. Run the export command and confirm a file lands

## Performance Considerations

The wrapper adds a `Date.now()` pair and one `console.log` per invocation — microseconds against a
2000 ms budget. This is the reason stdout was chosen over an SDK write: a DynamoDB or SNS call in
the request path would add network time to the very number being measured, and the measurement
would then partly describe itself.

`downstreamMs` exists specifically to discharge the PRD guardrail that the stand-in must not
dominate measured latency. It measures the mock as seen from the handler, so it includes the hop
between them and cannot separate the mock's own processing from network time — sufficient for the
guardrail's question, which is what share of the request the stand-in consumed.

## Migration Notes

Phase 1 changes no runtime behaviour; if it goes wrong the symptom is a build or synth failure,
not a misbehaving function. Reverting is deleting the root manifest and lockfile and restoring the
two bundling paths in `infra/lib/infra-stack.ts`.

Phase 2 replaces `ConnectHealthLogs` with a shared group. The old group carries no data worth
keeping — nothing has been deployed — so it is dropped rather than migrated.

## References

- Roadmap item F-02: `context/foundation/roadmap.md`
- Inherited inputs: `context/changes/call-measurement-substrate/change.md`
- Prerequisite: `context/changes/aws-deployment-baseline/plan.md` (manual verification unchecked)
- Superseded prior art: `.reference/legacy-src/lambda/shared/utils.ts:186`
- Existing bundling config: `infra/lib/infra-stack.ts:63-70`
- Existing log group: `infra/lib/infra-stack.ts:77-80`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Workspace migration

#### Automated

- [x] 1.1 Root install succeeds and links workspace members — 1c6e7dc
- [x] 1.2 Handler tests still pass — 1c6e7dc
- [x] 1.3 CDK synthesises — 1c6e7dc
- [x] 1.4 Infra tests pass — 1c6e7dc
- [x] 1.5 The function bundles without resolution errors during synth — 1c6e7dc

#### Manual

- [x] 1.6 The synthesised function asset is functionally unchanged from before the migration — 1c6e7dc

### Phase 2: The measure module and its wrapper

#### Automated

- [x] 2.1 Wrapper tests pass — core fields, duration, error outcome and re-raise — a883bb8
- [x] 2.2 Handler tests pass and its response shape is unchanged — a883bb8
- [x] 2.3 A handler test asserts one invocation line is written per call — a883bb8
- [x] 2.4 CDK synthesises — a883bb8
- [x] 2.5 Template asserts the log group retains for 90 days — a883bb8

#### Manual

- [x] 2.6 `cdk deploy` completes and the function reaches Active
- [x] 2.7 Invoking with the sample event returns the same payload as before
- [x] 2.8 A record appears in the shared log group carrying the sample event's contact id
- [x] 2.9 `downstreamMs` is present and less than `durationMs`
- [x] 2.10 Stopping the mock produces a record with a failure outcome, not a missing record

### Phase 3: Query and end-to-end verification

#### Automated

- [x] 3.1 Both queries are syntactically valid Logs Insights

#### Manual

- [x] 3.2 The reconstruct query returns the Phase 2 invocation by contact id
- [x] 3.3 The p95 query returns a row with a non-zero count
- [x] 3.4 Invoking without a `variant` parameter shows up as its own row with no `variant` value, whose `n` is the missing count
- [x] 3.5 The export command produces a file containing the queried records
- [x] 3.6 Path, outcome and duration are reconstructable from one call's records, per FR-008
