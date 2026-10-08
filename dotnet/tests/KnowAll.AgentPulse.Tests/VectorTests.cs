using System.Text.Json;
using System.Text.Json.Nodes;

namespace KnowAll.AgentPulse.Tests;

/// <summary>Every implementation runs the same vectors: spec/test-vectors.json.</summary>
public class VectorTests
{
    private static readonly JsonObject Vectors =
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "test-vectors.json")))!.AsObject();

    private static IEnumerable<object[]> Section(string name) =>
        Vectors[name]!.AsArray().Select((_, i) => new object[] { i });

    public static IEnumerable<object[]> Envelopes => Section("envelopes");
    public static IEnumerable<object[]> IdVectors => Section("activityIdFrom");
    public static IEnumerable<object[]> ConnectionVectors => Section("connectionStrings");
    public static IEnumerable<object[]> MaskVectors => Section("masking");
    public static IEnumerable<object[]> ComparisonVectors => Section("comparison");
    public static IEnumerable<object[]> StripVectors => Section("stripQuoted");
    public static IEnumerable<object[]> ValidTypes => Vectors["activityTypes"]!["valid"]!.AsArray().Select(n => new object[] { n!.GetValue<string>() });
    public static IEnumerable<object[]> InvalidTypes => Vectors["activityTypes"]!["invalid"]!.AsArray().Select(n => new object[] { n!.GetValue<string>() });

    /// <summary>{repeat, times, suffix?} becomes the repeated string; plain strings pass through.</summary>
    private static string? Expand(JsonNode? node)
    {
        if (node is null) return null;
        if (node is JsonObject o)
            return string.Concat(Enumerable.Repeat(o["repeat"]!.GetValue<string>(), o["times"]!.GetValue<int>())) +
                   (o["suffix"]?.GetValue<string>() ?? "");
        return node.GetValue<string>();
    }

    private static string? Str(JsonObject o, string key) => o[key] is null ? null : Expand(o[key]);

    private static AgentActivity ToActivity(JsonObject a)
    {
        Dictionary<string, double>? measurements = null;
        if (a["measurements"] is JsonObject m)
        {
            measurements = m.ToDictionary(kv => kv.Key, kv => kv.Value!.GetValueKind() == JsonValueKind.String
                ? double.Parse(kv.Value.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture)
                : kv.Value.GetValue<double>());
        }
        return new AgentActivity
        {
            ActivityType = Str(a, "activityType")!,
            Title = Str(a, "title")!,
            Level = Str(a, "level")!,
            ActivityId = Str(a, "activityId")!,
            Channel = Str(a, "channel"),
            Subject = Str(a, "subject"),
            Detail = Str(a, "detail"),
            Actor = Str(a, "actor"),
            Url = Str(a, "url"),
            RelatedActivityId = Str(a, "relatedActivityId"),
            OccurredAt = Str(a, "occurredAt"),
            Backfilled = a["backfilled"]?.GetValue<bool>() ?? false,
            SampleRequest = Str(a, "sampleRequest"),
            SampleResponse = Str(a, "sampleResponse"),
            KnownNames = a["knownNames"]?.AsArray().Select(n => n!.GetValue<string>()).ToList(),
            Measurements = measurements,
        };
    }

    [Theory]
    [MemberData(nameof(Envelopes))]
    public void Envelope(int index)
    {
        var v = Vectors["envelopes"]![index]!.AsObject();
        var o = v["options"]!.AsObject();
        ActivityEnvelope Build() => AgentPulse.ToEnvelope(
            ToActivity(v["activity"]!.AsObject()),
            o["agentId"]!.GetValue<string>(),
            o["instrumentationKey"]!.GetValue<string>(),
            DateTimeOffset.Parse(o["time"]!.GetValue<string>(), System.Globalization.CultureInfo.InvariantCulture),
            o["actor"]?.GetValue<string>(),
            o["samples"]?.GetValue<bool>() ?? false);

        if (v["error"]?.GetValue<bool>() == true)
        {
            Assert.ThrowsAny<ArgumentException>(Build);
            return;
        }
        var envelope = Build();
        var e = v["expected"]!.AsObject();
        Assert.Equal(e["name"]!.GetValue<string>(), envelope.Name);
        Assert.Equal(e["time"]!.GetValue<string>(), envelope.Time);
        Assert.Equal(e["iKey"]!.GetValue<string>(), envelope.IKey);
        Assert.Equal(e["tags"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<string>()), envelope.Tags);
        Assert.Equal(e["baseType"]!.GetValue<string>(), envelope.Data.BaseType);
        Assert.Equal(e["eventName"]!.GetValue<string>(), envelope.Data.BaseData.Name);
        Assert.Equal(e["ver"]!.GetValue<int>(), envelope.Data.BaseData.Ver);
        Assert.Equal(
            e["properties"]!.AsObject().ToDictionary(kv => kv.Key, kv => Expand(kv.Value)!),
            envelope.Data.BaseData.Properties);
        Assert.Equal(
            e["measurements"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.GetValue<double>()),
            envelope.Data.BaseData.Measurements);
    }

    [Theory]
    [MemberData(nameof(ValidTypes))]
    public void AcceptsValidActivityType(string type) => Assert.True(AgentPulse.ValidateActivityType(type));

    [Theory]
    [MemberData(nameof(InvalidTypes))]
    public void RejectsInvalidActivityType(string type) => Assert.False(AgentPulse.ValidateActivityType(type));

    [Theory]
    [MemberData(nameof(IdVectors))]
    public void ActivityIdFrom(int index)
    {
        var v = Vectors["activityIdFrom"]![index]!;
        Assert.Equal(v["expected"]!.GetValue<string>(), AgentPulse.ActivityIdFrom(v["input"]!.GetValue<string>()));
    }

    [Theory]
    [MemberData(nameof(ConnectionVectors))]
    public void ConnectionString(int index)
    {
        var v = Vectors["connectionStrings"]![index]!;
        var parsed = AgentPulse.ParseConnectionString(v["input"]!.GetValue<string>());
        if (v["expected"] is null)
        {
            Assert.Null(parsed);
            return;
        }
        Assert.Equal(
            new ConnectionInfo(v["expected"]!["instrumentationKey"]!.GetValue<string>(), v["expected"]!["ingestionEndpoint"]!.GetValue<string>()),
            parsed);
    }

    [Theory]
    [MemberData(nameof(MaskVectors))]
    public void Masking(int index)
    {
        var v = Vectors["masking"]![index]!;
        var known = v["known"]!.AsArray().Select(n => n!.GetValue<string>()).ToList();
        var expected = v["expected"]!.GetValue<string>();
        Assert.Equal(expected, PiiMask.MaskPii(v["text"]!.GetValue<string>(), known));
        Assert.Equal(expected, PiiMask.MaskPii(expected, known));
    }

    [Theory]
    [MemberData(nameof(ComparisonVectors))]
    public void Comparison(int index)
    {
        var v = Vectors["comparison"]![index]!;
        string a = v["a"]!.GetValue<string>(), b = v["b"]!.GetValue<string>();
        Assert.Equal(v["similarity"]!.GetValue<double>(), EditComparison.Similarity(a, b), 9);
        Assert.Equal(v["editDistance"]!.GetValue<int>(), EditComparison.EditDistance(a, b));
        Assert.Equal(v["sentAsIs"]!.GetValue<bool>(), EditComparison.Similarity(a, b) >= EditComparison.SentAsIs);
    }

    [Theory]
    [MemberData(nameof(StripVectors))]
    public void StripQuoted(int index)
    {
        var v = Vectors["stripQuoted"]![index]!;
        Assert.Equal(v["expected"]!.GetValue<string>(), EditComparison.StripQuoted(v["input"]!.GetValue<string>()));
    }
}
