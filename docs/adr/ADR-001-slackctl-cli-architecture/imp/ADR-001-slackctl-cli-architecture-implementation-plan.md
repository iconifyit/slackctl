# Implementation Plan: ADR-001 slackctl CLI Architecture

Current version: [0.0.3](./ADR-001-slackctl-cli-architecture-implementation-plan-0.0.3.md) (governing ADR: [ADR-001 0.0.6](../ADR-001-slackctl-cli-architecture-0.0.6.md))

## Versions

| Version | Status | Date | Summary |
| --- | --- | --- | --- |
| [0.0.3](./ADR-001-slackctl-cli-architecture-implementation-plan-0.0.3.md) | Current | 2026-10-02 | Transport sends form-encoded request bodies (fix for private channels missing from `channels`) |
| [0.0.2](./ADR-001-slackctl-cli-architecture-implementation-plan-0.0.2.md) | Deprecated | 2026-10-02 | Carries the owner's class-based client and services decision (2026-10-02) and the implementation-time refinements: one prompter per command run, `getToken` on the context, option factories, `reservedWidth`, `NonInteractiveError`, the runner seam and its tests, the Slack-like history route, per-command test files, and the live smoke record |
| [0.0.1](./ADR-001-slackctl-cli-architecture-implementation-plan-0.0.1.md) | Deprecated | 2026-10-02 | The plan as approved by the owner before implementation (closure-factory client and services) |
