/** Severity of an activity, as the portal colours it. */
export type ActivityLevel = "info" | "success" | "warning" | "error";

/** Where the agent acted. Absent means unknown. */
export type ActivityChannel = "email" | "teams" | "web" | "voice" | "api";

/** One thing an agent did. See spec/AGENT-ACTIVITY.md for the full contract. */
export interface AgentActivity {
  /** Dotted lowercase, e.g. `email.drafted`, `chat.answered`. Open set. */
  activityType: string;
  /** Short, human-readable. Visible to customer viewers: never personal data. */
  title: string;
  level: ActivityLevel;
  /** Stable id for dedupe. Use `activityIdFrom(upstreamId)`, never the raw id. */
  activityId: string;
  channel?: ActivityChannel;
  /** A fixed category bucket chosen by the agent, never free text. */
  subject?: string;
  /** Short, non-PII detail, e.g. `confidence 0.91`. */
  detail?: string;
  /** Who acted. Defaults to the pulse's `actor` option. */
  actor?: string;
  url?: string;
  /** The activity this one is about, e.g. the draft an `email.compared` judges. */
  relatedActivityId?: string;
  /** When it really happened, for late or backfilled reports. ISO-8601 UTC with `Z`, or a Date. */
  occurredAt?: string | Date;
  /** True for events reconstructed after the fact (e.g. from logs). */
  backfilled?: boolean;
  /** Opt-in example input. Masked and truncated by the library; dropped unless `samples: true`. */
  sampleRequest?: string;
  /** Opt-in example output. Masked and truncated by the library; dropped unless `samples: true`. */
  sampleResponse?: string;
  /** Names and addresses already known for this item (e.g. the sender), masked everywhere in samples. */
  knownNames?: string[];
  /** Optional numbers, e.g. `{ confidence: 0.91, sensitive: 0 }`. Non-finite values are dropped. */
  measurements?: Record<string, number>;
}

/** The App Insights envelope sent for one activity. */
export interface ActivityEnvelope {
  name: "Microsoft.ApplicationInsights.Event";
  time: string;
  iKey: string;
  tags: Record<string, string>;
  data: {
    baseType: "EventData";
    baseData: {
      ver: 2;
      name: "AgentActivity";
      properties: Record<string, string>;
      measurements: Record<string, number>;
    };
  };
}

/** What `createPulse` returns. */
export interface Pulse {
  /** Report one activity. Never throws or rejects: failures are logged and the event dropped. */
  emit(activity: AgentActivity): Promise<void>;
  /** Wait for every emit still in flight. Never rejects. */
  flush(): Promise<void>;
}
