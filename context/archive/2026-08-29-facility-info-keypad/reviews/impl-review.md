<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Facility Information By Keypad Implementation Plan

- **Plan**: context/changes/facility-info-keypad/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-08-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — No automated test gate in the deploy pipeline

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; this matches an already-documented plan tradeoff
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/deploy.yml (whole file)
- **Detail**: The deploy pipeline builds, pushes, and restarts the `his` image straight from a push to `main`, with no test step — `his/`'s Facility test suite and `lambdas/facility-info/`'s test suite could be broken and still ship to the deployed instance. This is not an oversight: the plan's own "What We're NOT Doing" explicitly states "Not adding a CI job that runs `his/` or `infra/` tests... this plan does not expand CI scope beyond what S-01 itself needs," consistent with F-01/F-02's established precedent of running Automated Verification locally.
- **Fix**: Accept as documented — this was a deliberate, already-approved scope boundary, not new drift. If you want it now anyway, add an `npm test` step (with `docker compose up -d` for Postgres) ahead of the build/push step in `deploy.yml`.
- **Decision**: ACCEPTED — matches an explicit, already-approved plan decision (What We're NOT Doing); no action taken.

### F2 — First-boot `his` container start failure is silently swallowed

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is a one-line diagnostic breadcrumb
- **Dimension**: Safety & Quality
- **Location**: infra/lib/infra-stack.ts:90
- **Detail**: `docker compose -f /opt/his/docker-compose.yml --env-file /opt/his/.env up -d his || true` on first instance boot swallows any failure to start the app container. This is intentional — on a fresh `cdk deploy`, the `his` image may not exist in ECR yet, and the deploy pipeline starts it later once the image is pushed — but a genuinely broken compose config or first-boot bug would also report UserData success with the app silently never running, leaving no diagnostic trail in `cloud-init-output.log`.
- **Fix**: Replace `|| true` with `|| echo "his did not start on first boot (image likely missing from ECR yet) - the deploy pipeline starts it on first push"` so cloud-init's own log carries a breadcrumb either way.
- **Decision**: FIXED — replaced `|| true` with the diagnostic echo at infra/lib/infra-stack.ts:90-91; infra tests re-verified passing (20/20).

### F3 — `facility.service.spec.ts` is a live-DB integration test with no isolation/teardown

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — nothing to fix now, just worth naming for future slices
- **Dimension**: Pattern Consistency
- **Location**: his/src/facility/facility.service.spec.ts
- **Detail**: Unlike the lambda test suites (which mock `fetch`), this spec hits a real Postgres instance and asserts against the migration's fixed seed row (`id: 1`) with no setup/teardown. This is intentional per the plan's own Testing Strategy ("`his/` test suite runs against a real, migrated Postgres instance (Docker), not a mock repository"), but it's a materially different test strategy from the rest of the suite. Later slices adding more DB-backed tests against the same database/table could hit ordering or isolation issues if this pattern is copied without adding isolation.
- **Fix**: No action needed now — just something to keep in mind when S-03/S-05 add their own tables and tests against the same Postgres instance.
- **Decision**: SKIPPED — not worth fixing now.

## Automated success criteria — re-verified independently

- Phase 1: `his` build ✅, lint ✅, migration:run ✅, `npm test` (2 suites, 3 tests) ✅
- Phase 2: `lambdas/facility-info` `tsc --noEmit` ✅, `npm test` (4 tests) ✅
- Phase 3: `cdk synth` ✅, Connect-permission grep count = 2 ✅, `infra` `npm test` (3 suites, 20 tests) ✅
- Phase 4: no automated criteria (console-only phase, per plan)

## Sub-agent findings summary

**Plan Drift Detection**: no DRIFT, no MISSING, no unexplained EXTRA across all 4 phases. All previously-approved mid-implementation deviations (TypeORM version pin, pre-existing health-check test fix, `facility.service.spec.ts` addition, dev-only port 5433, `userDataCausesReplacement`, dynamic instance-ID lookup, `.gitignore` entry, `workflow_dispatch`) were confirmed carried through consistently. Scope guardrails (no speech variant, no extra tables, no auth, no new CI job, ≤2 contract-surface entries, single-facility model) all respected.

**Safety, Quality & Pattern Compliance**: no CRITICAL findings. Confirmed Postgres has no public/network exposure path (no `ports:` entry on the compose `postgres` service, no security-group ingress beyond the existing function→mock rule on port 3000). Confirmed the `${HIS_IMAGE}` compose template variable is correctly backslash-escaped (resolved by `docker compose --env-file` on the instance, not CDK synth). Confirmed the Lambda's error path never leaks a stack trace or internal detail into the Connect-facing string map. `lambdas/facility-info/` mirrors `lambdas/connect-health/` structurally with no substantive deviation. No L-01/L-02/L-03 violations found.
