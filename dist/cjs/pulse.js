"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noopPulse = void 0;
exports.createPulse = createPulse;
const envelope_js_1 = require("./envelope.js");
/** A pulse that does nothing, for tests and for agents with telemetry switched off. */
exports.noopPulse = {
    emit: async () => { },
    flush: async () => { },
};
/**
 * Report activities to the agent's own Application Insights: one small POST
 * per event to the ingestion endpoint, no SDK. Failures are logged through
 * `warn` and the event is dropped; telemetry never fails the agent's work.
 */
function createPulse(options) {
    const warn = options.warn ?? ((message) => console.warn(message));
    const connectionString = options.connectionString ?? process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const parsed = (0, envelope_js_1.parseConnectionString)(connectionString);
    if (!parsed) {
        warn("agent-pulse: APPLICATIONINSIGHTS_CONNECTION_STRING missing or invalid; activity will not be reported");
        return exports.noopPulse;
    }
    if (!options.agentId) {
        warn("agent-pulse: agentId missing; activity will not be reported");
        return exports.noopPulse;
    }
    const post = options.fetch ?? fetch;
    const now = options.now ?? (() => new Date());
    const url = `${parsed.ingestionEndpoint}/v2.1/track`;
    const inFlight = new Set();
    const send = async (activity) => {
        const type = String(activity?.activityType);
        try {
            const envelope = (0, envelope_js_1.toEnvelope)(activity, {
                agentId: options.agentId,
                instrumentationKey: parsed.instrumentationKey,
                time: now(),
                actor: options.actor,
                samples: options.samples === true,
            });
            const response = await post(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([envelope]),
                signal: AbortSignal.timeout(envelope_js_1.INGESTION_TIMEOUT_MS),
            });
            if (!response.ok)
                warn(`agent-pulse: ingestion returned HTTP ${response.status} for ${type}`);
        }
        catch (error) {
            warn(`agent-pulse: dropped ${type}: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    return {
        emit(activity) {
            const task = send(activity);
            inFlight.add(task);
            void task.finally(() => inFlight.delete(task));
            return task;
        },
        async flush() {
            await Promise.allSettled([...inFlight]);
        },
    };
}
//# sourceMappingURL=pulse.js.map