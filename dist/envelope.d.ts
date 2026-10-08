import type { ActivityEnvelope, AgentActivity } from "./types.js";
export declare const ACTIVITY_EVENT_NAME = "AgentActivity";
export declare const ACTIVITY_SCHEMA_VERSION = "1";
/** Samples are cut to this many characters (including the trailing ellipsis) after masking. */
export declare const SAMPLE_MAX_CHARS = 3500;
/** One stalled ingestion call must not hold the agent. */
export declare const INGESTION_TIMEOUT_MS = 5000;
export declare const DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com";
export declare const ACTIVITY_LEVELS: readonly ["info", "success", "warning", "error"];
export declare const ACTIVITY_CHANNELS: readonly ["email", "teams", "web", "voice", "api"];
/** True when `activityType` is dotted lowercase, e.g. `email.drafted`. */
export declare function validateActivityType(activityType: string): boolean;
/** A stable activity id from an upstream id: lowercase sha256 hex of its UTF-8 bytes. */
export declare function activityIdFrom(upstreamId: string): string;
/** ISO-8601 UTC with milliseconds and a `Z`, the form every implementation writes. */
export declare function formatUtc(time: Date): string;
export interface EnvelopeOptions {
    agentId: string;
    instrumentationKey: string;
    time: Date;
    /** Default actor when the activity has none. */
    actor?: string;
    /** Keep samples (masked, then truncated). Off by default. */
    samples?: boolean;
}
/**
 * The App Insights envelope for one activity. Throws on a contract violation;
 * `createPulse` catches that, logs it and drops the event.
 */
export declare function toEnvelope(activity: AgentActivity, options: EnvelopeOptions): ActivityEnvelope;
export interface ParsedConnectionString {
    instrumentationKey: string;
    ingestionEndpoint: string;
}
/** Instrumentation key and ingestion endpoint from an App Insights connection string, or undefined. */
export declare function parseConnectionString(connectionString: string | undefined): ParsedConnectionString | undefined;
//# sourceMappingURL=envelope.d.ts.map