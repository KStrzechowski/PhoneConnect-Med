# Call Measurement Substrate — Plan Brief

> Full plan: `context/changes/call-measurement-substrate/plan.md`

## What & Why

Roadmap item **F-02**. Every handler invocation emits one structured record — path, outcome,
duration, downstream duration — to a destination that survives the thesis timeline. It exists
ahead of any user-facing slice because the PRD requires latency to be recorded "from that moment
on, so handling-time data accumulates from the first slice rather than being retrofitted at the
end". Data gathered before a retrofit would not be comparable with data gathered after it.

## Starting Point

One handler exists (`lambdas/connect-health/`), self-contained with its own lockfile, bundled from
a `projectRoot` pinned to its own directory — so nothing can share code with it yet. It makes no
runtime AWS calls by design, because F-01 chose `natGateways: 0` with no interface endpoints. Its
log group expires after two weeks. The mock has no logging at all. Nothing is deployed: F-01's
automated steps all landed, but every manual step is unchecked and `cdk deploy` has never run.

## Desired End State

A handler cannot run without emitting a record, because handlers are exported through a wrapper
that times and stamps them. All handlers write to one log group retained three months. Two
committed queries reconstruct a single call and produce p95 latency split by keypad vs speech.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Destination | Structured JSON to stdout → CloudWatch Logs | Zero network calls, so it behaves identically from VPC-attached and non-VPC handlers, and adds nothing to the latency it measures | Plan |
| Granularity | One line per invocation | Nothing to accumulate or flush; an abandoned call still leaves everything that happened before it | Plan |
| Enforcement | Shared wrapper at the entry point | Measurement is structurally part of being a handler, so a later slice cannot silently skip it | Plan |
| Packaging | npm workspace over `lambdas/*` | Sibling imports by name, one lockfile; `his/` and `infra/` left untouched | Plan |
| Mock timing | Handler times its own downstream call | One clock, no skew, no instrumentation in the mock — answers the guardrail's actual question | Plan |
| Retention | Three months, plus a committed export | Two weeks would delete the evidence before the write-up; the export removes the dependency entirely | Plan |
| Record contract | Fixed core, open extension | Comparison fields guaranteed present everywhere; slices enrich without a contract change | Plan |
| Done when | Emission plus a committed query | Proves the data is queryable, not merely written | Plan |
| Auth-path field | Required in the core | Lets demo-account sessions be excluded from absolute figures | S-04 discussion |

## Scope

**In scope:** the workspace migration; a shared `@pcm/measure` package with the wrapper and record
contract; the existing handler exported through it; one shared log group at three-month retention;
two committed Logs Insights queries; a dataset export step; registering `variant` as a contract
surface.

**Out of scope:** dashboards, alerting, scheduled reporting; instrumentation inside the mock;
DynamoDB, Kinesis or object storage; custom metrics; load generation; any change to `his/` or
`infra/` packaging; contact-flow work.

## Architecture / Approach

`measured(name, fn)` wraps a handler: it times the call, catches and re-raises a throw, extracts
contact id and variant from the Connect event, and writes one JSON line to stdout. The Lambda
service delivers that line to CloudWatch Logs out-of-band — no VPC ENI, no SDK call — which is
what lets one contract serve both VPC-attached handlers and the non-VPC ones S-04 will need.
Every function points at the same log group, so one query covers every handler as slices are
added.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Workspace migration | `lambdas/*` as workspace members, bundling repointed | Changes bundling on a stack never yet deploy-verified |
| 2. Measure module and wrapper | Records flowing from the deployed function; retention set | A shared log group across functions may be rejected at deploy |
| 3. Query and verification | Committed queries, export step, `variant` registered | Records may exist but not answer the question — which is what this phase is for |

**Prerequisites:** F-01 actually deployed. Phase 1 is safe regardless, but Phases 2-3 have manual
steps that need a running stack, and F-01's manual verification is entirely unchecked.

**Estimated effort:** One session. Phase 1 is mechanical, Phase 2 is the substance, Phase 3 is
verification.

## Open Risks & Assumptions

- **F-01 has never been deployed.** This plan builds on a baseline that synthesises but is
  unproven end-to-end. Phase 2's manual steps will surface any F-01 problem as though it were an
  F-02 problem.
- **Retention is a rolling 90-day window and the submission date is unknown** (PRD Open Question
  1). Mitigated by the export step, which is the reason it is in scope.
- **`variant` is set by hand-built contact flows**, which are outside IaC. Nothing enforces it at
  deploy time; the p95 query reports how many records are missing it so the gap is visible rather
  than silent.
- **Deviates from the source thesis §3.3**, which assigns invocation logs to DynamoDB. Recorded
  deliberately — the third such deviation, alongside the caller-ID shortcut and the two-step slot
  presentation.
- **A shared log group across several functions is assumed to work.** Fallback is per-function
  groups at the same retention with a prefix-scoped query.

## Success Criteria (Summary)

- Invoking the deployed function produces a record that the committed query returns.
- Path taken, outcome and duration are reconstructable for a single call from its records.
- p95 latency is computable split by variant, with the count of unusable records visible.
