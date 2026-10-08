# CLAUDE.md: guidance for AI contributors

Pulse is a small library in three languages that sends `AgentActivity` events to an agent's own
Application Insights. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first; its two rules override
anything below.

## Layout

- `spec/AGENT-ACTIVITY.md`: the contract, and the source of truth. `spec/test-vectors.json`:
  inputs and expected outputs shared by all three test suites. `spec/examples/`: example envelopes.
- Repo root: the TypeScript package `@knowall-ai/agent-pulse` (`src/`, `test/`, vitest).
- `python/`: the `agent-pulse` package, import `agent_pulse` (pytest).
- `dotnet/`: `KnowAll.AgentPulse` (net8.0) and its xunit tests.

## Rules

- **Keep the three implementations identical in behaviour.** A change in one language is a change
  in all three plus a test vector, in the same commit. Port regexes faithfully: Python uses
  `re.ASCII` and .NET `RegexOptions.ECMAScript` so `\b`, `\d` and `\s` match JavaScript.
- **Changing the contract** means updating the spec, all three implementations and the vectors
  together, and bumping `schemaVersion` unless the change is additive and optional.
- **No runtime dependencies** in any implementation: global `fetch` / `urllib` / `HttpClient` only.
- **Never throw into the caller** from `emit`; log through `warn` and drop the event.
- **No deployment names** (customers, agents, people) anywhere: use `acme-helpdesk`, Alex Morgan,
  `example.com`. No real email addresses except the support address already in SECURITY.md.
- Do not log connection strings, keys or sample text.

## Checks before pushing

```
npm run check
cd python && pytest
cd dotnet && dotnet test
```

PR titles use conventional-commit prefixes; bodies need `Fixes #nnn` (for feat/fix/perf/refactor)
and a `## Test plan` section.
