# ADR-001: slackctl CLI Architecture

Current version: [0.0.5](./ADR-001-slackctl-cli-architecture-0.0.5.md) (Accepted, 2026-10-02)

## Versions

| Version | Status | Date | Summary |
| --- | --- | --- | --- |
| [0.0.5](./ADR-001-slackctl-cli-architecture-0.0.5.md) | Accepted | 2026-10-02 | Decision 10 states that usage errors exit 2 by explicit installation at the entry point, not by commander's default |
| [0.0.4](./ADR-001-slackctl-cli-architecture-0.0.4.md) | Deprecated | 2026-10-02 | Adds `--pattern` and `--date` selection; app-posted authors shown in `USER` |
| [0.0.3](./ADR-001-slackctl-cli-architecture-0.0.3.md) | Deprecated | 2026-10-02 | Adds message selection by explicit `--ts`, `--ts-from`/`--ts-to` range, and interactive `--select` |
| [0.0.2](./ADR-001-slackctl-cli-architecture-0.0.2.md) | Deprecated | 2026-10-02 | Review changes: CommonJS, admin may delete any author's messages, no fixed sleeps, 100-per-page history, USER column |
| [0.0.1](./ADR-001-slackctl-cli-architecture-0.0.1.md) | Deprecated | 2026-10-02 | Initial decision: layered commander CLI replacing the single-file delete script |

Implementation plan: [imp/ADR-001-slackctl-cli-architecture-implementation-plan.md](./imp/ADR-001-slackctl-cli-architecture-implementation-plan.md)
