import { createHash } from "node:crypto";
import { maskPii } from "./mask.js";
export const ACTIVITY_EVENT_NAME = "AgentActivity";
export const ACTIVITY_SCHEMA_VERSION = "1";
/** Samples are cut to this many characters (including the trailing ellipsis) after masking. */
export const SAMPLE_MAX_CHARS = 3500;
/** One stalled ingestion call must not hold the agent. */
export const INGESTION_TIMEOUT_MS = 5000;
export const DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com";
export const ACTIVITY_LEVELS = ["info", "success", "warning", "error"];
export const ACTIVITY_CHANNELS = ["email", "teams", "web", "voice", "api"];
const ACTIVITY_TYPE = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/;
/** True when `activityType` is dotted lowercase, e.g. `email.drafted`. */
export function validateActivityType(activityType) {
    return typeof activityType === "string" && ACTIVITY_TYPE.test(activityType);
}
/** A stable activity id from an upstream id: lowercase sha256 hex of its UTF-8 bytes. */
export function activityIdFrom(upstreamId) {
    return createHash("sha256").update(upstreamId, "utf8").digest("hex");
}
/** ISO-8601 UTC with milliseconds and a `Z`, the form every implementation writes. */
export function formatUtc(time) {
    return time.toISOString();
}
function truncate(text) {
    return text.length > SAMPLE_MAX_CHARS ? `${text.slice(0, SAMPLE_MAX_CHARS - 1)}…` : text;
}
/**
 * The App Insights envelope for one activity. Throws on a contract violation;
 * `createPulse` catches that, logs it and drops the event.
 */
export function toEnvelope(activity, options) {
    if (!options.agentId)
        throw new Error("agentId is required");
    if (!validateActivityType(activity.activityType)) {
        throw new Error(`invalid activityType "${String(activity.activityType)}"`);
    }
    if (!activity.title)
        throw new Error("title is required");
    if (!activity.activityId)
        throw new Error("activityId is required");
    if (!ACTIVITY_LEVELS.includes(activity.level)) {
        throw new Error(`invalid level "${String(activity.level)}"`);
    }
    if (activity.channel !== undefined && !ACTIVITY_CHANNELS.includes(activity.channel)) {
        throw new Error(`invalid channel "${String(activity.channel)}"`);
    }
    let occurredAt;
    if (activity.occurredAt instanceof Date) {
        if (Number.isNaN(activity.occurredAt.getTime()))
            throw new Error("invalid occurredAt");
        occurredAt = formatUtc(activity.occurredAt);
    }
    else if (activity.occurredAt !== undefined && activity.occurredAt !== "") {
        if (!UTC_TIMESTAMP.test(activity.occurredAt)) {
            throw new Error(`occurredAt must be ISO-8601 UTC ending in Z, got "${activity.occurredAt}"`);
        }
        occurredAt = activity.occurredAt;
    }
    const known = activity.knownNames ?? [];
    const sample = (text) => options.samples && text ? truncate(maskPii(text, known)) : undefined;
    const properties = {
        schemaVersion: ACTIVITY_SCHEMA_VERSION,
        agentId: options.agentId,
        activityType: activity.activityType,
        title: activity.title,
        level: activity.level,
        activityId: activity.activityId,
    };
    const optional = {
        subject: activity.subject,
        detail: activity.detail,
        actor: activity.actor || options.actor,
        url: activity.url,
        relatedActivityId: activity.relatedActivityId,
        channel: activity.channel,
        occurredAt,
        backfilled: activity.backfilled ? "true" : undefined,
        sampleRequest: sample(activity.sampleRequest),
        sampleResponse: sample(activity.sampleResponse),
    };
    for (const [key, value] of Object.entries(optional)) {
        if (value)
            properties[key] = value;
    }
    const measurements = {};
    for (const [key, value] of Object.entries(activity.measurements ?? {})) {
        if (typeof value === "number" && Number.isFinite(value))
            measurements[key] = value;
    }
    return {
        name: "Microsoft.ApplicationInsights.Event",
        time: formatUtc(options.time),
        iKey: options.instrumentationKey,
        tags: { "ai.cloud.role": options.agentId },
        data: {
            baseType: "EventData",
            baseData: { ver: 2, name: ACTIVITY_EVENT_NAME, properties, measurements },
        },
    };
}
/** Instrumentation key and ingestion endpoint from an App Insights connection string, or undefined. */
export function parseConnectionString(connectionString) {
    if (!connectionString)
        return undefined;
    const parts = new Map();
    for (const pair of connectionString.split(";")) {
        const at = pair.indexOf("=");
        if (at <= 0)
            continue;
        const key = pair.slice(0, at).trim().toLowerCase();
        const value = pair.slice(at + 1).trim();
        if (key && value)
            parts.set(key, value);
    }
    const instrumentationKey = parts.get("instrumentationkey");
    if (!instrumentationKey)
        return undefined;
    const ingestionEndpoint = (parts.get("ingestionendpoint") ?? DEFAULT_INGESTION_ENDPOINT).replace(/\/+$/, "");
    return { instrumentationKey, ingestionEndpoint };
}
//# sourceMappingURL=envelope.js.map