---
change_id: aws-deployment-baseline
title: AWS deployment baseline
status: implementing
created: 2026-08-23
updated: 2026-08-23
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Connect association (Phase 4).** Done in IaC via an `AwsCustomResource` calling
`connect:AssociateLambdaFunction`, not by hand in the console. The plan allowed either;
the custom resource was chosen so `cdk destroy` / `cdk deploy` round-trips the association
along with everything else. If it fails on deploy, delete the `ConnectFunctionAssociation`
construct and associate the function in the Connect console instead — the invoke permission
is a separate resource and stands on its own.

**`connectInstanceArn` is now required.** After Phase 4, a bare `cdk synth` fails by design.
Pass `-c connectInstanceArn=<arn>`, or put it in `cdk.context.json`.

