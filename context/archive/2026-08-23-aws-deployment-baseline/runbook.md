# F-01 manual verification runbook

Covers all 19 manual Progress rows in `plan.md`, ordered by what actually runs. The plan's own
order is not runnable: 1.8 needs a container, and no container exists until the pipeline has
published an image (3.4/3.5).

Fill these in as you go:

```
ACCOUNT      =
CONNECT_ARN  = arn:aws:connect:eu-central-1:<account>:instance/<id>
INSTANCE_ID  =            # MockInstanceId output
PRIVATE_IP   =            # MockPrivateIp output
FUNCTION     =            # ConnectHealthFunctionName output
ROLE_ARN     =            # DeployRoleArn output
VPC_ID       =
PUBLIC_IP    =
MOCK_SG_ID   =
```

---

## 0. Prerequisites

```bash
aws login
aws sts get-caller-identity          # confirm the right account, and eu-central-1
cd infra && npx cdk bootstrap        # skip if already bootstrapped
```

---

## 1. Deploy — rows 1.6, 2.4

```bash
cd infra
npx cdk deploy -c connectInstanceArn=$CONNECT_ARN
```

**Row 1.6** — completes without error. Record the four outputs into the table above.

Expect this to be slow. The function's ENI is created on first deploy and the function sits in
`Pending` for several minutes; a deploy that looks hung is usually that.

**Row 2.4** — the function reaches Active:

```bash
aws lambda get-function-configuration --function-name $FUNCTION --query State --output text
```

Expect `Active`. Re-run if it still says `Pending`.

> If `GithubOidc` fails with `EntityAlreadyExists`, the account already has a GitHub OIDC
> provider — import it rather than creating one.
>
> If `ConnectFunctionAssociation` fails, delete that construct and associate the function in the
> Connect console instead. Rows 4.3-4.5 still work; note which route you used in `change.md`.

---

## 2. Instance access — row 1.7

Console -> EC2 -> the instance -> **Connect** -> **Session Manager** -> Connect.

**Row 1.7** — a shell opens with no key pair and no inbound port. Keep this session open; step 5
uses it.

---

## 3. The port is closed — row 1.9

```bash
aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text    # -> PUBLIC_IP

curl -m 5 http://$PUBLIC_IP:3000/health
```

**Row 1.9** — expect a timeout or connection refused, never a payload.

Confirm the rule itself rather than trusting the curl:

```bash
aws ec2 describe-security-groups --group-ids $MOCK_SG_ID \
  --query 'SecurityGroups[0].IpPermissions'
```

Expect exactly one rule, port 3000, sourced from the function's security group — and no `CidrIp`
of `0.0.0.0/0` anywhere.

---

## 4. Wire up the pipeline — rows 3.4, 3.5

GitHub -> repo **Settings** -> **Secrets and variables** -> **Actions** -> **Variables** tab ->
**New repository variable**. Variables, not secrets: neither value is a credential, and the OIDC
trust policy is what actually gates the role.

| Name | Value |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | the `DeployRoleArn` output |
| `MOCK_INSTANCE_ID` | the `MockInstanceId` output |

Now trigger it. The workflow only fires on pushes touching `his/`, so an empty commit will not
do it — touch something real, for example add a blank line to `his/src/main.ts`, then commit and
push.

**Row 3.4** — the workflow runs and goes green.

**Row 3.5** — the image is there under both tags:

```bash
aws ecr describe-images --repository-name phoneconnect-med-his \
  --query 'imageDetails[].imageTags'
```

Expect the commit SHA and `latest`.

---

## 5. The mock answers — row 1.8

In the Session Manager shell from step 2:

```bash
docker ps                       # expect a running container named "his"
curl -s localhost:3000/health
```

**Row 1.8** — expect `{"service":"his","status":"ok"}`.

---

## 6. The round trip — rows 2.5, 2.6, 2.7

From the repository root:

```bash
aws lambda invoke --function-name $FUNCTION \
  --payload fileb://lambdas/connect-health/event.sample.json out.json
cat out.json
```

**Row 2.5** — expect `{"reachable":"true","service":"his","status":"ok"}`. The `service` value is
what proves the payload came from the mock rather than from the function.

**Row 2.6** — every top-level value is a string. Nested objects are rejected by telephony at
runtime, so this is the contract that matters most in the whole change.

**Row 2.7** — the invocation is logged, with no NAT gateway and no interface endpoint:

```bash
aws lambda get-function-configuration --function-name $FUNCTION --query LoggingConfig
aws logs tail <that log group> --since 10m

aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=$VPC_ID
aws ec2 describe-vpc-endpoints --filters Name=vpc-id,Values=$VPC_ID
```

The last two must both come back empty. Note the `Duration` on the log line — that is the
latency baseline every later slice gets measured against, so write it into the thesis notes now
rather than reconstructing it later.

---

## 7. Failure behaviour — row 2.8

```bash
aws ec2 stop-instances --instance-ids $INSTANCE_ID
aws ec2 wait instance-stopped --instance-ids $INSTANCE_ID

aws lambda invoke --function-name $FUNCTION \
  --payload fileb://lambdas/connect-health/event.sample.json out.json
cat out.json
```

**Row 2.8** — expect `{"reachable":"false","error":"..."}` returned in about a second.

Check the `Duration` in the log. It must be near 1000 ms, which is the request timeout. If it is
near 2000 ms the function timed out instead of handling the error, and this row fails.

---

## 8. Private IP survives a restart — row 1.10

The instance is still stopped from step 7.

```bash
aws ec2 start-instances --instance-ids $INSTANCE_ID
aws ec2 wait instance-running --instance-ids $INSTANCE_ID
aws ec2 describe-instances --instance-ids $INSTANCE_ID \
  --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text
```

**Row 1.10** — identical to the `PRIVATE_IP` recorded in step 1. This is what keeps the
function's deploy-time environment variable valid across the stop-between-sessions pattern.

---

## 9. Deploying to a stopped instance — rows 3.7, 3.6

```bash
aws ec2 stop-instances --instance-ids $INSTANCE_ID
aws ec2 wait instance-stopped --instance-ids $INSTANCE_ID
```

Now make a visible change so you can watch it land. In `his/src/app.service.ts` change the health
payload's `service` value to `his-probe`, and update the matching assertion in
`his/src/app.controller.spec.ts`. Commit and push.

**Row 3.7** — the workflow starts the instance itself and completes green. Watch the "Start the
instance and wait for it to register" step actually wait. Without it this push would fail for a
reason unrelated to the code, which is the whole point of that step existing.

**Row 3.6** — the change is live:

```bash
aws lambda invoke --function-name $FUNCTION \
  --payload fileb://lambdas/connect-health/event.sample.json out.json
cat out.json     # expect "service":"his-probe"
```

Then revert both files, commit, push, and confirm it goes back to `his`.

---

## 10. A broken build fails — row 3.8

Introduce a real compile error in `his/src/app.service.ts`, for example
`const broken: number = 'no';`, then commit and push.

**Row 3.8** — the workflow fails at the image build step, and nothing new appears in the
registry. Revert afterwards.

---

## 11. Telephony — rows 4.3, 4.4, 4.5

**Row 4.3** — Console -> Amazon Connect -> your instance -> **Flows** -> the **AWS Lambda**
section lists the function. This is what the association custom resource created. If you fell
back to the console route in step 1, add it here instead.

**Row 4.4** — Create or edit a contact flow, add an **Invoke AWS Lambda function** block, and
confirm the function is selectable in its dropdown.

**Row 4.5** — After the invoke block add a **Play prompt** block reading `$.External.service`,
publish the flow, attach it to the test number, and call it. You should hear the mock's service
identifier. Flows are hand-built and deliberately not committed, so this stays a console
exercise.

---

## 12. The context guard — row 4.6

```bash
cd infra && npx cdk synth
```

**Row 4.6** — expect the synth to fail with:

```
Missing context value connectInstanceArn. Pass the Connect instance ARN, for example:
cdk synth -c connectInstanceArn=arn:aws:connect:eu-central-1:<account>:instance/<id>
```

Not a partial template, and not a deploy of something broken.

---

## 13. Reproducibility — the plan's Manual Testing step 6

```bash
cd infra
npx cdk destroy -c connectInstanceArn=$CONNECT_ARN
npx cdk deploy  -c connectInstanceArn=$CONNECT_ARN
```

Everything comes back. Two consequences to expect:

- The instance ID and private IP **change**. Update `MOCK_INSTANCE_ID` in the GitHub variables or
  the next pipeline run fails.
- The registry is emptied on destroy (`emptyOnDelete`), so the instance boots with no image again
  until the next `his/` push.

---

## A known property, not a defect

A VPC-attached function left idle for 14 days has its ENI reclaimed and goes `Inactive`. The next
invocation **fails**; the one after it succeeds. Combined with the stop-between-sessions working
pattern, the first call before a demonstration or defence is the likely victim.

Warm the function before any live demo, and record this in the write-up as a property of the
deployment rather than a defect.
