<!--
Title format: conventional-commit prefix + short description.
  feat: ...      fix: ...      perf: ...      refactor: ...     (require Fixes #nnn)
  chore: ...     ci: ...       docs: ...      deps: ...
  test: ...      build: ...    style: ...
-->

## Summary

<!-- 1–3 bullets: what changed and why. -->

## Contract

<!-- Does this change spec/AGENT-ACTIVITY.md? If so: schemaVersion bumped (or why not), spec,
TypeScript, Python, .NET and spec/test-vectors.json all updated in this PR. Otherwise: "No change". -->

## Fixes

Fixes #

<!-- At least one `Fixes #nnn` line is required for feat/fix/perf/refactor (the lint checks for one; list every issue you resolve). Optional for every other prefix (chore, ci, docs, deps, test, build, style); delete the section if unused. -->

## Test plan

<!--
Steps a reviewer can follow, with expected results, e.g.
  1. `npm ci && npm run check`
  2. `cd python && pip install -e ".[test]" && pytest`
  3. `cd dotnet && dotnet test`
  4. **Expected:** all three suites pass, including any new test vectors.
For refactor / docs / CI / deps PRs: N/A — <reason>
-->
