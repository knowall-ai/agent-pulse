import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SENT_AS_IS,
  activityIdFrom,
  editDistance,
  maskPii,
  parseConnectionString,
  similarity,
  stripQuoted,
  toEnvelope,
  validateActivityType,
  type AgentActivity,
} from "../src/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const vectors = JSON.parse(readFileSync(new URL("../spec/test-vectors.json", import.meta.url), "utf8"));

/** `{repeat, times, suffix?}` → the repeated string; anything else unchanged. */
function expand(value: any): any {
  if (value && typeof value === "object" && "repeat" in value) {
    return String(value.repeat).repeat(value.times) + (value.suffix ?? "");
  }
  return value;
}

function toActivity(raw: any): AgentActivity {
  const activity = { ...raw };
  for (const key of ["sampleRequest", "sampleResponse"]) if (key in activity) activity[key] = expand(activity[key]);
  if (activity.measurements) {
    activity.measurements = Object.fromEntries(
      Object.entries(activity.measurements).map(([k, v]) => [k, v === "NaN" ? NaN : v === "Infinity" ? Infinity : v]),
    );
  }
  return activity;
}

describe("envelope vectors", () => {
  for (const vector of vectors.envelopes) {
    it(vector.name, () => {
      const options = { ...vector.options, time: new Date(vector.options.time) };
      const build = () => toEnvelope(toActivity(vector.activity), options);
      if (vector.error) {
        expect(build).toThrow();
        return;
      }
      const envelope = build();
      const expected = vector.expected;
      expect(envelope.name).toBe(expected.name);
      expect(envelope.time).toBe(expected.time);
      expect(envelope.iKey).toBe(expected.iKey);
      expect(envelope.tags).toEqual(expected.tags);
      expect(envelope.data.baseType).toBe(expected.baseType);
      expect(envelope.data.baseData.name).toBe(expected.eventName);
      expect(envelope.data.baseData.ver).toBe(expected.ver);
      const properties = Object.fromEntries(Object.entries(expected.properties).map(([k, v]) => [k, expand(v)]));
      expect(envelope.data.baseData.properties).toEqual(properties);
      expect(envelope.data.baseData.measurements).toEqual(expected.measurements);
    });
  }
});

describe("activity type vectors", () => {
  it.each(vectors.activityTypes.valid as string[])("accepts %j", (type) => {
    expect(validateActivityType(type)).toBe(true);
  });
  it.each(vectors.activityTypes.invalid as string[])("rejects %j", (type) => {
    expect(validateActivityType(type)).toBe(false);
  });
});

describe("activityIdFrom vectors", () => {
  it.each(vectors.activityIdFrom as Array<{ input: string; expected: string }>)("hashes $input", ({ input, expected }) => {
    expect(activityIdFrom(input)).toBe(expected);
  });
});

describe("connection string vectors", () => {
  it.each(vectors.connectionStrings as Array<{ input: string; expected: unknown }>)("parses $input", ({ input, expected }) => {
    expect(parseConnectionString(input) ?? null).toEqual(expected);
  });
});

describe("masking vectors", () => {
  it.each(vectors.masking as Array<{ text: string; known: string[]; expected: string }>)(
    "masks $text",
    ({ text, known, expected }) => {
      expect(maskPii(text, known)).toBe(expected);
      // Masking is idempotent: running it again on masked text changes nothing.
      expect(maskPii(expected, known)).toBe(expected);
    },
  );
});

describe("comparison vectors", () => {
  it.each(vectors.comparison as Array<{ a: string; b: string; similarity: number; editDistance: number; sentAsIs: boolean }>)(
    "compares $a / $b",
    (v) => {
      expect(similarity(v.a, v.b)).toBeCloseTo(v.similarity, 9);
      expect(editDistance(v.a, v.b)).toBe(v.editDistance);
      expect(similarity(v.a, v.b) >= SENT_AS_IS).toBe(v.sentAsIs);
    },
  );
});

describe("stripQuoted vectors", () => {
  it.each(vectors.stripQuoted as Array<{ input: string; expected: string }>)("strips $input", ({ input, expected }) => {
    expect(stripQuoted(input)).toBe(expected);
  });
});
