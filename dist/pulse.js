import { INGESTION_TIMEOUT_MS, parseConnectionString, toEnvelope } from "./envelope.js";
/** A pulse that does nothing, for tests and for agents with telemetry switched off. */
export const noopPulse = {
    emit: async () => { },
    flush: async () => { },
};
/**
 * Report activities to the agent's own Application Insights: one small POST
 * per event to the ingestion endpoint, no SDK. Failures are logged through
 * `warn` and the event is dropped; telemetry never fails the agent's work.
 */
export function createPulse(options) {
    const warn = options.warn ?? ((message) => console.warn(message));
    const connectionString = options.connectionString ?? process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const parsed = parseConnectionString(connectionString);
    if (!parsed) {
        warn("agent-pulse: APPLICATIONINSIGHTS_CONNECTION_STRING missing or invalid; activity will not be reported");
        return noopPulse;
    }
    if (!options.agentId) {
        warn("agent-pulse: agentId missing; activity will not be reported");
        return noopPulse;
    }
    const post = options.fetch ?? fetch;
    const now = options.now ?? (() => new Date());
    const url = `${parsed.ingestionEndpoint}/v2.1/track`;
    const inFlight = new Set();
    const send = async (activity) => {
        const type = String(activity?.activityType);
        try {
            const envelope = toEnvelope(activity, {
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
                signal: AbortSignal.timeout(INGESTION_TIMEOUT_MS),
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