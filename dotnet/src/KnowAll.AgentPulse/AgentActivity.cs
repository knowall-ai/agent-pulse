namespace KnowAll.AgentPulse;

/// <summary>Severity of an activity, as the portal colours it.</summary>
public static class ActivityLevels
{
    public const string Info = "info";
    public const string Success = "success";
    public const string Warning = "warning";
    public const string Error = "error";

    /// <summary>Every valid level.</summary>
    public static readonly IReadOnlyList<string> All = [Info, Success, Warning, Error];
}

/// <summary>Where the agent acted. Absent means unknown.</summary>
public static class ActivityChannels
{
    public const string Email = "email";
    public const string Teams = "teams";
    public const string Web = "web";
    public const string Voice = "voice";
    public const string Api = "api";

    /// <summary>Every valid channel.</summary>
    public static readonly IReadOnlyList<string> All = [Email, Teams, Web, Voice, Api];
}

/// <summary>One thing an agent did. See spec/AGENT-ACTIVITY.md for the full contract.</summary>
public sealed record AgentActivity
{
    /// <summary>Dotted lowercase, e.g. <c>email.drafted</c>. Open set.</summary>
    public required string ActivityType { get; init; }

    /// <summary>Short, human-readable. Visible to customer viewers: never personal data.</summary>
    public required string Title { get; init; }

    /// <summary>One of <see cref="ActivityLevels"/>.</summary>
    public required string Level { get; init; }

    /// <summary>Stable id for dedupe. Use <see cref="AgentPulse.ActivityIdFrom"/>, never the raw id.</summary>
    public required string ActivityId { get; init; }

    /// <summary>One of <see cref="ActivityChannels"/>, or null for unknown.</summary>
    public string? Channel { get; init; }

    /// <summary>A fixed category bucket chosen by the agent, never free text.</summary>
    public string? Subject { get; init; }

    /// <summary>Short, non-PII detail, e.g. <c>confidence 0.91</c>.</summary>
    public string? Detail { get; init; }

    /// <summary>Who acted. Defaults to <see cref="PulseOptions.Actor"/>.</summary>
    public string? Actor { get; init; }

    public string? Url { get; init; }

    /// <summary>The activity this one is about, e.g. the draft an <c>email.compared</c> judges.</summary>
    public string? RelatedActivityId { get; init; }

    /// <summary>
    /// When it really happened, for late or backfilled reports: ISO-8601 UTC ending in <c>Z</c>.
    /// Use <see cref="AgentPulse.FormatUtc"/> to write one from a <see cref="DateTimeOffset"/>.
    /// </summary>
    public string? OccurredAt { get; init; }

    /// <summary>True for events reconstructed after the fact (e.g. from logs).</summary>
    public bool Backfilled { get; init; }

    /// <summary>Opt-in example input. Masked and truncated by the library; dropped unless samples are on.</summary>
    public string? SampleRequest { get; init; }

    /// <summary>Opt-in example output. Masked and truncated by the library; dropped unless samples are on.</summary>
    public string? SampleResponse { get; init; }

    /// <summary>Names and addresses already known for this item (e.g. the sender), masked everywhere in samples.</summary>
    public IReadOnlyList<string>? KnownNames { get; init; }

    /// <summary>Optional numbers, e.g. confidence. Non-finite values are dropped.</summary>
    public IReadOnlyDictionary<string, double>? Measurements { get; init; }
}
