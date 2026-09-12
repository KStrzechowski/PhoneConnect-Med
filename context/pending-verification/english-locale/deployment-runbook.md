# Deployment runbook (S-10, english-locale)

Everything needed to get English keypad support fully live, in order. Steps marked **(script)**
are automated by personal helpers kept in a sibling directory, `../pcm-connect-tools/`, entirely
outside this repo — not gitignored files inside it, an actually separate directory, so this repo
never touches `@aws-sdk/client-connect` or its `node_modules` at all. Everything else is a manual
console step, consistent with this project's standing "flows are hand-built, not codified"
convention — the scripts push JSON/rows via the same public API the console's own UI uses, they
don't add a new IaC layer.

One-time setup for the scripts:

```
cd ../pcm-connect-tools
npm install
```

## 1. AWS credentials

The scripts need whatever credentials `cdk deploy` already uses (default AWS SDK credential
chain). Check you have them:

```
aws sts get-caller-identity
```

If that fails and you've only ever used the AWS Console in a browser:

- **IAM Identity Center / SSO** (most likely if your org uses federated login):
  `aws configure sso`, then `aws sso login --profile <name>` before each session,
  `export AWS_PROFILE=<name>`.
- **IAM user with access keys**: `aws configure`, paste an access key/secret from
  IAM → Users → your user → Security credentials → Create access key.

Either way, the identity needs `connect:ListContactFlows`, `connect:CreateContactFlow`,
`connect:UpdateContactFlowContent`, and the Data Table equivalents
(`connect:ListDataTables`, `connect:CreateDataTable`, `connect:CreateDataTableAttribute`,
`connect:ListDataTableAttributes`, `connect:BatchCreateDataTableValue`) on your instance — the
same permissions your Connect admin console session already has, if you can do these things by
hand today.

## 2. Deploy the updated Booking Lambda

```
cd infra
cdk deploy -c connectInstanceArn=<your instance arn>
```

Only `lambdas/booking/index.ts` changed code-wise (the `locale` branch, Phase 1) — same function,
same ARN, so nothing downstream needs updating for this step alone.

## 3. Create and fill the four Data Tables **(script)**

```
node ../pcm-connect-tools/seed-data-tables.mjs <connect-instance-id>
```

Creates `FacilityInfoPrompts`, `AuthenticatePrompts`, `AuthenticatedMenuPrompts`, `BookingPrompts`
(skips any that already exist), adds every column with `locale` as the Primary Attribute, and
fills both `pl`/`en` rows — all via the public `CreateDataTable`/`CreateDataTableAttribute`/
`BatchCreateDataTableValue` APIs. Safe to re-run: existing tables/columns are reused, and a
"value already set" failure on re-run is reported but not fatal. Pass a table name as a second
argument (e.g. `BookingPrompts`) to limit a run to just that one table.

After it runs, open each table in the console (Routing → Data tables) and confirm it shows as
**Published** with both rows populated — the script creates tables already-published, but this
hasn't been verified end-to-end against a real instance yet, so a quick look is worth it before
moving on. If you'd rather do this by hand instead, the full column/row content is also written
out as prose in `connect-flow-templates/data-tables.md`.

## 4. Fill in real ARNs

```
cd connect-flow-templates
# create fill-arns.local.json (gitignored) if you don't already have one, or update it -
# it should already have every REPLACE_WITH_* value from earlier phases
node fill-arns.mjs
```

Writes filled copies (placeholders resolved) to `connect-flow-templates/filled/`.

## 5. Push the flows **(script)**

Before the first run, look up the real `ContactFlowId` for your existing **Authenticate** and
**Authenticated Menu** flows (console → open the flow → Show additional flow information → copy
the ID out of the Arn) and record them:

```json
// ../pcm-connect-tools/flow-ids.local.json (create if missing)
{
  "keypad-authenticate-flow.json": "<id>",
  "keypad-authenticated-menu-flow.json": "<id>"
}
```

This is needed only for these two — their committed JSON never carried a recorded flow name to
match against, so the script refuses to guess and would otherwise risk creating duplicates. The
other three (**Main Menu - Facility Info**, **Booking**) match by name automatically, and
**Language Select** is genuinely new — the script will create it.

Then, from the repo root:

```
node ../pcm-connect-tools/import-flows.mjs "$(pwd)" <connect-instance-id>
```

Re-run any time you change a flow file — it updates by recorded/matched ID, never re-creates once
a flow is known.

## 6. Add the Data Table block to each flow (manual, can't be scripted)

For each of the four locale-aware flows, open it in the Connect designer and follow its own
`description` field verbatim (visible in the flow's Properties panel, or re-read the source JSON):

1. `keypad-facility-info-main-menu-flow.json` → add a Data Table block (table
   `FacilityInfoPrompts`) between `5fd8b757-...` and `copyPrompts`.
2. `keypad-authenticate-flow.json`, `keypad-authenticated-menu-flow.json`,
   `keypad-booking-flow.json` → add a Data Table block (tables `AuthenticatePrompts`,
   `AuthenticatedMenuPrompts`, `BookingPrompts` respectively) as the new first action, then change
   the flow's **Start** to point at it, with its Success transition going to `copyPrompts`.

Each block: Evaluate action, one query named exactly the table name, Primary Attribute
`locale` = `$.Attributes.locale`, Query Attributes = every column for that table (see
`data-tables.md`). **Publish** each flow after wiring it.

## 7. Repoint the number's entry flow

Console → Phone numbers → your claimed number → change the flow to **Language Select (S-10)**.

## 8. Verify (the full manual matrix)

Run through `plan.md`'s Phase 6 checklist: language selection, English facility-info, a full
English booking (happy path + no-availability + declined confirmation + three-failed-attempt
transfer), and a Polish regression pass confirming nothing changed for `locale=pl`.
