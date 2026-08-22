---
bootstrapped_at: 2026-08-22T00:00:00Z
starter_id: nestjs
starter_name: NestJS
project_name: phoneconnect-med
language_family: js
package_manager: npm
cwd_strategy: user-directed-subdir (deviation from the v1 default `subdir-then-move` — see Scaffold log)
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: npm audit --json
---

# Bootstrap verification — PhoneConnect Med

## Hand-off

Source: `context/foundation/tech-stack.md`. Frontmatter verbatim:

```yaml
starter_id: nestjs
package_manager: npm
project_name: phoneconnect-med
hints:
  language_family: js
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack (verbatim from the hand-off body)

PhoneConnect Med is a one-week, after-hours thesis experiment comparing a keypad menu against
natural-language understanding over the phone, so this decision covers only the parts that are
ordinary application code — the telephony platform and its language understanding are fixed by
the thesis, not chosen here. The shared business logic both variants call is plain typed handler
functions deployed by TypeScript infrastructure-as-code, with no web framework: one would add
cold-start mass inside the 2-second p95 the PRD requires and route requests nobody routes.
NestJS covers the single piece that is a real server — the stand-in medical system, a headless
API of roughly seven endpoints over Postgres, running as a Docker container on a small
always-on instance in the telephony platform's region. Solo work, a one-week clock, and the PRD
guardrail that both variants must reach identical business logic made typed and
convention-based choices non-negotiable; NestJS clears all four agent-friendly gates, carries
the strongest conventions of the candidate set, scaffolds controllers, services and tests from
its own CLI, and is bootstrapper-verified. Layout is three folders: handlers, infrastructure,
and the mock. Budget is roughly a hundred dollars of platform credits, nearly all consumed by
telephony and speech recognition.

## Pre-scaffold verification

| Signal | Value | Severity | Notes |
| --- | --- | --- | --- |
| npm package | `@nestjs/cli` v11.0.24 published 2026-07-10 | fresh | resolved from `cmd_template` (`npx @nestjs/cli new ...`) |
| GitHub repo | not run | n/a | card `docs_url` is `https://docs.nestjs.com`, not a GitHub URL — no recency signal available |

No stale signal. Proceeded without a heads-up.

## Scaffold log

**Resolved invocation**: `npx --yes @nestjs/cli new his -p npm --strict --skip-git`

**Strategy**: user-directed subdirectory — **deviation from the v1 default**

**Exit code**: 0

**Files written by CLI**: 15 source/config files, plus `node_modules/`

**Conflicts (.scaffold siblings)**: none — `his/` did not exist prior to the run

**.gitignore handling**: the CLI emitted no `.gitignore` (suppressed by `--skip-git`). The repo-root `.gitignore` already ignores `node_modules` (line 34) and `dist` (line 69), so the scaffolded tree is covered.

**.bootstrap-scaffold cleanup**: n/a — no temp directory was used

### Deviation from the documented v1 mechanic

The v1 contract scaffolds into the current working directory and never uses `project_name` as a
directory name (`scaffold-merge.md` § Substitution rules). The user explicitly directed a
three-folder repo layout instead — `lambdas/`, `infra/`, `his/` — with the NestJS mock owning
`his/` rather than the repo root. `{name}` was therefore substituted as `his`, the CLI created
that directory itself, and no move-up or conflict matrix was needed.

Rationale for honouring it: putting NestJS at the repo root would have given the mock ownership
of the root `package.json` and `tsconfig.json`, colliding with the CDK app that will later live
in `infra/`. Because `his/` was a fresh directory, the conflict matrix had nothing to resolve and
`context/` was untouched by construction — the safety properties the matrix exists to guarantee
held trivially.

### Files created

```
his/.eslintrc.js
his/.prettierrc
his/nest-cli.json
his/package.json
his/package-lock.json
his/README.md
his/tsconfig.json
his/tsconfig.build.json
his/src/main.ts
his/src/app.module.ts
his/src/app.controller.ts
his/src/app.controller.spec.ts
his/src/app.service.ts
his/test/app.e2e-spec.ts
his/test/jest-e2e.json
```

## Post-scaffold audit

**Tool**: `npm audit --json`, run from `his/`

**Summary**: 0 CRITICAL, 6 HIGH, 12 MODERATE, 3 LOW (21 total)

**Dependency tree**: 730 packages (123 prod, 608 dev, 4 optional, 10 peer)

**Direct vs transitive**: 0 CRITICAL / 2 HIGH / 4 MODERATE / 0 LOW are direct dependencies, of
totals 0 / 6 / 12 / 3. Direct findings: `@nestjs/cli` (high), `@nestjs/platform-express` (high),
`@nestjs/common`, `@nestjs/core`, `@nestjs/schematics`, `@nestjs/testing` (moderate).

The audit tool's exit code is informational only; the scaffold was not halted.

### CRITICAL findings

None.

### HIGH findings

- **`@nestjs/cli`** — range `2.0.0-rc.1 - 11.0.16 || >=12.0.0-alpha.0`. Direct. Fix available (non-major). Via `@angular-devkit/core`, `@angular-devkit/schematics`, `@angular-devkit/schematics-cli`, `@nestjs/schematics`, `glob`, `inquirer`, `webpack`. Dev-only toolchain.
- **`@nestjs/platform-express`** — range `<=11.1.14 || 12.0.0-alpha.0 - 12.0.0-alpha.2`. Direct. Fix: `@nestjs/platform-express@11.2.1` (**semver-major**). Via `@nestjs/core`, `body-parser`, `express`, `multer`. Production path.
- **`glob`** — range `10.2.0 - 10.4.5`. Transitive (effects `@nestjs/cli`). Fix available. Command injection via `-c` / `--cmd` executing matches with `shell:true` (GHSA-5j98-mcp5-4vw2).
- **`multer`** — range `<=2.1.1`. Transitive (effects `@nestjs/platform-express`). Fix: `@nestjs/platform-express@11.2.1` (semver-major). Five denial-of-service advisories: incomplete cleanup (GHSA-xf7r-hgr6-v32p), resource exhaustion (GHSA-v52c-386h-88mc), uncontrolled recursion (GHSA-5528-5vmv-3xc2), deeply nested field names (GHSA-72gw-mp4g-v24j), incomplete cleanup of aborted uploads (GHSA-3p4h-7m6x-2hcm).
- **`picomatch`** — range `4.0.0 - 4.0.3`. Transitive (effects `@angular-devkit/core`). Fix: `@nestjs/schematics@11.1.0` (semver-major). Method injection in POSIX character classes (GHSA-3v7f-55p6-f55p); ReDoS via extglob quantifiers (GHSA-c2c7-rcm5-vvqj).
- **`tmp`** — range `<=0.2.5`. Transitive (effects `external-editor`). Fix available. Arbitrary temporary file/directory write via symlink `dir` parameter (GHSA-52f5-9888-hmc6); path traversal via unsanitized prefix/postfix (GHSA-ph9p-34f9-6g65).

### MODERATE findings

- **`@nestjs/core`** — `<=11.1.17`. Direct. Fix: `@nestjs/core@11.2.1` (semver-major). Improper neutralization of special elements in downstream output — injection (GHSA-36xv-jgw5-4q75).
- **`@nestjs/common`** — `10.4.16 - 10.4.22 || 11.0.16 - 11.1.16 || 12.0.0-alpha.0 - 12.0.0-alpha.2`. Direct. Fix available. Via `file-type`.
- **`@nestjs/schematics`** — `8.0.0 - 11.0.9`. Direct. Fix: `@nestjs/schematics@11.1.0` (semver-major). Via `@angular-devkit/*`.
- **`@nestjs/testing`** — `<=11.0.0-next.4`. Direct. Fix: `@nestjs/testing@11.2.1` (semver-major). Via `@nestjs/core`, `@nestjs/platform-express`.
- **`@angular-devkit/core`** — multiple ranges. Transitive. Fix: `@nestjs/schematics@11.1.0` (semver-major). Via `ajv`, `picomatch`.
- **`@angular-devkit/schematics`** — multiple ranges. Transitive. Fix available.
- **`@angular-devkit/schematics-cli`** — multiple ranges. Transitive. Fix available.
- **`ajv`** — `7.0.0-alpha.0 - 8.17.1`. Transitive. ReDoS when using the `$data` option (GHSA-2g4f-4pwh-qvx6).
- **`body-parser`** — `<=1.20.5 || 2.0.0-beta.1 - 2.0.2`. Transitive. Denial of service when an invalid limit value silently disables size enforcement (GHSA-v422-hmwv-36x6); also via `qs`.
- **`express`** — `4.21.0 - 4.22.1 || 5.0.0-alpha.1 - 5.0.1`. Transitive. Via `qs`.
- **`qs`** — `6.11.1 - 6.15.1`. Transitive. Remotely triggerable denial of service: `qs.stringify` crashes on null/undefined entries in comma-format arrays when `encodeValuesOnly` is set (GHSA-q8mj-m7cp-5q26).
- **`file-type`** — `13.0.0 - 21.3.1`. Transitive. Infinite loop in the ASF parser on malformed input (GHSA-5v7r-6r5c-r473); ZIP decompression-bomb denial of service (GHSA-j47w-4g3g-c36v).

### LOW / INFO findings

- **`external-editor`** — `>=1.1.1`. Transitive via `tmp`. Fix available. Dev-only.
- **`inquirer`** — `3.0.0 - 8.2.6 || 9.0.0 - 9.3.7`. Transitive via `external-editor`. Fix available. Dev-only.
- **`webpack`** — `5.49.0 - 5.104.0`. Transitive. Fix available. `buildHttp` allowedUris allow-list bypass via URL userinfo, leading to build-time SSRF (GHSA-8fgc-7cc6-rx7x); allowedUris bypass via HTTP redirects (GHSA-38r7-794h-5758). Dev-only, and `buildHttp` is not enabled by the default NestJS build.

### Remediation applied — all 21 findings cleared

At the user's direction ("I don't want any issues"), the findings were remediated rather than
left for later. No `npm audit fix` was used; the cause was addressed directly.

**Root cause**: `@nestjs/cli` v11.0.24 scaffolded a project template pinned to **NestJS 10**.
Every one of the 21 advisories was downstream of starting a major version behind. This is why
npm labelled four fixes "semver-major" — the package ranges read `^10.0.0`, so any v11 release
falls outside them.

```
                          before      after
@nestjs/common            10.4.22  →  11.2.1
@nestjs/core              10.4.22  →  11.2.1
@nestjs/platform-express  10.4.22  →  11.2.1
@nestjs/cli               10.4.9   →  11.0.24
@nestjs/schematics        10.2.3   →  11.1.0
@nestjs/testing           10.4.22  →  11.2.1
```

All six had to be upgraded in a single `npm install` invocation — NestJS enforces peer
dependencies in lock-step, so upgrading the runtime and the tooling separately fails `ERESOLVE`.
Result: 44 packages added, 70 removed, 46 changed; tree down from 730 to 704 packages.

**Post-remediation audit**: `found 0 vulnerabilities`. 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW.

**Verification that the major upgrade broke nothing** (the scaffold carried no custom code, so
the risk was minimal, but NestJS 11 moves to Express 5 — a genuine breaking change):

| Check | Command | Result |
| --- | --- | --- |
| Build | `npm run build` | clean, no output |
| Unit test | `npm test` | 1 passed, 1 total |
| E2E test | `npm run test:e2e` | 1 passed, 1 total — exercises the Express 5 path via supertest |
| Lint | `npm run lint` | clean, no findings |

`dependencies` / `devDependencies` placement was checked after the upgrade and is unchanged —
npm updated each package in place rather than relocating it.

## Second scaffold — `infra/` (AWS CDK)

Run after the NestJS scaffold, at the user's request, to fill the `infra/` slot of the directed
three-folder layout. This is outside the bootstrapper hand-off — the tech-stack-selector registry
carries no CDK card (it is a registry of application-framework starters: web, api, mobile,
desktop, cli). Recorded here so the audit trail stays complete.

**Pre-scaffold recency**: `aws-cdk` v2.1138.0 published 2026-08-19 — fresh (3 days).

**Resolved invocation**: `npx --yes aws-cdk@latest init app --language typescript`, run from `infra/`

**Exit code**: 0

**Note on directory state**: `cdk init` refuses to run in a non-empty directory, which is why the
CDK app could not have shared the repo root with the NestJS mock. `infra/` was created empty
immediately before the run.

**`.git` handling**: `cdk init` did not create a `.git/` — it detected the enclosing repository.
No upstream history leaked.

### Files created

```
infra/.gitignore
infra/.npmignore
infra/cdk.json
infra/jest.config.js
infra/package.json
infra/package-lock.json
infra/README.md
infra/tsconfig.json
infra/bin/infra.ts
infra/lib/infra-stack.ts
infra/test/infra.test.ts
```

### Audit and verification

| Check | Command | Result |
| --- | --- | --- |
| Audit | `npm audit` | **0 vulnerabilities** |
| Build | `npm run build` (`tsc`) | clean |
| Test | `npm test` | 1 passed, 1 total |
| Synth | `npx cdk synth` | emits CloudFormation successfully |

`cdk synth` was run deliberately rather than assumed: `npm install` reported three packages whose
postinstall scripts were blocked by npm's `allow-scripts` policy — `esbuild@0.28.2`,
`@swc/core@1.16.1`, `unrs-resolver@1.12.2`. Those scripts fetch platform-specific native
binaries, so a blocked postinstall can surface as a broken toolchain at synth time rather than at
install time. Synth succeeded, so the blocked scripts are not load-bearing for this project.

**`infra/.gitignore`** ignores `*.js`, `*.d.ts` (compiled output, with `!jest.config.js`
excepted), `node_modules`, `.cdk.staging`, and `cdk.out`. No merge with the repo-root
`.gitignore` was needed — it lives inside `infra/` and applies there.

## Hints recorded but not acted on

| Hint | Value |
| --- | --- |
| bootstrapper_confidence | verified |
| quality_override | false |
| path_taken | custom |
| self_check_answers | null |
| team_size | solo |
| deployment_target | self-host |
| ci_provider | github-actions |
| ci_default_flow | auto-deploy-on-merge |
| has_auth | true |
| has_payments | false |
| has_realtime | false |
| has_ai | true |
| has_background_jobs | false |

`deployment_target: self-host` is the registry's closest bucket for "an instance the user
administers" — concretely an AWS Lightsail or EC2 box in the Connect region, per the hand-off
body. It is neither a managed PaaS nor a local machine. v1 generated no Dockerfile and no
deployment configuration for it.

`ci_provider: github-actions` and `ci_default_flow: auto-deploy-on-merge` were recorded, but no
CI workflow was generated — v1 does not scaffold CI. Note also that the PRD lists "automated
delivery pipeline" under its non-functional non-goals.

`has_auth: true` (PESEL + phone-number pair, per-call session) and `has_ai: true` (free-speech
intent and parameter extraction, on a thesis-fixed platform) were recorded but did not change
the scaffold. No auth module and no AI SDK were installed.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is
scaffolded and verified — happy hacking.

Standard close-out items, all already satisfied on this run:

- `git init` — the repo already has history.
- Review `.scaffold` siblings — none were created.
- Address audit findings — done; both trees report 0 vulnerabilities.

### Current repo state

```
PhoneConnect Med/
├─ context/          preserved untouched throughout
├─ his/              NestJS 11 mock medical system — build, unit, e2e, lint green; 0 vulns
├─ infra/            AWS CDK v2 TypeScript app — build, test, synth green; 0 vulns
└─ lambdas/          not yet created
```

### Remaining, in rough order

- **Create `lambdas/`** for the plain typed handler functions. Per the hand-off these carry no
  web framework, so there is nothing to scaffold — the CDK app in `infra/` bundles them. It was
  deliberately not created as an empty directory: git does not track empty directories, so it
  would vanish on the next commit. It appears naturally with the first handler file.
- **Decide how `his/` reaches Postgres.** The hand-off names Postgres, but the NestJS scaffold
  ships no database layer — no TypeORM, no Prisma, no driver.
- **Write the `infra/` stack.** `lib/infra-stack.ts` is the empty default. It needs the Lambda
  functions, and the Lightsail or EC2 instance that hosts the `his/` container.
- **Add a Dockerfile for `his/`.** The hand-off calls for a container on an always-on instance;
  bootstrapper v1 generates no deployment artifacts.
- **Two npm projects, no workspace.** `his/` and `infra/` each carry their own `package.json` and
  `node_modules`. That is workable and keeps their dependency trees independent, but there is no
  root-level workspace tying them together — worth a deliberate decision if `lambdas/` ends up
  sharing types with either.
