import { afterEach, describe, expect, it, vi } from "vitest";
import { createPulse, noopPulse, toEnvelope, type AgentActivity } from "../src/index.js";

const ACTIVITY: AgentActivity = {
  activityType: "email.drafted",
  title: "Drafted reply · billing",
  level: "success",
  activityId: "a".repeat(64),
  channel: "email",
  subject: "billing",
  measurements: { confidence: 0.9 },
};

const CONNECTION =
  "InstrumentationKey=ikey-1;IngestionEndpoint=https://uksouth-1.in.applicationinsights.azure.com/;LiveEndpoint=https://x";

const ok = () => vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200 }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createPulse", () => {
  it("posts one envelope to the ingestion endpoint from the connection string", async () => {
    const fetchMock = ok();
    const pulse = createPulse({
      connectionString: CONNECTION,
      agentId: "acme-helpdesk",
      fetch: fetchMock as unknown as typeof fetch,
      now: () => new Date("2026-10-08T10:00:00Z"),
    });
    await pulse.emit(ACTIVITY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://uksouth-1.in.applicationinsights.azure.com/v2.1/track");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toEqual([
      toEnvelope(ACTIVITY, { agentId: "acme-helpdesk", instrumentationKey: "ikey-1", time: new Date("2026-10-08T10:00:00Z") }),
    ]);
  });

  it("sends with a 5 second timeout signal", async () => {
    const fetchMock = ok();
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const pulse = createPulse({ connectionString: CONNECTION, agentId: "a", fetch: fetchMock as unknown as typeof fetch });
    await pulse.emit(ACTIVITY);
    expect(timeout).toHaveBeenCalledWith(5000);
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("reads the connection string from APPLICATIONINSIGHTS_CONNECTION_STRING", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=from-env");
    const fetchMock = ok();
    const pulse = createPulse({ agentId: "a", fetch: fetchMock as unknown as typeof fetch });
    await pulse.emit(ACTIVITY);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://dc.services.visualstudio.com/v2.1/track");
    expect(JSON.parse(String(init.body))[0].iKey).toBe("from-env");
  });

  it("is a no-op, with one warning, without a connection string", async () => {
    vi.stubEnv("APPLICATIONINSIGHTS_CONNECTION_STRING", "");
    const warn = vi.fn();
    const fetchMock = ok();
    const pulse = createPulse({ agentId: "a", warn, fetch: fetchMock as unknown as typeof fetch });
    await expect(pulse.emit(ACTIVITY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the network fails", async () => {
    const warn = vi.fn();
    const pulse = createPulse({
      connectionString: CONNECTION,
      agentId: "a",
      warn,
      fetch: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    await expect(pulse.emit(ACTIVITY)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("warns on a non-2xx response", async () => {
    const warn = vi.fn();
    const pulse = createPulse({
      connectionString: CONNECTION,
      agentId: "a",
      warn,
      fetch: (async () => new Response("bad", { status: 400 })) as unknown as typeof fetch,
    });
    await pulse.emit(ACTIVITY);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 400"));
  });

  it("drops an invalid activity with a warning instead of throwing", async () => {
    const warn = vi.fn();
    const fetchMock = ok();
    const pulse = createPulse({ connectionString: CONNECTION, agentId: "a", warn, fetch: fetchMock as unknown as typeof fetch });
    await expect(pulse.emit({ ...ACTIVITY, activityType: "Not Valid" })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid activityType"));
  });

  it("drops samples unless samples is on, and masks them when it is", async () => {
    const fetchMock = ok();
    const withSample = { ...ACTIVITY, sampleRequest: "Hi Alex, mail me at alex@example.com", knownNames: ["Alex"] };
    await createPulse({ connectionString: CONNECTION, agentId: "a", fetch: fetchMock as unknown as typeof fetch }).emit(withSample);
    await createPulse({ connectionString: CONNECTION, agentId: "a", samples: true, fetch: fetchMock as unknown as typeof fetch }).emit(
      withSample,
    );
    const props = (i: number) =>
      JSON.parse(String((fetchMock.mock.calls[i] as [string, RequestInit])[1].body))[0].data.baseData.properties;
    expect(props(0).sampleRequest).toBeUndefined();
    expect(props(1).sampleRequest).toBe("Hi *****, mail me at *****");
  });

  it("writes a Date occurredAt as ISO-8601 UTC", async () => {
    const envelope = toEnvelope(
      { ...ACTIVITY, occurredAt: new Date(Date.UTC(2026, 8, 1, 8, 0, 0)) },
      { agentId: "a", instrumentationKey: "k", time: new Date() },
    );
    expect(envelope.data.baseData.properties.occurredAt).toBe("2026-09-01T08:00:00.000Z");
  });

  it("flush waits for emits still in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let done = false;
    const pulse = createPulse({
      connectionString: CONNECTION,
      agentId: "a",
      fetch: (async () => {
        await gate;
        done = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    void pulse.emit(ACTIVITY);
    const flushed = pulse.flush();
    expect(done).toBe(false);
    release();
    await flushed;
    expect(done).toBe(true);
  });
});

describe("noopPulse", () => {
  it("accepts anything and does nothing", async () => {
    await expect(noopPulse.emit(ACTIVITY)).resolves.toBeUndefined();
    await expect(noopPulse.flush()).resolves.toBeUndefined();
  });
});
