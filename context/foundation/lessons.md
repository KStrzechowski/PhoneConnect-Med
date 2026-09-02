# Lessons

Standing rules and recurring pitfalls for this project. Read by `/10x-implement`,
`/10x-tdd`, `/10x-impl-review` and `/10x-plan` before they write or judge code.

Each entry states the rule, why it exists, and how to apply it.

---

## L-01: Comments are rare and load-bearing — ask before adding one

**Rule.** Do not comment code by default. A file with no comments is the expected
outcome, not an omission. When a comment does seem warranted, **ask first** and
explain what it would say — do not add it unilaterally.

**Why.** Comment density is the single loudest tell of generated code, and it is
also just bad practice: a comment that restates the code adds a second thing that
can drift out of date, and it trains the reader to skim. Code that needs a comment
to be understood usually needs a better name or a smaller function instead. Asking
first keeps the author in control of every line of prose that ships in their own
thesis artefact.

**How to apply.**

Never write:

- Comments that restate the statement below them (`// increment the counter`,
  `// return the result`, `// import dependencies`).
- Banner or section-divider comments (`// ===== Helpers =====`, `// --- Types ---`).
- Docblocks on every function, or on any function whose name and signature already
  say what it does.
- File-header summaries describing what the module contains.
- `// TODO` / `// FIXME` left as filler. If it is real work, it goes in the plan's
  Progress table or the roadmap, not in a comment.
- Commented-out code. Delete it; git has it.
- Step narration inside a function (`// 1. validate`, `// 2. fetch`, `// 3. map`).
  If a function needs numbered steps, extract them into named functions.

A comment is justified — and worth asking about — only when it records something
the code genuinely cannot:

- A **why** that contradicts what the code appears to do (a workaround for a
  platform bug, an intentional inefficiency, an ordering constraint).
- A **deviation from the source thesis**, so the write-up can trace it. These are
  valuable and should be proposed, not suppressed.
- A **reference** that grounds a magic value in an external spec, table, or
  requirement ID.

When in doubt: rename the thing, extract the function, or ask. Do not comment.

---

## L-02: Write it the way a person writing it once would

**Rule.** Prefer the plain, direct construction over the complete, symmetrical,
defensively-general one. Do not add structure the current requirement does not
need.

**Why.** Generated code reads as generated because it is uniformly thorough:
every function gets the same shape, every value gets a named constant, every layer
gets an interface, every error gets caught and re-wrapped. Real codebases are
uneven — they are elaborate where the problem is hard and blunt where it is not.
That unevenness is also cheaper to read and cheaper to change. On a one-week
after-hours build, ceremony is the thing most likely to eat the week.

**How to apply.**

- **No speculative abstraction.** No interface with one implementation, no factory
  for a plain object, no generic type parameter used once, no strategy pattern for
  two branches. Introduce the seam when the second caller actually arrives.
- **No layer padding.** This project's mock is roughly seven endpoints. It does not
  need controller → service → repository → mapper → DTO for each one. Add a layer
  when it earns its keep.
- **No defensive noise.** Do not guard against states the types already exclude.
  Do not wrap every call in `try/catch` to re-throw a reworded error. Let errors
  propagate to the one place that handles them — for this project, that is the
  transfer-to-agent path FR-007 describes.
- **Constants only when reused or genuinely opaque.** A value used once, in the
  place it means something, can be a literal.
- **Names as short as clarity allows.** `bookSlot`, not
  `handleAppointmentSlotBookingRequest`. Avoid `data`, `result`, `response`,
  `payload`, `item` as the actual name of a thing that has a real name.
- **Asymmetry is fine.** Two similar functions do not have to be refactored into
  one parameterised function, and three sibling modules do not have to have
  identical internal structure.
- **No barrel files** re-exporting everything, unless something actually consumes
  the barrel.
- **No emoji** in code, log output, console messages, or commit messages.
- **Tests assert behaviour, not shape.** Do not generate a test per method for
  coverage's sake; test the rule the code exists to enforce.

Existing rules this reinforces: identifiers, comments and commit messages are
English-only (Polish survives only in what the caller hears
and in seed data); commit messages stay short and are approved before they
are made.

---

## L-03: Both variants must reach identical business logic

**Rule.** The keypad variant and the natural-language variant may differ only in
how input is collected. Every decision, lookup, filter, and slot resolution happens
in the shared layer both call.

**Why.** This is the PRD's hardest guardrail and the whole comparison rests on it.
Any domain logic that leaks into one variant's contact flow — mapping a pressed
digit back to a date, filtering slots, deciding what to say next — silently makes
the two variants different systems, and every measurement taken afterwards
describes that difference rather than the hypothesis.

**How to apply.** When a contact flow needs to make a choice, it does not. It passes
what it collected to the shared layer and renders what comes back. If implementing a
variant requires putting a conditional in the flow, that conditional belongs in the
shared layer instead. See the roadmap's S-05 Risk note for the concrete case:
resolving "the caller pressed 2" into an actual date must happen in the shared
layer, never in the flow.

---

## L-04: Named AWS resources get an explicit name

**Rule.** Every `NodejsFunction` and `iam.Role` in `infra/lib/infra-stack.ts` gets an
explicit `functionName` / `roleName`, prefixed `phoneconnect-med-`, kebab-case. Do
not leave CloudFormation to auto-generate the physical name.

**Why.** An auto-generated name (stack name + logical ID + a hash suffix, e.g.
`PhoneConnect-Med-InfraStack-Authenticate8F3C2A1B-AbCdEfGh123`) is what you have to
pick out of a dropdown when wiring a hand-built Connect flow to the right Lambda —
there is no way to tell two functions apart at a glance. User decision, prompted by
exactly that friction while wiring `connect-flow-templates/flows/keypad-authenticate-flow.json`.

**How to apply.**

- New `NodejsFunction`: `functionName: 'phoneconnect-med-<kebab-case-purpose>'`.
- New `iam.Role`: `roleName: 'phoneconnect-med-<kebab-case-purpose>'`.
- Known tradeoff, accepted: some Lambda property changes force a replace rather
  than an in-place update, and CloudFormation can't fall back to a fresh
  auto-generated name to dodge the collision when the name is fixed — a redeploy
  that needs a replacement can fail where an auto-named function would have
  quietly succeeded. Acceptable here: single-environment stack, not deployed
  twice in parallel.
- IAM role names must be unique per **account**, not just per stack — reuse the
  prefix, but do not reuse the same full name across two different roles.
