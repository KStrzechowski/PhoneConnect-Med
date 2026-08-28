---
change_id: call-measurement-substrate
title: Call measurement substrate
status: archived
created: 2026-08-23
updated: 2026-08-29
archived_at: 2026-08-28T22:59:43Z
---

## Notes

Roadmap item **F-02**. Scope cap from the roadmap: an emission contract and a destination,
not a dashboard and not a reporting layer.

**Inputs carried in from the S-04 discussion (2026-08-23):**

- **The per-call record must carry which authentication path was taken** — caller-ID shortcut,
  real one-time code, or demo test account. Without it, demo sessions cannot be excluded from
  absolute handling-time figures and every number in the write-up is contaminated by whoever
  poked at the system that week. See the roadmap's S-04 "Demo affordance" note.
- **Handlers will sit in two different network positions.** The pair-verification handler is
  VPC-attached to reach the mock over its private IP; the message-sending handler must stay
  outside the VPC, because F-01 chose `natGateways: 0` with no interface endpoints. The emission
  contract has to work identically from both — which argues for writing to stdout and letting the
  log service collect it, over any destination requiring an SDK call. An SDK call works from one
  position and silently fails from the other.

**F-01 status when this was planned:** all automated steps landed, **every manual verification
step still unchecked** — `cdk deploy` has not been run. This change builds on a baseline that
synthesises but has never been deployed.
