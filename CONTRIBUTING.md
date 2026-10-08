# Contributing to Pulse

Pulse is a generic reporting library. Anyone can use it for their own agents, in their own Azure
tenant, shown in their own tools. Keep it that way.

## Rule 1: nothing in this repo knows who deployed it

The code, docs, examples, test vectors and fixtures are read by **every** team that adopts Pulse.
They must not name a particular customer, agent, person, mailbox or deployment.

- **Never:** a real agent's name as an `agentId`, a customer's subject buckets, a real person in
  a masking test, title wording copied from one deployment's runbook.
- **Instead:** obviously generic names (`acme-helpdesk`, Acme, Alex Morgan, Sam Taylor) and
  `example.com` addresses.

Deployment specifics (which subject buckets an agent uses, how it words its titles, when it turns
samples on) belong in **the agent's own code**, which calls Pulse. If a helper only makes sense
for one deployment, it does not belong here.

## Rule 2: the contract is the product

[`spec/AGENT-ACTIVITY.md`](./spec/AGENT-ACTIVITY.md) is what reporters and the portal agree on,
and the three implementations are only ways of keeping it. A change to the contract (a new
property, a new allowed value, a different rule for an existing one) must, **in one pull
request**:

1. bump `schemaVersion` (in the spec and in all three implementations) unless the change is
   purely additive and optional, and say in the PR which it is;
2. update `spec/AGENT-ACTIVITY.md` and, where affected, `spec/examples/`;
3. update the TypeScript, Python and .NET implementations;
4. update `spec/test-vectors.json` so all three test suites cover the change.

A change to behaviour that is not in the contract (masking patterns, comparison helpers,
connection-string parsing) still goes through the shared test vectors: add a vector, and make all
three implementations pass it. The vectors are the only thing that keeps the three in step, so a
fix in one language alone will be sent back.

## Pull requests

- Title in conventional-commit form (`feat:`, `fix:`, `docs:`, `chore:`…); body with a
  `Fixes #nnn` line for `feat`/`fix`/`perf`/`refactor` and a `## Test plan` section. `pr-lint`
  enforces this.
- All three test suites must pass locally before you push; CI runs them again.
- Keep secrets, real customer names, real messages and real personal data out of tests, vectors
  and fixtures. Use low-entropy placeholders (`ikey-1`, the all-zero GUID). `gitleaks` runs on
  every push.

## Running the tests

```
# TypeScript (Node 22.12+ for the dev tooling; the library itself runs on Node 20+)
npm ci
npm run check            # eslint, tsc --noEmit, vitest

# Python 3.10+
cd python
python -m venv .venv && . .venv/bin/activate
pip install -e ".[test]"
pytest

# .NET 8
cd dotnet
dotnet test
```

Each suite reads `spec/test-vectors.json` directly from the repo, so a vector you add is picked up
by all three without further wiring.

## Releasing

1. Bump the version in `package.json`, `python/pyproject.toml` (and `__version__` in
   `python/src/agent_pulse/__init__.py`) and `dotnet/src/KnowAll.AgentPulse/KnowAll.AgentPulse.csproj`
   to the same number, in a `chore: release vX.Y.Z` PR.
2. After it merges, tag `main`: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. `release.yml` checks the tag matches all three versions, runs every suite, builds the npm
   tarball, the Python wheel and sdist and the nupkg, and attaches them to a GitHub release.

Publishing to the registries is **off** until a maintainer sets it up, one registry at a time:

| Registry | One-off setup | Then set repository variable |
| --- | --- | --- |
| npm | Create the `@knowall-ai` organisation on npmjs.com (if it does not exist) and an automation token with publish rights; save it as the `NPM_TOKEN` secret. | `PUBLISH_NPM=true` |
| PyPI | Add a pending trusted publisher on pypi.org for project `agent-pulse`: owner `knowall-ai`, repo `agent-pulse`, workflow `release.yml`, environment `pypi`. Create the `pypi` environment in the repo settings. No token is stored. | `PUBLISH_PYPI=true` |
| NuGet | On nuget.org, reserve the `KnowAll` prefix if wanted and create an API key scoped to `KnowAll.AgentPulse` with push rights; save it as the `NUGET_API_KEY` secret. | `PUBLISH_NUGET=true` |

Until then, consumers install from GitHub: `npm install github:knowall-ai/agent-pulse#vX.Y.Z`,
`pip install "agent-pulse @ git+https://github.com/knowall-ai/agent-pulse@vX.Y.Z#subdirectory=python"`,
or a project reference / the nupkg from the GitHub release.
