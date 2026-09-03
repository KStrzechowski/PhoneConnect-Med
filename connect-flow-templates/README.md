# Connect flow templates

Hand-imported Amazon Connect flow / flow module JSON, committed like any other project file.
Flows are still hand-built in the console per project convention and never deployed by CDK —
only the JSON/Markdown source is version-controlled, not the import step itself.

## Layout

- `flows/` — standalone Contact Flows (imported via Flows → Create flow → Import).
- `modules/` — Contact Flow Modules, reusable sub-flows invoked from a flow (imported via
  Flows → Create flow module → Import).

## Naming

`<variant>-<name>-<flow|module>.json`, matching this project's own `variant` vocabulary
(`keypad` | `speech`, see `docs/reference/contract-surfaces.md` →
`Details.Parameters.variant`):

- `keypad-` — standard IVR / DTMF flows, no Lex bot involved.
- `speech-` — flows that invoke the Lex bot (`SpeechBot` in `infra/lib/infra-stack.ts`).

A doc that isn't itself importable (a hand-merge guide for an existing console flow, say) keeps
the same prefix and lives alongside the flow/module it documents — see
`flows/speech-authintent-fragment.md`.

## Real ARNs (`REPLACE_WITH_*` placeholders)

Every ARN specific to a deployed resource (Lambda function, Contact Flow Module, Lex bot alias,
queue) is a `REPLACE_WITH_*` placeholder in the committed JSON, never the real value — this repo
is a public thesis artifact, and an AWS account ID is account-identifying info worth not
publishing when there's no reason to.

To get real, importable flows locally:

1. Create `fill-arns.local.json` in this directory (gitignored) — a flat map of placeholder name
   to real ARN, e.g. `{ "REPLACE_WITH_AUTHENTICATE_FUNCTION_ARN": "arn:aws:lambda:..." }`.
2. Run `node fill-arns.mjs` from this directory. It writes filled copies to `filled/` (gitignored),
   one per source file that had a placeholder it knew how to fill.
3. Import from `filled/`, not from `flows/`/`modules/` directly.

You only need entries for the placeholders you're about to import — the script leaves any
placeholder without a matching key untouched (and skips writing a `filled/` copy for a file with
nothing to fill).
