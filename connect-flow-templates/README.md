# Connect flow templates

Hand-imported Amazon Connect flow / flow module JSON, committed like any other project file.
Flows are still hand-built in the console per project convention and never deployed by CDK —
only the JSON/Markdown source is version-controlled, not the import step itself.

## Layout

- `flows/` — standalone Contact Flows (imported via Flows → Create flow → Import).
- `modules/` — Contact Flow Modules, reusable sub-flows invoked from a flow (imported via
  Flows → Create flow module → Import).
- `views/` — Amazon Connect Views (step-by-step guides). Never importable JSON the way
  flows/modules are — AWS-managed views are referenced by ARN and configured per-block, and
  customer-managed views use a separate UI Builder tool outside this repo's flow-JSON
  convention. Always hand-merge guides (`.md`), never `.json`.
- `data-tables.md` — schema and content for Amazon Connect Data Tables, hand-built the same way
  as views: no importable JSON format exists for them or for the flow block that reads them
  (S-10).

## Naming

`<variant>-<name>-<flow|module>.json`, matching this project's own `variant` vocabulary
(`keypad` | `speech`, see `docs/reference/contract-surfaces.md` →
`Details.Parameters.variant`):

- `keypad-` — standard IVR / DTMF flows, no Lex bot involved.
- `speech-` — flows that invoke the Lex bot (`SpeechBot` in `infra/lib/infra-stack.ts`).

A doc that isn't itself importable (a hand-merge guide for an existing console flow, say) keeps
the same prefix and lives alongside the flow/module it documents — see
`flows/speech-authintent-fragment.md`.

Locale is not a naming axis: a flow that speaks more than one language is one file, reading
`$.Attributes.locale` (set once by `keypad-language-select-flow.json`) to pick its prompts (via a
Data Table lookup — no Lambda, see `data-tables.md`) and TTS voice at runtime (S-10). There is no
per-locale flow file to name. Each locale-aware flow's `description` field states exactly which
Data Table block to add by hand after import, since that block has no importable JSON form.

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
