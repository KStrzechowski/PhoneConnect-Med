# Next Steps — PhoneConnect Med

Where the project stands and what to do next. Update the Status column as you go.

**Right now:** run `/10x-prd`. In parallel, start the AWS account setup (step 5) and the test
corpus collection (step 7) — both have external lead time and neither depends on code.

---

## Done

| # | Step | What it produced |
|---|---|---|
| 1 | Extract requirements from the thesis PDF | `context/foundation/source-requirements.md` |
| 2 | `/10x-init` | `context/{changes,archive,foundation}/` |
| 3 | `/10x-shape` | `context/foundation/shape-notes.md` — 16 FRs, quality check accepted |

## Do next

| # | Step | Action | Status | Notes |
|---|---|---|---|---|
| 4 | Baseline commit | `git add -A && git commit` | ✅ | Nothing is in git yet. Commit before `/10x-prd` so you can diff what it writes. |
| 5 | AWS account setup | Console | ✅ | Upgrade to Paid Plan — credits are **safe**. Set a $50 budget alert. **Never join an AWS Organization**: it force-upgrades and forfeits remaining credits. |
| 6 | AWS: Connect + number | Console | ✅ | Create the Connect instance and claim a test number. Longest external lead time — start early. Release the number when done. |
| 6a | Check dial-in cost | Operator app | ✅ | Calling the number comes off your **personal phone bill, not AWS credits**. At a few hundred test calls this is the difference between free and meaningfully expensive — check before committing. |
| 6b | Confirm the claim completes | Console | ✅ | Numbers in many countries need proof of local address / registered entity. Availability in the console ≠ a completed claim. |
| 7 | Freeze the elicitation kit | `git commit` | ✅ | `context/foundation/test-corpus-kit.md`. **This** is what must predate the Lex sample utterances — commit it before writing any. |
| 7a | Recruit ~5 participants | People | ✅ | Line them up now; availability is a schedule risk. The session itself happens after the bot is built. |
| 7b | Collect the corpus | ~5 people | ✅ | **After** the bot exists. ~90 Polish utterances, cards read verbatim from the frozen kit. See shape-notes `## Measurement protocol`. |
| 8 | Verify Tabela 3.1 | Read PDF p. 41–42 | ✅ | Last six rows are column-shifted in the text layer; slot names in the digest are a reconstruction. They end up in code — check them. |
| 9 | Write the PRD | `/10x-prd` | ✅ | Reads `shape-notes.md`, writes `context/foundation/prd.md`. |
| 10 | Pick the stack | `/10x-tech-stack-selector` | ✅ | Mostly a rubber-stamp — thesis §2.4 fixes AWS. Genuinely open: whether DynamoDB earns its place, and the scheduling app's stack (unconstrained). |
| 11 | Scaffold the repo | `/10x-bootstrapper` | ✅ | `his/` (NestJS 11) + `infra/` (CDK). Both 0 vulns. See `context/changes/bootstrap-verification/`. |
| 12 | Slice the work | `/10x-roadmap` | ⬜ | Optional. Slices are already implied: facility info → auth → booking. |
| 13 | Build each slice | `/10x-new` → `/10x-plan` → `/10x-implement` | ⬜ | Repeat per slice. |

## Build order (once coding starts)

| Slice | Why this order |
|---|---|
| A. Facility info, **both variants**, end to end | Walking skeleton. Proves Connect + Lex + Lambda + mock are wired on both paths, and gets CloudWatch measuring from day one. Explicitly **not** evidence for the hypothesis — DTMF will likely win on a one-keypress task. |
| B. Authentication | PESEL by DTMF keypad in **both** variants (Lex V2 DTMF slot input in Wariant B), so identity capture can't confound the comparison. Verify Lex DTMF slot behaviour early — it's load-bearing. |
| C. Booking | **Where the hypothesis is actually tested** — one utterance vs. four DTMF steps. Measure turns-to-completion, not just elapsed time. |
| D. List / cancel / reschedule | Cheap breadth — the Lambda layer is shared, so each is one Lambda + one menu branch + one intent. |
| E. English locale | Demonstrates the §2.1 multilingualism claim. Measured by **implementation cost**, not intent accuracy. |
| F. Agent write access (FR-017) | First thing to drop if the week runs short — nothing measured depends on it. |

## Thesis write-up decisions (not blocking the build)

| # | Decision | Status |
|---|---|---|
| W1 | Fill in the thesis submission date | ⬜ |
| W2 | Define Wariant A's analogue for "intent accuracy" — DTMF has no intent recognition. Defensible answer: task-completion + misnavigation rate over the same scenario set. | ⬜ |
| W3 | Define the multilingualism metric — Contact Flow blocks/prompts duplicated (A) vs. Lex artefacts added (B), shared Lambda shown unchanged. | ⬜ |
| W4 | Note the anglicised Lex slot names as a deviation from Tabela 3.1 | ⬜ |
| W5 | Note deviations already recorded: caller-ID OTP shortcut (§3.2), two-step slot presentation (§3.2.1), FR-004 satisfied by the auth flow | ⬜ |
| W6 | State the test-corpus limitation: ~5 acquaintances are a convenience sample, skewing younger/more technical — makes accuracy optimistic | ⬜ |

## Standing rules

- **Code is English-only** — including domain nouns (`wizyta` → `appointment`). Only PESEL
  stays Polish. Glossary in `shape-notes.md` → `## Forward: conventions`.
- **Polish is content, not code** — sample utterances, TTS prompts, on-screen text, seed data.
- **Both variants must reach identical business logic.** Any divergence in the shared Lambda
  layer invalidates the A-vs-B comparison.
- **Train/test separation** — never measure accuracy on utterances used as Lex samples.
- **A caller must always be able to reach a human.** Three attempts, then transfer.
