# Pulse

[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/knowall-ai/agent-pulse?label=CodeRabbit+Reviews&labelColor=171717&color=FF570A)](https://coderabbit.ai)
[![CI](https://github.com/knowall-ai/agent-pulse/actions/workflows/ci.yml/badge.svg)](https://github.com/knowall-ai/agent-pulse/actions/workflows/ci.yml)

**Report what your AI agents do.** One small library by [KnowAll AI](https://knowall.ai), in
TypeScript, Python and .NET: your agent calls `emit` when it drafts a reply, answers a chat or
joins a call, and an `AgentActivity` event lands in the agent's own Azure Application Insights,
where the [Agents Portal](https://github.com/knowall-ai/agents-portal) counts it, charts it and
shows it to the people the agent works for.

```
npm install github:knowall-ai/agent-pulse
pip install "agent-pulse @ git+https://github.com/knowall-ai/agent-pulse#subdirectory=python"
dotnet add reference agent-pulse/dotnet/src/KnowAll.AgentPulse
```

## Why Pulse

An agent's infrastructure telemetry tells you it is *up*. It does not tell you what it *did*: how
many emails it drafted today, how many the team sent unchanged, which questions it could not
answer, whether that dead-lettered message was the only real failure this week. Pulse is that
missing layer, and it is deliberately small.

- **One contract, three languages.** [AgentActivity v1](./spec/AGENT-ACTIVITY.md) is a plain
  Application Insights custom event with string properties. The TypeScript, Python and .NET
  implementations all pass the same [test vectors](./spec/test-vectors.json), so an agent on any
  stack reports the same shape.
- **No SDK, no dependencies.** One small HTTPS POST per event to the ingestion endpoint in your
  connection string, with a 5-second timeout. Nothing to configure beyond the connection string
  your Azure resource already gives you.
- **Never breaks the agent.** `emit` never throws. An invalid event or a failed send is logged and
  dropped; telemetry must never cost a draft.
- **Your data stays yours.** Events go to the agent's *own* Application Insights, in your tenant.
  The portal reads them with the signed-in user's own Azure token, so it never sees more than they
  could.
- **Privacy built into the contract.** Titles and subjects are visible to customers, so they carry
  no personal data. Example inputs and outputs are opt-in, masked at source, truncated and
  admin-only.
- **Counts that mean something.** Stable `activityId`s de-duplicate retries and redeliveries, and
  the [counting rules](./spec/AGENT-ACTIVITY.md#5-counting-rules) separate "failed once, will
  retry" from "gave up".

## Quick start

Every implementation reads `APPLICATIONINSIGHTS_CONNECTION_STRING` when you do not pass a
connection string, and needs the agent's id: the value of its Azure `agent` tag.

### TypeScript (Node 20+)

```ts
import { activityIdFrom, createPulse } from "@knowall-ai/agent-pulse";

const pulse = createPulse({ agentId: "acme-helpdesk", actor: "acme-helpdesk" });

await pulse.emit({
  activityType: "email.drafted",
  title: "Drafted reply · billing",          // no personal data: customers see this
  level: "success",
  activityId: activityIdFrom(message.id),    // sha256 of the upstream id
  channel: "email",
  subject: "billing",                        // one of your own fixed buckets
  detail: "confidence 0.91",
  measurements: { confidence: 0.91, sensitive: 0 },
});

await pulse.flush(); // before a short-lived process exits
```

`createPulse({ connectionString?, agentId, actor?, samples?, fetch?, warn?, now? })` returns
`{ emit, flush }`. Also exported: `noopPulse`, `maskPii`, `activityIdFrom`,
`validateActivityType`, `toEnvelope`, and the comparison helpers `similarity`, `editDistance`,
`stripQuoted` and `SENT_AS_IS`. ESM and CommonJS builds with types (`import` or `require`, Node 20+), zero runtime dependencies.

### Python (3.10+)

```python
from agent_pulse import AgentActivity, activity_id_from, create_pulse

pulse = create_pulse(agent_id="acme-helpdesk", actor="acme-helpdesk")

pulse.emit(AgentActivity(
    activity_type="chat.answered",
    title="Answered a question · opening hours",
    level="success",
    activity_id=activity_id_from(conversation_id),
    channel="teams",
    subject="opening hours",
))

await pulse.emit_async(activity)   # from asyncio code: runs on a worker thread
```

`create_pulse(agent_id=..., connection_string=None, actor=None, samples=False, transport=None,
warn=None, now=None)`; `emit` also accepts a dict with the same snake_case keys. Also:
`noop_pulse`, `mask_pii`, `activity_id_from`, `validate_activity_type`, `to_envelope`,
`similarity`, `edit_distance`, `strip_quoted`. Standard library only.

### .NET (net8.0)

```csharp
using KnowAll.AgentPulse;

var pulse = AgentPulse.Create(new PulseOptions { AgentId = "acme-helpdesk", Actor = "acme-helpdesk" });

await pulse.EmitAsync(new AgentActivity
{
    ActivityType = "call.joined",
    Title = "Joined a call",
    Level = ActivityLevels.Info,
    ActivityId = AgentPulse.ActivityIdFrom(callId),
    Channel = ActivityChannels.Teams,
});
```

`AgentPulse.Create(PulseOptions)` returns an `IPulse` with `EmitAsync` and `FlushAsync`. Also:
`AgentPulse.Noop`, `PiiMask.MaskPii`, `AgentPulse.ActivityIdFrom`,
`AgentPulse.ValidateActivityType`, `AgentPulse.ToEnvelope`, and `EditComparison.Similarity`,
`EditDistance`, `StripQuoted`. No dependencies beyond the BCL. Reference the project, or
`dotnet pack dotnet/src/KnowAll.AgentPulse -c Release` and install the nupkg.

## Patterns worth copying

**Retries and dead letters.** Report each failed attempt as `email.failed` at level `error`, and
the final give-up as `email.failed` at level `warning`, all with the same `activityId`. A later
success with that id shows the work recovered; only the `warning` counts as a failure.

**Draft versus what was sent.** When an agent drafts and a person sends, compare the two later
and report `email.compared` against the draft:

```ts
import { editDistance, SENT_AS_IS, similarity, stripQuoted } from "@knowall-ai/agent-pulse";

const sent = stripQuoted(sentReplyText);
const score = similarity(draftText, sent);
await pulse.emit({
  activityType: "email.compared",
  title: score >= SENT_AS_IS ? "Reply sent as drafted" : "Reply sent with edits",
  level: "info",
  activityId: activityIdFrom(`compared:${message.id}`),
  relatedActivityId: activityIdFrom(message.id),
  channel: "email",
  measurements: { replyFound: 1, similarity: score, editDistance: editDistance(draftText, sent), sentAsIs: score >= SENT_AS_IS ? 1 : 0 },
});
```

**Late and backfilled events.** Application Insights rejects events more than 48 hours old, so
the envelope is always stamped "now" and the real time goes in `occurredAt` (plus
`backfilled: true` when reconstructing history from logs).

## The contract

[`spec/AGENT-ACTIVITY.md`](./spec/AGENT-ACTIVITY.md) is the source of truth. In short:

- custom event **`AgentActivity`** (workspace table `AppEvents`, `Name == 'AgentActivity'`);
- required string properties `schemaVersion` (`"1"`), `agentId`, `activityType` (dotted
  lowercase, an open set: `email.drafted`, `chat.answered`, `knowledge.gap`, `call.joined`…),
  `title`, `level` (`info`/`success`/`warning`/`error`) and `activityId`;
- optional `subject` (a fixed bucket), `detail`, `actor`, `url`, `relatedActivityId`, `channel`
  (`email`/`teams`/`web`/`voice`/`api`), `occurredAt`, `backfilled`, and the opt-in
  `sampleRequest` / `sampleResponse`;
- optional numeric `measurements`;
- consumers count by distinct `activityId`.

Example envelopes are in [`spec/examples/`](./spec/examples), and
[`spec/test-vectors.json`](./spec/test-vectors.json) is what every implementation is tested
against.

## In the Agents Portal

Tag the agent's Azure resources, including its Application Insights / Log Analytics workspace,
with `agent=<agentId>`, and use the same id in `createPulse`. The portal finds the workspace by
that tag and queries `AppEvents` through ARM with the viewer's own token: no registration, no
keys to hand over. It then shows the agent's activity as counts by type and channel, a timeline
bucketed by `occurredAt`, success and failure rates under the counting rules, the
draft-versus-sent quality score from `email.compared`, and, for admins only, the masked samples.

## Privacy

`title`, `subject` and `detail` are shown to **customer viewers**, who may be the very people the
agent serves: keep personal data out of them. Use a fixed list of subject buckets, never a message
subject line.

Samples are **off** unless you pass `samples: true`. When on, every implementation masks them with
`maskPii` (using any `knownNames` you pass for the item, such as the sender), then truncates them
to 3,500 characters, and the portal masks them again and shows them to admins only. Never send
samples for sensitive items.

**Masking is a backstop, not a guarantee.** `maskPii` catches email addresses, UK phone numbers
and postcodes, account numbers, dates of birth, street addresses, names after a greeting, title or
relationship word, signature lines, and every known name you pass. It does **not** catch a
free-standing name with no cue ("Sam can't make it"). Before turning samples on for real users,
add named-entity recognition (for example Azure AI Language PII detection, run in your own
tenant) in front of it.

## Development

```
npm ci && npm run check                                        # TypeScript: lint, typecheck, vitest
cd python && pip install -e ".[test]" && pytest                # Python
cd dotnet && dotnet test                                       # .NET
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Changing the contract means bumping `schemaVersion` and
changing the spec, all three implementations and the test vectors together.

## The family

Pulse is one of KnowAll's small, open pieces for agents that work alongside people:
[Reverie](https://github.com/knowall-ai/hermes-reverie) is what an agent **remembers**, Presence
is where an agent **is**, and **Pulse is what an agent is doing**.

## Licence

MIT, © KnowAll AI Ltd. See [LICENSE](./LICENSE).
