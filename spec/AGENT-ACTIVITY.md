# AgentActivity v1

The contract between an AI agent that reports what it does and the tools that show it (the
[KnowAll Agents Portal](https://github.com/knowall-ai/agents-portal) first among them). **This
document is the source of truth.** The TypeScript, Python and .NET implementations in this repo,
and [`test-vectors.json`](./test-vectors.json), follow it; where they disagree, this document wins
and the code is the bug.

Status: **stable, schemaVersion `"1"`**.

## 1. The event

One Application Insights **custom event** per thing the agent did:

| | |
| --- | --- |
| Event name | `AgentActivity` |
| Log Analytics table | `AppEvents`, filtered on `Name == 'AgentActivity'` |
| Classic App Insights table | `customEvents`, filtered on `name == 'AgentActivity'` |
| Properties | `Properties` (`customDimensions`): every value is a **string** |
| Measurements | `Measurements` (`customMeasurements`): optional numbers |

The event goes to the agent's **own** Application Insights resource, the one in its
`APPLICATIONINSIGHTS_CONNECTION_STRING`. Implementations here post the envelope straight to the
ingestion endpoint named in the connection string (`<IngestionEndpoint>/v2.1/track`) with no SDK
dependency; sending the same event through an Application Insights SDK (`trackEvent`) is equally
valid, as long as the properties below are what arrives.

## 2. Properties

All values are strings. An optional property that is absent, null or empty is **omitted**, never
sent as `""`.

### Required

| Property | Value |
| --- | --- |
| `schemaVersion` | `"1"` |
| `agentId` | The agent's id: the value of its Azure `agent` tag. Also sent as the `ai.cloud.role` tag. |
| `activityType` | What happened, dotted lowercase, matching `^[a-z0-9]+(\.[a-z0-9_]+)+$`. An **open set** (see §4). |
| `title` | A short line a person can read, e.g. `Drafted reply · billing`. **No personal data.** |
| `level` | `info`, `success`, `warning` or `error`. |
| `activityId` | A stable id for this piece of work, used to de-duplicate and to correlate retries. Recommended: lowercase hex **sha256 of the upstream id** (the message id, conversation id, call id…), never the raw id. |

### Optional

| Property | Value |
| --- | --- |
| `subject` | A **fixed category bucket** the agent chooses from its own short list (`billing`, `returns`, `other`). Never free text, never an email subject line. |
| `detail` | A short, non-PII qualifier, e.g. `confidence 0.91` or `message-gone`. |
| `actor` | Who acted: normally the agent itself, or a component of it (`scheduler`). |
| `url` | A link a viewer can follow, if there is one that is safe to show. |
| `relatedActivityId` | The `activityId` of another activity this one is about (see `email.compared`). |
| `channel` | Where the agent acted: `email`, `teams`, `web`, `voice` or `api`. Absent means unknown. |
| `occurredAt` | The real time of the activity, ISO-8601 UTC ending in `Z` (`2026-10-08T09:58:12.345Z`). For late reports and backfill. Consumers use it **instead of the ingestion time**, unless it is after the time the event arrived, in which case they use the arrival time. |
| `backfilled` | `"true"` for events reconstructed after the fact (e.g. from logs). Absent otherwise; never `"false"`. |
| `sampleRequest` | An example of the input, **masked with `*****` at source**, at most **3,500 characters**. Opt-in only (see §6). |
| `sampleResponse` | An example of the output, same rules as `sampleRequest`. |

A property not listed here may be ignored by consumers. Do not invent new ones without bumping
`schemaVersion` (see [CONTRIBUTING](../CONTRIBUTING.md)).

## 3. Measurements

Optional numbers in `Measurements`, named in camelCase. Non-finite values (NaN, ±Infinity) must
not be sent; the implementations here drop them. Flags are `0` or `1`. Common ones:

| Measurement | Meaning |
| --- | --- |
| `confidence` | The agent's own confidence, 0 to 1. |
| `sensitive` | `1` if the item was judged sensitive (and so was never sampled), else `0`. |

Measurements specific to an activity type are listed with it below.

## 4. Activity types

`activityType` is `<domain>.<verb>`, lowercase, at least two segments; segments after the first
may contain `_`. The set is **open**: an agent may report any type that fits the pattern, and
consumers show unknown types generically. Use an existing type when one fits, so the portal can
count like with like:

| Type | Meaning |
| --- | --- |
| `email.drafted` | Drafted a reply for a person to review and send. |
| `email.sent` | Sent an email itself. |
| `email.skipped` | Deliberately did nothing with an email (e.g. it left the inbox first). |
| `email.failed` | Could not handle an email (see the counting rules in §5). |
| `email.compared` | Compared a draft with what the person actually sent (below). |
| `chat.answered` | Answered a chat message. |
| `chat.escalated` | Handed a chat to a person. |
| `knowledge.gap` | Was asked something its knowledge did not cover. |
| `call.joined` | Joined a call. |
| `meeting.attended` | Attended a meeting. |
| `standup.posted` | Posted a stand-up or status update. |

### `email.compared`

Emitted **after the person sends** their reply to an email the agent drafted, to measure how much
they changed. Events are immutable, so this is a new event about the draft, never an update to it.

- `relatedActivityId` = the `activityId` of the `email.drafted` event it judges.
- `activityId` = its own id (e.g. sha256 of `compared:` + the draft's upstream id).
- Measurements:

| Measurement | Meaning |
| --- | --- |
| `replyFound` | `1` if a sent reply was found, `0` if not (the other measurements are then omitted). |
| `similarity` | Word-level similarity of draft and sent reply, 0 to 1: 2 × longest common subsequence of words ÷ total words. `1` means identical. |
| `editDistance` | Words added plus words removed between draft and sent reply. |
| `sentAsIs` | `1` if `similarity` ≥ 0.97 (unchanged apart from a signature or a typo), else `0`. |

Before comparing, strip the quoted thread from the sent reply. The `similarity`, `editDistance`
and `stripQuoted` helpers in every implementation here compute these exactly as specified:
lowercase, punctuation to spaces, split on whitespace, first 1,500 words of each side.

## 5. Counting rules

Consumers summarise activity with these rules; reporters should emit so that they hold.

1. **Count by distinct `activityId`.** The same work reported twice (a queue redelivery, a retry)
   is one activity. The latest event for an `activityId` is its current state.
2. **`email.failed` with level `error`** is one failed attempt **that will be retried**. It is not
   a failure of the work. A later `email.drafted` with the same `activityId` means it recovered.
3. **`email.failed` with level `warning`** means the work was **dead-lettered**: no more retries.
   This is the only real failure.
4. Other types follow the same shape where they retry: `error` for a retried attempt, `warning`
   for giving up.

## 6. Privacy

- `title`, `subject` and `detail` are shown to **customer viewers** of the portal, who may be the
  very people the agent serves. Never put personal data in them: no names, addresses, account
  numbers, message subjects or quoted text.
- `sampleRequest` and `sampleResponse` are shown to **admins only**, and the portal masks them
  again before display. They are still personal data until proven otherwise:
  - **opt-in only**: off unless the deployment explicitly turns samples on;
  - **masked at source** with `*****` before they leave the agent, then truncated to 3,500
    characters (masking first, so a cut can never expose half a masked value);
  - **never for sensitive items** (complaints, bereavement, medical, safeguarding): send none.
- Regex and known-name masking (`maskPii` here) is a backstop. It misses free-standing names with
  no cue. Run named-entity recognition (e.g. Azure AI Language PII detection, in your own tenant)
  as well before turning samples on for real users.

## 7. Timing and backfill

Application Insights ingestion **rejects envelopes whose time is more than 48 hours old**. The
envelope time is therefore always "now", and the real time travels in `occurredAt`:

- reporting a few minutes late: set `occurredAt`;
- reconstructing history from logs: set `occurredAt` and `backfilled: "true"`, and send while the
  reconstruction runs. Use the same `activityId` the live event would have used, so a backfill
  that overlaps live reporting does not double count.

## 8. Discovery

The portal finds an agent's events without any registration:

1. It finds the agent's Azure resources by the `agent=<agentId>` tag.
2. Among them it finds the Application Insights component, or the **Log Analytics workspace**
   tagged `agent=<agentId>`, that receives the events.
3. It queries `AppEvents | where Name == 'AgentActivity'` through ARM with the signed-in user's own
   token, so a user sees an agent's activity only if Azure RBAC lets them read that workspace.

So: tag the agent's Application Insights / Log Analytics workspace with `agent=<agentId>`, and use
the same `<agentId>` in every event.

## 9. Envelope

What the implementations here POST to `<IngestionEndpoint>/v2.1/track`, as a JSON array of one:

```json
[
  {
    "name": "Microsoft.ApplicationInsights.Event",
    "time": "2026-10-08T10:00:00.000Z",
    "iKey": "<instrumentation key>",
    "tags": { "ai.cloud.role": "acme-helpdesk" },
    "data": {
      "baseType": "EventData",
      "baseData": {
        "ver": 2,
        "name": "AgentActivity",
        "properties": {
          "schemaVersion": "1",
          "agentId": "acme-helpdesk",
          "activityType": "email.drafted",
          "title": "Drafted reply · billing",
          "level": "success",
          "activityId": "2222…",
          "channel": "email",
          "subject": "billing"
        },
        "measurements": { "confidence": 0.91, "sensitive": 0 }
      }
    }
  }
]
```

The connection string's `IngestionEndpoint` defaults to `https://dc.services.visualstudio.com`
when absent. More examples: [`examples/`](./examples). Every implementation must pass
[`test-vectors.json`](./test-vectors.json): envelope properties for given inputs, rejected inputs,
`activityType` validation, `activityIdFrom`, connection-string parsing, masking and the
comparison helpers.

## 10. Reporter behaviour

A reporter (this library or any other) must:

- **never fail the agent's work**: an invalid activity or a failed send is logged and dropped,
  never thrown into the caller;
- give up on a send after **5 seconds**;
- validate `activityType`, `level`, `channel` and `occurredAt` before sending;
- drop samples unless samples are explicitly on, and mask before truncating when they are.
