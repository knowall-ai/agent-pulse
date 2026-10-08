import type { Pulse } from "./types.js";
export interface PulseOptions {
    /** The agent's own id: the value of its Azure `agent` tag. */
    agentId: string;
    /** App Insights connection string. Defaults to `APPLICATIONINSIGHTS_CONNECTION_STRING`. */
    connectionString?: string;
    /** Default `actor` for every activity. */
    actor?: string;
    /** Send `sampleRequest` / `sampleResponse` (masked, then truncated). Off by default. */
    samples?: boolean;
    /** Injected for tests or custom transports. Defaults to the global fetch. */
    fetch?: typeof fetch;
    /** Where warnings go. Defaults to console.warn. */
    warn?: (message: string) => void;
    /** Clock, for tests. */
    now?: () => Date;
}
/** A pulse that does nothing, for tests and for agents with telemetry switched off. */
export declare const noopPulse: Pulse;
/**
 * Report activities to the agent's own Application Insights: one small POST
 * per event to the ingestion endpoint, no SDK. Failures are logged through
 * `warn` and the event is dropped; telemetry never fails the agent's work.
 */
export declare function createPulse(options: PulseOptions): Pulse;
//# sourceMappingURL=pulse.d.ts.map