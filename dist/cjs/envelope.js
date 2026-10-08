"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVITY_CHANNELS = exports.ACTIVITY_LEVELS = exports.DEFAULT_INGESTION_ENDPOINT = exports.INGESTION_TIMEOUT_MS = exports.SAMPLE_MAX_CHARS = exports.ACTIVITY_SCHEMA_VERSION = exports.ACTIVITY_EVENT_NAME = void 0;
exports.validateActivityType = validateActivityType;
exports.activityIdFrom = activityIdFrom;
exports.formatUtc = formatUtc;
exports.toEnvelope = toEnvelope;
exports.parseConnectionString = parseConnectionString;
const node_crypto_1 = require("node:crypto");
const mask_js_1 = require("./mask.js");
exports.ACTIVITY_EVENT_NAME = "AgentActivity";
exports.ACTIVITY_SCHEMA_VERSION = "1";
/** Samples are cut to this many characters (including the trailing ellipsis) after masking. */
exports.SAMPLE_MAX_CHARS = 3500;
/** One stalled ingestion call must not hold the agent. */
exports.INGESTION_TIMEOUT_MS = 5000;
exports.DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com";
exports.ACTIVITY_LEVELS = ["info", "success", "warning", "error"];
exports.ACTIVITY_CHANNELS = ["email", "teams", "web", "voice", "api"];
const ACTIVITY_TYPE = /^[a-z0-9]+(\.[a-z0-9_]+)+$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/;
/** True when `activityType` is dotted lowercase, e.g. `email.drafted`. */
function validateActivityType(activityType) {
    return typeof activityType === "string" && ACTIVITY_TYPE.test(activityType);
}
/** A stable activity id from an upstream id: lowercase sha256 hex of its UTF-8 bytes. */
function activityIdFrom(upstreamId) {
    return (0, node_crypto_1.createHash)("sha256").update(upstreamId, "utf8").digest("hex");
}
/** ISO-8601 UTC with milliseconds and a `Z`, the form every implementation writes. */
function formatUtc(time) {
    return time.toISOString();
}
function truncate(text) {
    return text.length > exports.SAMPLE_MAX_CHARS ? `${text.slice(0, exports.SAMPLE_MAX_CHARS - 1)}…` : text;
}
/**
 * The App Insights envelope for one activity. Throws on a contract violation;
 * `createPulse` catches that, logs it and drops the event.
 */
function toEnvelope(activity, options) {
    if (!options.agentId)
        throw new Error("agentId is required");
    if (!validateActivityType(activity.activityType)) {
        throw new Error(`invalid activityType "${String(activity.activityType)}"`);
    }
    if (!activity.title)
        throw new Error("title is required");
    if (!activity.activityId)
        throw new Error("activityId is required");
    if (!exports.ACTIVITY_LEVELS.includes(activity.level)) {
        throw new Error(`invalid level "${String(activity.level)}"`);
    }
    if (activity.channel !== undefined && !exports.ACTIVITY_CHANNELS.includes(activity.channel)) {
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
    const sample = (text) => options.samples && text ? truncate((0, mask_js_1.maskPii)(text, known)) : undefined;
    const properties = {
        schemaVersion: exports.ACTIVITY_SCHEMA_VERSION,
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
            baseData: { ver: 2, name: exports.ACTIVITY_EVENT_NAME, properties, measurements },
        },
    };
}
/** Instrumentation key and ingestion endpoint from an App Insights connection string, or undefined. */
function parseConnectionString(connectionString) {
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
    const ingestionEndpoint = (parts.get("ingestionendpoint") ?? exports.DEFAULT_INGESTION_ENDPOINT).replace(/\/+$/, "");
    return { instrumentationKey, ingestionEndpoint };
}
//# sourceMappingURL=envelope.js.map