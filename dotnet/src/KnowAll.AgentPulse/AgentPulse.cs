using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace KnowAll.AgentPulse;

/// <summary>Options for <see cref="AgentPulse.Create"/>.</summary>
public sealed class PulseOptions
{
    /// <summary>The agent's own id: the value of its Azure <c>agent</c> tag.</summary>
    public required string AgentId { get; init; }

    /// <summary>App Insights connection string. Defaults to <c>APPLICATIONINSIGHTS_CONNECTION_STRING</c>.</summary>
    public string? ConnectionString { get; init; }

    /// <summary>Default actor for every activity.</summary>
    public string? Actor { get; init; }

    /// <summary>Send samples (masked, then truncated). Off by default.</summary>
    public bool Samples { get; init; }

    /// <summary>HttpClient to post with. Defaults to a shared client.</summary>
    public HttpClient? HttpClient { get; init; }

    /// <summary>Where warnings go. Defaults to standard error.</summary>
    public Action<string>? Warn { get; init; }

    /// <summary>Clock, for tests.</summary>
    public Func<DateTimeOffset>? Now { get; init; }
}

/// <summary>Reports activities. Never throws: failures are logged and the event dropped.</summary>
public interface IPulse
{
    /// <summary>Report one activity. Never throws; completes once the event is sent or dropped.</summary>
    Task EmitAsync(AgentActivity activity, CancellationToken cancellationToken = default);

    /// <summary>Wait for every emit still in flight. Never throws.</summary>
    Task FlushAsync();
}

/// <summary>Instrumentation key and ingestion endpoint parsed from a connection string.</summary>
public sealed record ConnectionInfo(string InstrumentationKey, string IngestionEndpoint);

/// <summary>The App Insights envelope sent for one activity.</summary>
public sealed record ActivityEnvelope(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("time")] string Time,
    [property: JsonPropertyName("iKey")] string IKey,
    [property: JsonPropertyName("tags")] IReadOnlyDictionary<string, string> Tags,
    [property: JsonPropertyName("data")] EnvelopeData Data);

/// <summary>The envelope's <c>data</c>.</summary>
public sealed record EnvelopeData(
    [property: JsonPropertyName("baseType")] string BaseType,
    [property: JsonPropertyName("baseData")] EventData BaseData);

/// <summary>The custom event itself.</summary>
public sealed record EventData(
    [property: JsonPropertyName("ver")] int Ver,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("properties")] IReadOnlyDictionary<string, string> Properties,
    [property: JsonPropertyName("measurements")] IReadOnlyDictionary<string, double> Measurements);

/// <summary>AgentActivity v1 events, sent straight to Application Insights. See spec/AGENT-ACTIVITY.md.</summary>
public static class AgentPulse
{
    public const string ActivityEventName = "AgentActivity";
    public const string SchemaVersion = "1";

    /// <summary>Samples are cut to this many characters (including the trailing ellipsis) after masking.</summary>
    public const int SampleMaxChars = 3500;

    /// <summary>One stalled ingestion call must not hold the agent.</summary>
    public static readonly TimeSpan IngestionTimeout = TimeSpan.FromSeconds(5);

    public const string DefaultIngestionEndpoint = "https://dc.services.visualstudio.com";

    private static readonly Regex ActivityTypePattern = new(@"^[a-z0-9]+(\.[a-z0-9_]+)+\z", RegexOptions.CultureInvariant);
    private static readonly Regex UtcTimestamp = new(@"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,7})?Z\z", RegexOptions.CultureInvariant);
    private static readonly HttpClient SharedClient = new();

    /// <summary>A pulse that does nothing, for tests and for agents with telemetry switched off.</summary>
    public static IPulse Noop { get; } = new NoopPulse();

    /// <summary>True when <paramref name="activityType"/> is dotted lowercase, e.g. <c>email.drafted</c>.</summary>
    public static bool ValidateActivityType(string? activityType) =>
        activityType is not null && ActivityTypePattern.IsMatch(activityType);

    /// <summary>A stable activity id from an upstream id: lowercase sha256 hex of its UTF-8 bytes.</summary>
    public static string ActivityIdFrom(string upstreamId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(upstreamId))).ToLowerInvariant();

    /// <summary>ISO-8601 UTC with milliseconds and a <c>Z</c>, the form every implementation writes.</summary>
    public static string FormatUtc(DateTimeOffset time) =>
        time.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    /// <summary>Instrumentation key and ingestion endpoint from a connection string, or null.</summary>
    public static ConnectionInfo? ParseConnectionString(string? connectionString)
    {
        if (string.IsNullOrEmpty(connectionString)) return null;
        var parts = new Dictionary<string, string>();
        foreach (var pair in connectionString.Split(';'))
        {
            var at = pair.IndexOf('=');
            if (at <= 0) continue;
            var key = pair[..at].Trim().ToLowerInvariant();
            var value = pair[(at + 1)..].Trim();
            if (key.Length > 0 && value.Length > 0) parts[key] = value;
        }
        if (!parts.TryGetValue("instrumentationkey", out var ikey)) return null;
        var endpoint = parts.TryGetValue("ingestionendpoint", out var e) ? e : DefaultIngestionEndpoint;
        return new ConnectionInfo(ikey, endpoint.TrimEnd('/'));
    }

    /// <summary>
    /// The App Insights envelope for one activity. Throws <see cref="ArgumentException"/> on a contract
    /// violation; <see cref="Create"/> catches that, logs it and drops the event.
    /// </summary>
    public static ActivityEnvelope ToEnvelope(
        AgentActivity activity,
        string agentId,
        string instrumentationKey,
        DateTimeOffset time,
        string? actor = null,
        bool samples = false)
    {
        if (string.IsNullOrEmpty(agentId)) throw new ArgumentException("agentId is required");
        if (!ValidateActivityType(activity.ActivityType)) throw new ArgumentException($"invalid activityType \"{activity.ActivityType}\"");
        if (string.IsNullOrEmpty(activity.Title)) throw new ArgumentException("title is required");
        if (string.IsNullOrEmpty(activity.ActivityId)) throw new ArgumentException("activityId is required");
        if (!ActivityLevels.All.Contains(activity.Level)) throw new ArgumentException($"invalid level \"{activity.Level}\"");
        if (activity.Channel is not null && !ActivityChannels.All.Contains(activity.Channel))
            throw new ArgumentException($"invalid channel \"{activity.Channel}\"");
        if (!string.IsNullOrEmpty(activity.OccurredAt) && !UtcTimestamp.IsMatch(activity.OccurredAt))
            throw new ArgumentException($"occurredAt must be ISO-8601 UTC ending in Z, got \"{activity.OccurredAt}\"");

        var known = activity.KnownNames ?? [];
        string? Sample(string? text) => samples && !string.IsNullOrEmpty(text) ? Truncate(PiiMask.MaskPii(text, known)) : null;

        var properties = new Dictionary<string, string>
        {
            ["schemaVersion"] = SchemaVersion,
            ["agentId"] = agentId,
            ["activityType"] = activity.ActivityType,
            ["title"] = activity.Title,
            ["level"] = activity.Level,
            ["activityId"] = activity.ActivityId,
        };
        var optional = new (string Key, string? Value)[]
        {
            ("subject", activity.Subject),
            ("detail", activity.Detail),
            ("actor", string.IsNullOrEmpty(activity.Actor) ? actor : activity.Actor),
            ("url", activity.Url),
            ("relatedActivityId", activity.RelatedActivityId),
            ("channel", activity.Channel),
            ("occurredAt", activity.OccurredAt),
            ("backfilled", activity.Backfilled ? "true" : null),
            ("sampleRequest", Sample(activity.SampleRequest)),
            ("sampleResponse", Sample(activity.SampleResponse)),
        };
        foreach (var (key, value) in optional)
        {
            if (!string.IsNullOrEmpty(value)) properties[key] = value;
        }

        var measurements = new Dictionary<string, double>();
        foreach (var (key, value) in activity.Measurements ?? new Dictionary<string, double>())
        {
            if (double.IsFinite(value)) measurements[key] = value;
        }

        return new ActivityEnvelope(
            "Microsoft.ApplicationInsights.Event",
            FormatUtc(time),
            instrumentationKey,
            new Dictionary<string, string> { ["ai.cloud.role"] = agentId },
            new EnvelopeData("EventData", new EventData(2, ActivityEventName, properties, measurements)));
    }

    /// <summary>
    /// Report activities to the agent's own Application Insights: one small POST per event, no SDK.
    /// Without a connection string (or agent id) a warning is logged once and <see cref="Noop"/> returned.
    /// </summary>
    public static IPulse Create(PulseOptions options)
    {
        var warn = options.Warn ?? (message => Console.Error.WriteLine(message));
        var parsed = ParseConnectionString(
            options.ConnectionString ?? Environment.GetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING"));
        if (parsed is null)
        {
            warn("agent-pulse: APPLICATIONINSIGHTS_CONNECTION_STRING missing or invalid; activity will not be reported");
            return Noop;
        }
        if (string.IsNullOrEmpty(options.AgentId))
        {
            warn("agent-pulse: agentId missing; activity will not be reported");
            return Noop;
        }
        return new AppInsightsPulse(options, parsed, warn);
    }

    private static string Truncate(string text) =>
        text.Length > SampleMaxChars ? string.Concat(text.AsSpan(0, SampleMaxChars - 1), "…") : text;

    private sealed class NoopPulse : IPulse
    {
        public Task EmitAsync(AgentActivity activity, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task FlushAsync() => Task.CompletedTask;
    }

    private sealed class AppInsightsPulse(PulseOptions options, ConnectionInfo connection, Action<string> warn) : IPulse
    {
        private readonly HttpClient _client = options.HttpClient ?? SharedClient;
        private readonly Uri _url = new($"{connection.IngestionEndpoint}/v2.1/track");
        private readonly Func<DateTimeOffset> _now = options.Now ?? (() => DateTimeOffset.UtcNow);
        private readonly ConcurrentDictionary<Task, byte> _inFlight = new();

        public Task EmitAsync(AgentActivity activity, CancellationToken cancellationToken = default)
        {
            var task = SendAsync(activity, cancellationToken);
            _inFlight.TryAdd(task, 0);
            _ = task.ContinueWith(t => _inFlight.TryRemove(t, out _), TaskScheduler.Default);
            return task;
        }

        public Task FlushAsync() => Task.WhenAll(_inFlight.Keys.ToArray());

        private async Task SendAsync(AgentActivity activity, CancellationToken cancellationToken)
        {
            var kind = activity?.ActivityType ?? "activity";
            try
            {
                var envelope = ToEnvelope(activity!, options.AgentId, connection.InstrumentationKey, _now(), options.Actor, options.Samples);
                var body = JsonSerializer.Serialize(new[] { envelope });
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                timeout.CancelAfter(IngestionTimeout);
                using var content = new StringContent(body, Encoding.UTF8);
                content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
                using var response = await _client.PostAsync(_url, content, timeout.Token).ConfigureAwait(false);
                if (!response.IsSuccessStatusCode)
                    warn($"agent-pulse: ingestion returned HTTP {(int)response.StatusCode} for {kind}");
            }
            catch (Exception error)
            {
                warn($"agent-pulse: dropped {kind}: {error.Message}");
            }
        }
    }
}
