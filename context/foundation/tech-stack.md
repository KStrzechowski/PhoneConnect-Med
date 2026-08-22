---
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
---

## Why this stack

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
