# AWS Deployment Baseline Implementation Plan

## Overview

Make one deployed round trip real: a telephony-invoked function that reaches the deployed mock
medical system, described in infrastructure-as-code so it can be torn down and recreated, plus
a pipeline that gets application changes onto the instance without manual steps.

This is roadmap item **F-01** (`aws-deployment-baseline`). Its job is to unblock S-01 and to
establish the verification path every later slice uses to check itself end to end.

## Current State Analysis

Nothing is deployed. The repository was scaffolded but no infrastructure exists.

- `infra/lib/infra-stack.ts:5` — `InfraStack` is empty; the constructor body is the generated
  comment and a commented-out SQS example.
- `infra/bin/infra.ts:6` — `env` is commented out, so the stack is environment-agnostic. Context
  lookups and any account-specific association will not work until this is bound.
- `lambdas/` exists and is **empty**. No function code at all.
- `his/src/app.controller.ts:8` — the mock is stock NestJS returning `'Hello World!'` from
  `his/src/app.service.ts:5`. No health endpoint, no Dockerfile, no `.dockerignore`.
- No `.github/` directory — no workflow, no OIDC role, no registry.
- No database anywhere, by design (deferred to S-01).

Environment facts established during research:

- Configured region is `eu-central-1`. Amazon Connect, Lex V2 and the `pl_PL` locale are all
  available there; the locale region-exclusions apply only to `ap-southeast-1` and
  `ap-south-1`.
- The AWS CLI session is **expired** — `aws login` is required before any deploy.
- The telephony instance and a test number already exist, created by hand
  (`NEXT-STEPS.md` steps 6, 6a, 6b). They are **not** managed by this stack.
- Local toolchain: Node 24.18.0, npm 11.16.0, CDK 2.1138.0, `aws-cdk-lib` 2.265.0. Docker is
  installed locally but its daemon is not running — irrelevant now that builds happen in CI.
- Budget is roughly $100 of credits, most of it earmarked for telephony and speech recognition
  (`context/foundation/tech-stack.md`).

## Desired End State

A `cdk deploy` from a clean checkout provisions a VPC, an instance running the mock in a
container, and a function attached to that VPC. Invoking the function with a telephony-shaped
event returns a payload that demonstrably came from the mock. Pushing to `main` rebuilds the
mock's image, publishes it, and restarts the container on the instance without anyone opening a
terminal.

Verify by: `cdk deploy` completing green, then invoking the function with the sample event in
`lambdas/connect-health/event.sample.json` and observing the mock's service identifier in the
response.

### Key Discoveries:

- **VPC attachment for a function is free.** Hyperplane ENIs carry no charge, and stdout reaches
  the log service over the Lambda-managed path rather than the customer VPC — so basic logging
  works with no NAT gateway and no interface endpoint. The $0 result holds **only while the
  function makes no outbound AWS API calls**; a single SSM or Secrets Manager call at runtime
  would require a ~$7.30/mo interface endpoint.
- **`ec2.Vpc` creates NAT gateways by default.** Left unset this silently adds ~$33/mo — more
  than every other resource here combined.
- **A telephony-invoked function must return a flat map of string key-values.** Nested objects
  are rejected at runtime. Pinning this now is most of the reason the function calls the mock at
  all rather than returning a constant.
- **Public IPv4 addresses are billable, and Elastic IPs bill even while detached** from a
  stopped instance. Since the instance will be stopped between sessions, no Elastic IP is
  allocated and no inbound access is configured.
- **Private IP survives stop/start**, so the function's target address stays valid across the
  intended workflow.
- **`his`'s runtime dependencies are pure JavaScript** (`@nestjs/common`, `@nestjs/core`,
  `@nestjs/platform-express`, `reflect-metadata`, `rxjs`). No native addons, so the image has no
  architecture-sensitive content beyond the Node base image itself.

## What We're NOT Doing

- **No database.** The mock answers from a constant. Postgres arrives in S-01, which is the first
  slice that needs it (`context/foundation/lessons.md` L-02, progressive disclosure).
- **No contact flow.** Flows are hand-built in the console by the author and deliberately not
  committed. This stack stops at making the function invocable.
- **No facility-information logic.** That is S-01's work and it needs the deferred database.
- **No Lex bot, no intents, no speech.** Those belong to F-03 and S-02.
- **No measurement or per-call records.** That is F-02.
- **No TLS on the mock's endpoint.** Traffic is inside the VPC and the payload is a constant.
- **No SSH, no key pair, no bastion.** Access is via Session Manager.
- **No autoscaling, no load balancer, no multi-AZ.** One instance, one subnet.

## Implementation Approach

Four phases, each independently verifiable. Phases 1 and 2 together satisfy F-01's stated
Outcome; Phase 3 is the pipeline the author asked for; Phase 4 connects the function to the
existing telephony instance.

Network shape: a single VPC with one public subnet and `natGateways: 0`. The instance sits in
the public subnet with a public IP so it can reach the registry, the package registries and the
management service over the Internet Gateway — all free egress paths. Its security group opens
**no inbound ports at all**; the mock's port is reachable only from the function's security
group, and human access is via Session Manager, which is outbound-initiated.

The function is attached to the same VPC and receives the mock's address as a deploy-time
environment variable resolved from the instance's private IP. This is what keeps it free of
runtime AWS API calls and therefore free of interface endpoints.

## Critical Implementation Details

**Timing & lifecycle.** A VPC-attached function that goes 14 days without an invocation has its
Hyperplane ENI reclaimed and enters `Inactive`; the next invocation **fails**, and only the one
after it succeeds. Combined with the intended stop-the-instance-between-sessions workflow, this
means the first call before a demonstration or defence is likely to fail. Warm the function
before any live demonstration, and record this in the write-up as a property of the deployment
rather than a defect. Separately, creating the ENI on first deploy leaves the function in
`Pending` for several minutes — a first `cdk deploy` that appears to hang is usually this.

**State sequencing.** The pipeline's restart step targets a *running* instance. When the
instance is stopped, `SendCommand` fails rather than queuing. Phase 3 must start the instance
and wait for it to register with the management service before issuing the command, otherwise
every push made while the instance is stopped reports a red build for a reason unrelated to the
code.

## Phase 1: Network and mock instance

### Overview

Provision the VPC, the instance, and get the mock running in a container on it. At the end of
this phase the mock answers requests from inside the VPC and nothing else can reach it.

### Changes Required:

#### 1. Bind the CDK environment

**File**: `infra/bin/infra.ts`

**Intent**: The stack is environment-agnostic, which prevents the account-specific association in
Phase 4 and any context lookup. Bind it explicitly.

**Contract**: `env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' }`. Region
is hardcoded rather than taken from the environment because the telephony instance already
exists in that region and a mismatch would fail confusingly. Remove the generated comment block.

#### 2. Network and instance

**File**: `infra/lib/infra-stack.ts`

**Intent**: Replace the empty stack with the VPC, security groups, instance role and instance.
This is the bulk of the phase.

**Contract**: One `ec2.Vpc` with `natGateways: 0` and a single `PUBLIC` subnet configuration.
Two security groups: one for the function with no ingress, one for the mock whose only ingress
rule permits the mock's port from the function's group. An instance role carrying
`AmazonSSMManagedInstanceCore` and registry pull permission. A `t3.micro` instance on Amazon
Linux 2023 in the public subnet, `associatePublicIpAddress: true`, no key pair.

The `natGateways: 0` value is load-bearing — the default is one gateway per availability zone.

#### 3. Instance bootstrap

**File**: `infra/lib/infra-stack.ts` (user data)

**Intent**: Install and enable the container runtime on first boot, and start the mock if an
image is already published. On a first-ever deploy no image exists yet, so this must not fail
the boot.

**Contract**: User data installs Docker, enables it at boot, authenticates to the registry, and
attempts to pull and run the image with a restart policy. A failed pull exits zero. Note that
user data does **not** re-run on stack update — Phase 3's pipeline owns all subsequent deploys.

#### 4. Health endpoint on the mock

**File**: `his/src/app.controller.ts`

**Intent**: Give the mock a response that identifies it unambiguously, so the round trip in
Phase 2 proves the payload came from the mock rather than from the function.

**Contract**: `GET /health` returning a small object containing a service identifier. Keep the
existing root route untouched.

#### 5. Container image definition

**File**: `his/Dockerfile`, `his/.dockerignore`

**Intent**: Package the mock. Multi-stage purely to keep the runtime image small — with an x86
instance there is no architecture concern.

**Contract**: Build stage installs dependencies, compiles, then prunes to production
dependencies. Runtime stage copies `dist/` and `node_modules` onto a slim Node base and runs
`node dist/main`. `.dockerignore` excludes `node_modules`, `dist`, `test` and `.git`.

### Success Criteria:

#### Automated Verification:

- CDK synthesises: `cd infra && npx cdk synth`
- Synthesised template contains no NAT gateway: `npx cdk synth | grep -c AWS::EC2::NatGateway` returns 0
- Mock builds and its tests pass: `cd his && npm run build && npm test`
- Mock lints: `cd his && npm run lint`
- Image builds: `cd his && docker build -t his:local .`

#### Manual Verification:

- `cdk deploy` completes without error
- Session Manager connects to the instance from the console with no key pair
- From the instance, the mock's health endpoint responds
- The mock's port is not reachable from the public internet
- Stopping and starting the instance leaves the private IP unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Function and the round trip

### Overview

Add the telephony-invoked function, attach it to the VPC, and have it return the mock's payload.
This phase is what F-01's Outcome actually claims.

### Changes Required:

#### 1. Function handler

**File**: `lambdas/connect-health/index.ts`, `lambdas/connect-health/package.json`,
`lambdas/connect-health/event.sample.json`

**Intent**: A handler that accepts a telephony event, calls the mock's health endpoint, and
returns the result in the shape the telephony platform requires.

**Contract**: The return value **must be a flat map of string key-values** — nested objects are
rejected at runtime, which is the single most valuable thing this phase pins down. The mock's
base URL arrives via the `MOCK_BASE_URL` environment variable; the handler makes **no AWS API
calls**, which is what keeps the VPC attachment free of interface endpoints. A request timeout
shorter than the function timeout so a hung mock surfaces as a handled error rather than a
function timeout. `event.sample.json` holds a representative telephony event for testing.

#### 2. Function resource

**File**: `infra/lib/infra-stack.ts`

**Intent**: Define the function, attach it to the VPC, and wire its address to the instance.

**Contract**: A `NodejsFunction` in the VPC's public subnet using the function security group,
with `MOCK_BASE_URL` built from `instance.instancePrivateIp`. Log group retention of two weeks —
the default is never-expire, which bills indefinitely. Timeout comfortably under the 2-second
response budget the requirements impose, so a slow mock fails fast rather than eating it.

### Success Criteria:

#### Automated Verification:

- CDK synthesises: `cd infra && npx cdk synth`
- Function code typechecks: `cd lambdas/connect-health && npx tsc --noEmit`
- Infra tests pass: `cd infra && npm test`

#### Manual Verification:

- `cdk deploy` completes and the function reaches `Active` state
- Invoking the function with `event.sample.json` returns the mock's service identifier
- The response contains only string values at the top level
- The function's log group shows the invocation, confirming logging works with no NAT or endpoint
- Stopping the instance makes the function return a handled error rather than timing out

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Build and deploy pipeline

### Overview

Push to `main` builds the mock's image, publishes it, and restarts the container on the
instance. Replaces every manual deploy step for application code.

Note this phase contradicts the PRD's `## Non-Goals` entry ruling out an automated delivery
pipeline; see "Migration Notes" for the documents that need amending.

### Changes Required:

#### 1. Registry and pipeline identity

**File**: `infra/lib/infra-stack.ts`

**Intent**: Somewhere to publish images, and a way for the workflow to authenticate without
long-lived credentials.

**Contract**: A container registry repository with a lifecycle rule retaining a small number of
recent images, so storage does not grow unbounded. An OIDC provider for the CI host and a role
whose trust policy is scoped to **this repository and the `main` branch specifically** — an
unscoped trust policy would let any repository assume it. The role may push to the registry and
issue run-commands against this one instance; nothing broader.

#### 2. Workflow

**File**: `.github/workflows/deploy.yml`

**Intent**: The pipeline itself.

**Contract**: Triggered on push to `main` limited to paths under `his/`. Steps: assume the role
via OIDC, build and push the image tagged with the commit SHA and `latest`, start the instance
and **wait for it to register with the management service**, then issue a run-command that pulls
and restarts the container, then poll the command to completion so a failed restart fails the
build. Requires `id-token: write` permission. The instance-start-and-wait step is not optional —
without it, every push made while the instance is stopped fails for an unrelated reason.

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML: `npx --yes yaml-lint .github/workflows/deploy.yml`
- CDK synthesises: `cd infra && npx cdk synth`
- Trust policy is branch-scoped: `cd infra && npx cdk synth | grep 'repo:KStrzechowski/PhoneConnect-Med:ref:refs/heads/main'`

#### Manual Verification:

- A commit touching `his/` triggers the workflow and it completes green
- A new image tagged with that commit SHA appears in the registry
- The change is live on the instance afterwards, confirmed through the function
- A push made while the instance is stopped still succeeds, having started it first
- A deliberately broken build fails the workflow rather than reporting success

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Telephony invoke permission

### Overview

Allow the existing telephony instance to invoke the function, so a hand-built contact flow can
call it.

### Changes Required:

#### 1. Invoke permission and association

**File**: `infra/lib/infra-stack.ts`

**Intent**: The telephony instance was created by hand and is not managed by this stack, so its
identifier is an input rather than a resource. Grant it permission to invoke the function and
register the function with it.

**Contract**: The telephony instance ARN comes from CDK context (`connectInstanceArn`) so no
identifier is hardcoded in the repository. A resource-based permission allowing the telephony
service principal to invoke, with the source ARN narrowed to that instance. The association
itself has no native construct and needs a custom resource; if that proves awkward, associating
in the console is acceptable and consistent with flows already being hand-built — record which
was used.

### Success Criteria:

#### Automated Verification:

- CDK synthesises with the context value: `cd infra && npx cdk synth -c connectInstanceArn=<arn>`
- Synthesised template grants invoke to the telephony service principal: `npx cdk synth -c connectInstanceArn=<arn> | grep connect.amazonaws.com`

#### Manual Verification:

- The function appears in the telephony console's function list for the instance
- A contact flow's invoke block can select the function
- A test invocation from a flow returns the mock's payload
- Removing the context value fails the synth with a clear message rather than deploying something broken

---

## Testing Strategy

### Unit Tests:

- Mock's health endpoint returns the expected service identifier
- Function handler returns a flat string map given a representative telephony event
- Function handler returns a handled error, not a throw, when the mock is unreachable

### Integration Tests:

- Infra snapshot assertion: no NAT gateway, log retention set, trust policy branch-scoped

### Manual Testing Steps:

1. Deploy from a clean checkout and confirm the mock answers from inside the VPC
2. Invoke the function with the sample event and confirm the payload came from the mock
3. Confirm the mock's port is unreachable from the public internet
4. Stop the instance, push a change, and confirm the pipeline starts it and deploys
5. Leave the function idle and confirm the `Inactive` behaviour is understood before any demo
6. Tear the stack down with `cdk destroy` and redeploy, confirming reproducibility

## Performance Considerations

The mock sits inside the measured request path, and the requirements state it must not dominate
latency. A `t3.micro` running one small container has ample headroom for a single caller, but
this phase establishes the baseline against which later slices are measured — record the
function's round-trip duration from its logs once Phase 2 lands, so there is a reference point
before any real work is added.

`t3` instances default to unlimited burst mode, which can bill for sustained CPU. Load here is
far too low to trigger it, but it is worth knowing the default is not a hard cap.

## Migration Notes

Nothing to migrate — this is greenfield. Two documents contradict the pipeline decision and need
amending so the write-up does not claim something the repository disproves:

- `context/foundation/prd.md` — `## Non-Goals` rules out an automated delivery pipeline. It also
  conflicts with `context/foundation/tech-stack.md`, which already declared
  `ci_provider: github-actions` and `ci_default_flow: auto-deploy-on-merge`. The contradiction
  predates this plan.
- `context/foundation/roadmap.md` — `## Parked` carries the same entry.

## References

- Roadmap item: `context/foundation/roadmap.md` → `### F-01`
- Stack decisions: `context/foundation/tech-stack.md`
- Code standards this plan must respect: `context/foundation/lessons.md` (L-01, L-02)
- Current empty stack: `infra/lib/infra-stack.ts:5`
- Unbound environment: `infra/bin/infra.ts:6`
- Mock's current controller: `his/src/app.controller.ts:8`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Network and mock instance

#### Automated

- [x] 1.1 CDK synthesises — b9df546
- [x] 1.2 Synthesised template contains no NAT gateway — b9df546
- [x] 1.3 Mock builds and its tests pass — b9df546
- [x] 1.4 Mock lints — b9df546
- [x] 1.5 Image builds — b9df546

#### Manual

- [ ] 1.6 `cdk deploy` completes without error
- [ ] 1.7 Session Manager connects with no key pair
- [ ] 1.8 Mock's health endpoint responds from the instance
- [ ] 1.9 Mock's port is not reachable from the public internet
- [ ] 1.10 Stop/start leaves the private IP unchanged

### Phase 2: Function and the round trip

#### Automated

- [x] 2.1 CDK synthesises — 34dcbc6
- [x] 2.2 Function code typechecks — 34dcbc6
- [x] 2.3 Infra tests pass — 34dcbc6

#### Manual

- [ ] 2.4 `cdk deploy` completes and the function reaches Active
- [ ] 2.5 Invoking with the sample event returns the mock's service identifier
- [ ] 2.6 Response contains only string values at the top level
- [ ] 2.7 Log group shows the invocation with no NAT or endpoint
- [ ] 2.8 Stopped instance produces a handled error, not a timeout

### Phase 3: Build and deploy pipeline

#### Automated

- [x] 3.1 Workflow file is valid YAML — 05319d1
- [x] 3.2 CDK synthesises — 05319d1
- [x] 3.3 Trust policy is branch-scoped — 05319d1

#### Manual

- [ ] 3.4 Commit touching `his/` triggers a green workflow
- [ ] 3.5 Image tagged with the commit SHA appears in the registry
- [ ] 3.6 Change is live on the instance, confirmed through the function
- [ ] 3.7 Push while stopped starts the instance first and succeeds
- [ ] 3.8 A deliberately broken build fails the workflow

### Phase 4: Telephony invoke permission

#### Automated

- [x] 4.1 CDK synthesises with the context value — 32cd788
- [x] 4.2 Template grants invoke to the telephony service principal — 32cd788

#### Manual

- [ ] 4.3 Function appears in the telephony console's function list
- [ ] 4.4 A contact flow's invoke block can select the function
- [ ] 4.5 Test invocation from a flow returns the mock's payload
- [ ] 4.6 Missing context value fails synth with a clear message
