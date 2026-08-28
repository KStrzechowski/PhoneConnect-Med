# AWS Deployment Baseline — Plan Brief

> Full plan: `context/changes/aws-deployment-baseline/plan.md`

## What & Why

Make one deployed round trip real: a telephony-invoked function that reaches the deployed mock
medical system, all described in infrastructure-as-code. This is roadmap item **F-01** — the
only item with no prerequisites, and the head of the chain that leads to the north star (booking
in both variants). Nothing user-facing can be built or verified until a deployed round trip
exists.

## Starting Point

Nothing is deployed. `InfraStack` is empty (`infra/lib/infra-stack.ts:5`) and environment-agnostic
(`infra/bin/infra.ts:6`). `lambdas/` is empty. The mock is stock NestJS returning `'Hello World!'`
with no Dockerfile. There is no CI directory, no registry, no database. Outside the repository, a
telephony instance and test number already exist, created by hand.

## Desired End State

`cdk deploy` from a clean checkout provisions a network, an instance running the mock in a
container, and a function attached to that network. Invoking the function with a telephony-shaped
event returns a payload that demonstrably came from the mock. Pushing to `main` rebuilds and
redeploys the mock without anyone opening a terminal.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Mock hosting | `t3.micro`, Docker, public subnet | Always-on avoids cold start inside the 2-second budget; x86 removes any cross-architecture build concern | Plan |
| Database | None in F-01 | Progressive disclosure — Postgres arrives in S-01, the first slice that needs it | Plan |
| Function networking | Attached to the VPC, `natGateways: 0` | VPC attachment is free; the mock's port stays closed to the internet at no extra cost | Plan |
| Runtime AWS calls | None from the function | A single SSM or Secrets call would force a ~$7.30/mo interface endpoint | Plan |
| Human access | Session Manager, no SSH | Zero inbound ports, no key pair, and immune to the public IP changing on stop/start | Plan |
| Elastic IP | None | AWS bills Elastic IPs even while detached from a stopped instance | Plan |
| Image delivery | CI builds, publishes to a registry, restarts via run-command | Author asked for a real pipeline rather than building on the instance | Plan |
| Function scope | Telephony-shaped handler calling the mock's health endpoint | Proves the round trip and pins the flat-string-map response contract early | Plan |
| Log retention | Two weeks | Default is never-expire, which bills indefinitely | Plan |

## Scope

**In scope:** VPC and security groups; `t3.micro` running the mock in a container; a
telephony-invoked function attached to the VPC; a container registry; an OIDC role and CI
workflow; invoke permission for the existing telephony instance.

**Out of scope:** any database; contact flows (hand-built, uncommitted); facility-information
logic (S-01); the language-understanding bot (F-03, S-02); measurement and per-call records
(F-02); TLS on the mock; SSH; load balancing, autoscaling, multi-AZ.

## Architecture / Approach

One VPC, one public subnet, no NAT gateway. The instance sits in the public subnet with a public
IP so it can reach the registry, package registries and the management service over the Internet
Gateway — all free egress. Its security group opens **no inbound ports**; the mock's port admits
traffic only from the function's security group, and human access is outbound-initiated via
Session Manager. The function attaches to the same VPC and receives the mock's address as a
deploy-time environment variable, which is what keeps it free of runtime AWS API calls and
therefore free of paid interface endpoints.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Network and mock instance | VPC, instance, mock running in a container | `ec2.Vpc` defaults to NAT gateways — ~$33/mo if left unset |
| 2. Function and the round trip | Function in the VPC returning the mock's payload | Telephony rejects nested response objects; must be a flat string map |
| 3. Build and deploy pipeline | Push to `main` rebuilds and redeploys | Run-command fails against a stopped instance unless the workflow starts it first |
| 4. Telephony invoke permission | The hand-built flow can call the function | No native construct for the association; may need a custom resource or a console step |

**Prerequisites:** `aws login` — the CLI session is currently expired. The telephony instance and
test number must already exist (they do). Repository must be able to create an OIDC identity
provider in the account.

**Estimated effort:** Phases 1-2 are the F-01 Outcome; 3-4 are additive. Phase 3 is the one that
could reasonably be split into its own change if the week tightens.

## Open Risks & Assumptions

- **Phase 3 is scope expansion.** The roadmap capped F-01 to "one function and the mock, deployed
  and reachable," warning against letting it become an infrastructure project. The pipeline was
  requested deliberately and `tech-stack.md` already declared CI, but it is the first candidate
  to cut if the week tightens.
- **Two documents now contradict the pipeline decision** and need amending: PRD `## Non-Goals`
  and the roadmap's `## Parked` both rule out an automated delivery pipeline. The PRD has
  contradicted `tech-stack.md` on this point since before planning began.
- **A VPC-attached function idle for 14 days fails its next invocation** before recovering. With
  an intermittent working pattern this makes the first call before a demonstration likely to
  fail. Warm it before any demo.
- **Deploying by pipeline means "reproducible" is qualified**: infrastructure is reproducible from
  the repository, and the application is pinned by image tag — but contact flows remain outside
  IaC entirely.
- **`t3` defaults to unlimited burst mode.** Load is far too low to trigger charges, but it is not
  a hard cap.

## Success Criteria (Summary)

- A single `cdk deploy` from a clean checkout produces a working round trip, and `cdk destroy`
  removes it.
- Invoking the function with a telephony-shaped event returns a payload that came from the mock,
  as a flat map of strings.
- A commit touching the mock reaches the running instance with no manual step, even when the
  instance was stopped.
