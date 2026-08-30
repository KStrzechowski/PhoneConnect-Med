# Facility Information By Keypad Implementation Plan

## Overview

Roadmap item **S-01**, the first vertical slice. A caller presses a key on the main menu, hears
the facility's address and opening hours retrieved through shared business logic (never
hard-coded in the flow), and can reach a human at any point via global commands, a
3-attempts-then-transfer rule, and error-to-transfer. This slice also introduces Postgres into
`his/` — the persistence layer the mock has deferred since F-01 — and sets the safety-behaviour
pattern (global commands, repeat, attempt counting, error transfer) every later slice reuses.

## Current State Analysis

- **`his/` has no persistence at all.** Stock NestJS, one controller, one service, `getHello()`
  and `getHealth()` only (`his/src/app.controller.ts:1`, `his/src/app.service.ts:1`). No ORM, no
  database driver, no facility content anywhere in the repo or in `context/foundation/`.
  `tech-stack.md` already commits the mock to "roughly seven endpoints over Postgres," and the
  archived F-01 plan deferred it here explicitly: "Postgres arrives in S-01, which is the first
  slice that needs it."
- **The Connect-invoked-Lambda pattern is established and worth copying exactly.**
  `lambdas/connect-health/index.ts` wraps its handler in `measured()`/`downstream()` from
  `@pcm/measure`, calls the mock over a `MOCK_BASE_URL` env var with a short `AbortSignal.timeout`,
  and returns a flat string map on both success and failure — Connect rejects nested response
  objects (`context/archive/2026-08-23-aws-deployment-baseline/plan.md:60`). `lambdas/facility-info/`
  should be structurally identical.
- **`measured()` already carries everything F-02 needs from this slice**: it stamps `contactId`,
  reads `variant` from `Details.Parameters` (`lambdas/measure/index.ts:36`), and logs one JSON
  record per invocation. Nothing new is needed here beyond invoking the new Lambda with
  `Details.Parameters.variant = "keypad"` set on the flow's Invoke block, per the existing
  contract surface (`docs/reference/contract-surfaces.md`).
- **No contact flow is ever committed to the repo.** F-01's own plan built and verified a flow
  entirely in the console with no JSON artifact — unlike the throwaway Lex spike, which committed
  one because it needed exact reproducibility across a fixed call matrix. This plan follows F-01's
  precedent: the flow is described in prose here, built by hand in the console.
- **No agent queue exists yet.** `NEXT-STEPS.md` and the roadmap record only the Connect instance
  and the test number. FR-002's "self-staffed queue" needs to exist before Phase 4's manual
  verification — Connect instances ship with a default `BasicQueue`, which is enough.
- **S-10 (English locale, later) requires the shared logic to stay unchanged when a language is
  added.** If the facility's opening hours were stored as a pre-composed Polish sentence, adding
  English would mean changing `his/` or the Lambda — which breaks the exact claim S-10 exists to
  demonstrate. Structured, language-neutral fields avoid this.
- **The deploy pipeline currently runs a single `docker run` in both the instance's user data and
  the CI restart step** (`infra/lib/infra-stack.ts:51`, `.github/workflows/deploy.yml`). Adding
  Postgres means this becomes two containers that need to be orchestrated together.

## Desired End State

A caller dials the test number, is greeted by a main menu, presses the facility-information
digit, and hears the address and opening hours read back — sourced from a Postgres-backed
`his/` endpoint through a dedicated Lambda, not hard-coded anywhere in the flow. From any point in
the call the caller can press the repeat digit and hear the last thing the system said, or press
the agent digit (or exhaust 3 failed attempts, or trigger a downstream error) and be transferred
to the queue without the call dropping. Every invocation of the new Lambda emits a measurement
record carrying `variant: "keypad"`.

Verified by: calling the test number end-to-end and observing the per-call measurement record
for the new handler in the shared log group.

### Key Discoveries:

- `lambdas/connect-health/index.ts:1` — the exact shape to mirror for `facility-info`: `measured()`
  wrapper, `downstream()` timing, flat string map return, handled error on failure.
- `lambdas/measure/index.ts:36` — `variant` is read from `Details.Parameters`, not inferred; the
  flow's Invoke block must set it explicitly, same as any future slice's handler.
- `context/archive/2026-08-23-aws-deployment-baseline/plan.md:76` — "No contact flow… committed."
  is the established convention this plan continues.
- `infra/lib/infra-stack.ts:45-52` — the instance's user data does one `docker run`; Phase 3
  replaces this with compose-based orchestration for two containers.
- `context/foundation/roadmap.md` §S-01 Risk — this slice "carries the safety behaviour… because
  every later slice reuses it rather than rebuilding it," which is why the repeat mechanism is
  built generically now rather than as a one-off loop-back.

## What We're NOT Doing

- **Not building the speech variant.** S-02 reaches the same `his/facility` endpoint through its
  own Lex-fulfillment Lambda later; nothing here builds that.
- **Not modelling doctors, schedules, patients, or appointments.** The `facility` table is the only
  schema this slice adds. S-03/S-05 bring their own tables when they need them.
- **Not building authentication.** Facility information is Access Control Layer 1 — no PESEL, no
  phone number, reachable by any caller.
- **Not adding a CI job that runs `his/` or `infra/` tests.** No such job exists today for either
  package; this plan does not expand CI scope beyond what S-01 itself needs. Automated Verification
  commands below are run locally, matching F-01/F-02's own pattern.
- **Not registering more than one or two contract-surface entries.** Only names that cross the
  console boundary and that nothing in the repo enforces qualify — see Phase 4.
- **Not adding a "press for more" or multi-facility model.** FR-009 is one facility's address and
  opening hours; there is exactly one row.

## Implementation Approach

Four phases, each independently verifiable, in dependency order: the data the answer comes from,
then the handler that serves it, then the infrastructure that deploys both, then the flow that
lets a caller reach it.

`his/` gains a `Facility` entity and one Postgres-backed endpoint. `lambdas/facility-info/` is
`connect-health`'s shape with a different downstream call. `infra-stack.ts` grows a second
container on the existing instance and one more `NodejsFunction`, following the same VPC,
security-group, and Connect-association pattern already in place. The contact flow is designed
in prose here and built in the console, carrying forward the same global-command, attempt-count,
and error-transfer shape every later slice will extend rather than reinvent.

## Critical Implementation Details

**Opening hours are structured data, not a sentence.** Store `opensAt`, `closesAt`, and
`openDays` (e.g. `"08:00"`, `"18:00"`, `"monday-friday"`) as separate fields rather than a
pre-composed Polish string. The contact flow's prompt block composes the sentence in whichever
language it is written in; `his/` and the Lambda never change when S-10 adds English. Getting
this wrong here means revisiting the schema under S-10's own time pressure instead of now, when
there is exactly one field to design.

**The repeat mechanism is a stored-attribute convention, not a per-block loop-back.** Every Play
Prompt in the flow first sets a `lastMessageText` contact attribute to the text it is about to
speak. A single reserved digit, checked at every Get Customer Input block alongside that block's
own valid digits, branches to "speak `$.Attributes.lastMessageText`, then re-enter this same
block" rather than to a hard-coded prompt. This is the one piece of this slice with no code to
show for it — it lives entirely in the console — but it is the mechanism every later slice's menu
must adopt for repeat to keep working, so it is worth stating precisely here rather than
rediscovering per-slice.

## Phase 1: Facility persistence in `his/`

### Overview

Give the mock a real Postgres-backed facility record and an endpoint that returns it as
structured fields.

### Changes Required:

#### 1. TypeORM and Postgres wiring

**File**: `his/package.json`, `his/src/app.module.ts`, `his/src/data-source.ts` (new)

**Intent**: Add TypeORM and `pg` as dependencies, configure a `TypeOrmModule` connection read from
environment variables, and expose a standalone `DataSource` for the migration CLI. `synchronize`
stays `false` — schema changes go through migrations, established from the first table onward.

**Contract**: Connection settings (`host`, `port`, `username`, `password`, `database`) come from
environment variables with local-dev defaults; no secret is hardcoded. `@nestjs/typeorm`'s
standard `forRoot` module registration.

#### 2. Facility entity and migration

**File**: `his/src/facility/facility.entity.ts` (new), `his/src/migrations/*.ts` (new)

**Intent**: One entity, one table, one seeded row — the single facility this PoC models.

**Contract**: `Facility` entity: `id` (PK), `name`, `address`, `opensAt`, `closesAt`, `openDays`
— all `string` columns; no relations. The initial migration creates the table and inserts the one
seed row with placeholder Polish content (a fictional name and address, since none exists in the
repo or the thesis extract). Migrations run via `typeorm-ts-node-commonjs migration:run`, scripted
as `his/package.json`'s `migration:run`.

#### 3. Facility endpoint

**File**: `his/src/facility/facility.controller.ts` (new), `his/src/facility/facility.service.ts`
(new), `his/src/facility/facility.module.ts` (new)

**Intent**: Expose the seeded row over HTTP, in the same controller/service/module shape NestJS's
own CLI scaffolds and `AppModule` already follows.

**Contract**: `GET /facility` returns `{ name, address, opensAt, closesAt, openDays }` as JSON.
No auth — Access Control Layer 1. Registered as a feature module imported by `AppModule`.

#### 4. Local Postgres for dev and test

**File**: `his/docker-compose.yml` (new)

**Intent**: A single `postgres:16-alpine` service so `npm test` and local development have
something to connect to without touching the deployed instance.

**Contract**: One service, a named volume for data, port published to `localhost`. Documented in
Phase 1's manual verification as `docker compose up -d` before running tests or migrations
locally.

### Success Criteria:

#### Automated Verification:

- Mock builds: `cd his && npm run build`
- Mock lints: `cd his && npm run lint`
- Migration runs cleanly against a fresh database: `cd his && npm run migration:run`
- Mock's tests pass against the real dockerized Postgres: `cd his && docker compose up -d && npm run migration:run && npm test`

#### Manual Verification:

- `GET /facility` against a locally running mock returns the seeded name, address, and structured
  hours
- Restarting the local Postgres container and re-running the migration reproduces the same seeded
  row (migration is idempotent or guarded against re-seeding)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 2: `lambdas/facility-info/`

### Overview

A Connect-invoked handler that calls the new endpoint and returns its fields as a flat string
map, structurally identical to `connect-health`.

### Changes Required:

#### 1. Handler

**File**: `lambdas/facility-info/index.ts`, `lambdas/facility-info/package.json`,
`lambdas/facility-info/tsconfig.json`, `lambdas/facility-info/event.sample.json`

**Intent**: Fetch `GET ${MOCK_BASE_URL}/facility`, return its fields verbatim as a flat string
map, and return a handled error shape on failure rather than throwing past the caller — same
contract as `connect-health`.

**Contract**: `measured('facility-info', ...)`, `downstream()` around the fetch, a request timeout
under the function's own timeout. Success shape: `{ reachable: 'true', name, address, opensAt,
closesAt, openDays }`. Failure shape: `{ reachable: 'false', error }`. `package.json` mirrors
`lambdas/connect-health/package.json` (`@pcm/measure` dependency, `node --test` script).

### Success Criteria:

#### Automated Verification:

- Function code typechecks: `cd lambdas/facility-info && npx tsc --noEmit`
- Handler tests pass: `cd lambdas/facility-info && npm test`
- Handler returns only string values at the top level, on both success and failure paths (asserted
  in the test suite, mirroring `lambdas/connect-health/index.test.ts`)

#### Manual Verification:

- Invoking the handler locally against the deployed mock's `/facility` endpoint returns the
  seeded facility data

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 3: Infrastructure — Postgres, the new function, and the deploy pipeline

### Overview

Run Postgres alongside `his/` on the existing instance, deploy the new Lambda, and teach the
pipeline to restart two containers together instead of one.

### Changes Required:

#### 1. Postgres container on the mock instance

**File**: `infra/lib/infra-stack.ts` (user data)

**Intent**: Replace the single `docker run` with a compose-based restart of both `his` and
`postgres:16-alpine`, so the mock's data survives instance stop/start on the existing EBS volume.

**Contract**: User data installs the Docker Compose plugin alongside Docker, and runs
`docker compose up -d` against a compose file placed on the instance (or built inline from user
data — either way, both containers share a Docker network so `his` reaches Postgres by service
name). A named volume persists Postgres data across container restarts and instance stop/start.
No new security group is needed — the link is local to the instance, not over the VPC.

#### 2. Facility-info function resource

**File**: `infra/lib/infra-stack.ts`

**Intent**: Define the new function exactly as `ConnectHealth` is defined, attached to the same
VPC and security group, permissioned for the same Connect instance.

**Contract**: A second `NodejsFunction` pointed at `lambdas/facility-info/index.ts`, same
`vpc`/`vpcSubnets`/`securityGroups`/`logGroup`/`loggingFormat` as `ConnectHealth`, its own
`addPermission` grant and a second `CfnIntegrationAssociation` for the Connect instance.

#### 3. Deploy pipeline: two-container restart and migrations

**File**: `.github/workflows/deploy.yml`

**Intent**: The restart step must bring up both containers via compose and run the migration
against the (possibly just-created) Postgres container before `his` starts serving traffic.

**Contract**: The run-command payload changes from a single `docker run` to a compose-based
restart (pull the new `his` image, `docker compose up -d`), followed by a migration step run
inside the `his` container or as a one-off container using the same image. Ordering matters:
Postgres must be healthy before the migration runs, and the migration must complete before `his`
serves the new schema.

#### 4. Template assertions

**File**: `infra/test/infra.test.ts`

**Intent**: Assert the two properties most likely to regress silently — the new function's
Connect permission, and that the instance's user data still installs Docker.

**Contract**: Extends the existing `Template.fromStack` suite. Asserts a second
`AWS::Lambda::Permission` for `connect.amazonaws.com`, and a second
`AWS::Connect::IntegrationAssociation`, distinguishable from `ConnectHealth`'s by function name.

### Success Criteria:

#### Automated Verification:

- CDK synthesises: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Template grants Connect invoke permission for both functions: `npx cdk synth -c connectInstanceArn=<arn> | grep -c connect.amazonaws.com`
- Infra tests pass: `cd infra && npm test`

#### Manual Verification:

- `cdk deploy` completes and both containers are running on the instance (`docker ps` over Session
  Manager shows `his` and `postgres`)
- The migration has run against the deployed Postgres and `GET /facility` on the instance returns
  the seeded row
- Stopping and starting the instance brings both containers back with the same data
- The new function appears in the telephony console's function list for the instance

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding.

---

## Phase 4: Contact flow, hand-off, and roadmap sync

### Overview

Build the main menu by hand in the console: the facility-information digit, the global commands,
the combined attempt counter, and error-to-transfer. Verify end-to-end with a real call, then
close out the roadmap and contract-surface bookkeeping.

### Changes Required:

#### 1. Main menu contact flow (console, not committed)

**File**: none — Connect console

**Intent**: Greet the caller, offer the facility-information digit, and make the global commands
and safety behaviour reachable from every input point in this flow.

**Contract**: A menu Play Prompt followed by a Get Customer Input block accepting digit `1`
(facility information) and digit `0` (agent), plus the reserved repeat digit (see Critical
Implementation Details) checked at this and every future input block. Before every Play Prompt,
a Set Contact Attributes block writes the spoken text to `lastMessageText`. A single counter
increments on any invalid digit or input timeout at this block; reaching 3 branches to the same
transfer target as pressing `0` directly (FR-006). The block invoking `facility-info` sets
`Details.Parameters.variant = "keypad"` on the Invoke AWS Lambda block, per the existing `variant`
contract surface. The Lambda's error branch (invocation failure) also routes to the transfer
target (FR-007), without disconnecting the call. Transfer target is the default `BasicQueue`,
created by hand if it does not already exist.

#### 2. Roadmap sync

**File**: `context/foundation/roadmap.md`

**Intent**: Reflect that S-01 has shipped.

**Contract**: The `## At a glance` row for `facility-info-keypad` and the `### S-01` body's
`- **Status:**` both move to `done` (via `/10x-archive` at close-out, or `in-progress` now if
archiving happens separately). Frontmatter `updated:` bumped.

#### 3. Contract surfaces

**File**: `docs/reference/contract-surfaces.md`

**Intent**: Register the two names this slice introduces that cross the console boundary with
nothing in the repo enforcing them, so a later slice does not silently redefine them.

**Contract**: An entry for `lastMessageText` (the contact attribute the generic repeat mechanism
depends on — must be set before every Play Prompt in every flow, in every slice, for repeat to
keep working) and an entry for the reserved global digits (`0` = agent, and the repeat digit) —
future menus must not reassign these for menu-specific choices.

### Success Criteria:

#### Automated Verification:

- None — this phase is console configuration and documentation.

#### Manual Verification:

- Calling the test number, pressing the facility digit, hears the seeded address and hours read
  back correctly
- Pressing the repeat digit after any prompt replays exactly what was last said
- Pressing the agent digit, or 3 consecutive invalid/timeout attempts, or a deliberately broken
  Lambda invocation, all reach the same queue without dropping the call
- The measurement log group shows one `facility-info` record per call, carrying `variant: "keypad"`
- `contract-surfaces.md` carries the two new entries
- Roadmap status reflects the shipped slice

**Implementation Note**: This is the final phase; no further pause is needed beyond normal review.

---

## Testing Strategy

### Unit Tests:

- `Facility` entity/service returns the seeded row's fields unchanged
- `facility-info` handler returns a flat string map on success and a handled error shape on
  mock failure, mirroring `connect-health`'s test suite exactly
- `facility-info` handler emits exactly one measurement record per invocation, carrying
  `variant` when present on the event

### Integration Tests:

- `his/` test suite runs against a real, migrated Postgres instance (Docker), not a mock
  repository — this is the one slice cheapest to catch a migration or query bug in, before more
  tables exist
- Infra snapshot assertions: both functions carry Connect invoke permission and integration
  association

### Manual Testing Steps:

1. Call the test number, press the facility digit, and confirm the spoken answer matches the
   seeded database row exactly
2. Press the repeat digit after the facility answer and confirm it replays verbatim
3. Trigger 3 invalid keypresses in a row and confirm transfer to the queue
4. Trigger a timeout (no input) mixed with an invalid keypress and confirm they share one counter
5. Stop the mock instance's `his` container to force a Lambda error and confirm the flow
   transfers to the queue rather than dropping the call

## Performance Considerations

The mock's new endpoint is a single-row lookup with no joins — it should not meaningfully affect
the p95 latency baseline `connect-health` already established. Record the new handler's
`downstreamMs` from its first real invocations as a reference point, the same way F-01 recorded
`connect-health`'s round-trip duration.

## Migration Notes

Greenfield within `his/` — no existing data to migrate. This is, however, the schema's first
migration ever; keep it minimal (one table, one seed row) so later slices' own migrations
(patients, doctors, appointments) each add exactly one concern rather than reopening this one.

## References

- Roadmap item: `context/foundation/roadmap.md` → `### S-01`
- PRD refs: FR-009, US-02, FR-001, FR-002, FR-003, FR-006, FR-007, FR-008
- Pattern to mirror: `lambdas/connect-health/index.ts`, `lambdas/connect-health/index.test.ts`
- Measurement contract already in place: `lambdas/measure/index.ts`
- `variant` contract surface: `docs/reference/contract-surfaces.md`
- Contact-flow-not-committed precedent: `context/archive/2026-08-23-aws-deployment-baseline/plan.md`
  ("What We're NOT Doing")
- Deferred-Postgres decision: `context/archive/2026-08-23-aws-deployment-baseline/plan.md`
  ("What We're NOT Doing"), `context/foundation/tech-stack.md`
- Code standards this plan must respect: `context/foundation/lessons.md` (L-01, L-02, L-03)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Facility persistence in `his/`

#### Automated

- [x] 1.1 Mock builds — 4d1e756
- [x] 1.2 Mock lints — 4d1e756
- [x] 1.3 Migration runs cleanly against a fresh database — 4d1e756
- [x] 1.4 Mock's tests pass against the real dockerized Postgres — 4d1e756

#### Manual

- [x] 1.5 `GET /facility` returns the seeded name, address, and structured hours — 4d1e756
- [x] 1.6 Migration is idempotent across a Postgres restart — 4d1e756

### Phase 2: `lambdas/facility-info/`

#### Automated

- [x] 2.1 Function code typechecks — 3a906f8
- [x] 2.2 Handler tests pass — 3a906f8
- [x] 2.3 Handler returns only string values at the top level, on both paths — 3a906f8

#### Manual

- [x] 2.4 Handler invoked locally against the deployed mock returns the seeded data — 3a906f8

### Phase 3: Infrastructure — Postgres, the new function, and the deploy pipeline

#### Automated

- [x] 3.1 CDK synthesises — c296e8a
- [x] 3.2 Template grants Connect invoke permission for both functions — c296e8a
- [x] 3.3 Infra tests pass — c296e8a

#### Manual

- [x] 3.4 `cdk deploy` completes; both containers running on the instance
- [x] 3.5 Migration has run; `GET /facility` on the instance returns the seeded row
- [x] 3.6 Stop/start brings both containers back with the same data
- [x] 3.7 The new function appears in the telephony console's function list

### Phase 4: Contact flow, hand-off, and roadmap sync

#### Manual

- [x] 4.1 Facility digit reads back the seeded address and hours correctly
- [x] 4.2 Repeat digit replays exactly what was last said
- [x] 4.3 Agent digit, 3 failed attempts, and a broken Lambda invocation all reach the queue without dropping the call
- [x] 4.4 Measurement log shows one `facility-info` record per call, carrying `variant: "keypad"`
- [x] 4.5 `contract-surfaces.md` carries the two new entries
- [x] 4.6 Roadmap status reflects the shipped slice
