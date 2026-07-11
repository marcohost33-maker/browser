## Scope

- [ ] This change belongs to APP-01 `browser` and does not move Engine/ENG-01 work into this repository.
- [ ] Non-goals and affected trust boundaries are stated.

## Change

Describe the behavior, decision or control being changed.

## Risk and privacy

- [ ] Security and privacy impact assessed.
- [ ] Untrusted input, credential, endpoint, storage and rendering paths reviewed where relevant.
- [ ] No new telemetry, remote asset, persistent sensitive storage or broad network permission was introduced without an ADR.

## Verification

- [ ] `npm ci --ignore-scripts`
- [ ] `npm run csp:check`
- [ ] `npm test`
- [ ] Documentation lint and links pass.
- [ ] Workflow security audit passes when workflows changed.
- [ ] Negative/regression tests demonstrate that the control fails closed.

## Evidence

Link requirements, ADRs, issues, test output and CI runs. A checklist mark without evidence is not a release claim.

## Release and rollback

- [ ] Compatibility and migration impact documented.
- [ ] Rollback or safe disablement path documented.
- [ ] Public-facing claims do not exceed verified behavior.
