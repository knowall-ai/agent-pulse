using System.Net;
using System.Text.Json.Nodes;

namespace KnowAll.AgentPulse.Tests;

public class PulseTests
{
    private const string Connection =
        "InstrumentationKey=ikey-1;IngestionEndpoint=https://uksouth-1.in.applicationinsights.azure.com/;LiveEndpoint=https://x";

    private static readonly AgentActivity Activity = new()
    {
        ActivityType = "email.drafted",
        Title = "Drafted reply · billing",
        Level = ActivityLevels.Success,
        ActivityId = new string('a', 64),
        Channel = ActivityChannels.Email,
        Subject = "billing",
        Measurements = new Dictionary<string, double> { ["confidence"] = 0.9 },
    };

    private sealed class Recorder(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>>? respond = null) : HttpMessageHandler
    {
        public List<(HttpRequestMessage Request, string Body)> Calls { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Calls.Add((request, await request.Content!.ReadAsStringAsync(cancellationToken)));
            return respond is null ? new HttpResponseMessage(HttpStatusCode.OK) : await respond(request, cancellationToken);
        }

        public JsonObject Envelope(int i = 0) => JsonNode.Parse(Calls[i].Body)!.AsArray()[0]!.AsObject();
    }

    private static IPulse Pulse(Recorder recorder, List<string>? warnings = null, bool samples = false) => AgentPulse.Create(new PulseOptions
    {
        ConnectionString = Connection,
        AgentId = "acme-helpdesk",
        HttpClient = new HttpClient(recorder),
        Warn = warnings is null ? _ => { } : warnings.Add,
        Samples = samples,
        Now = () => new DateTimeOffset(2026, 10, 8, 10, 0, 0, TimeSpan.Zero),
    });

    [Fact]
    public async Task PostsOneEnvelopeToTheIngestionEndpoint()
    {
        var recorder = new Recorder();
        await Pulse(recorder).EmitAsync(Activity);
        var (request, _) = recorder.Calls.Single();
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://uksouth-1.in.applicationinsights.azure.com/v2.1/track", request.RequestUri!.ToString());
        Assert.Equal("application/json", request.Content!.Headers.ContentType!.MediaType);
        var envelope = recorder.Envelope();
        Assert.Equal("ikey-1", envelope["iKey"]!.GetValue<string>());
        Assert.Equal("2026-10-08T10:00:00.000Z", envelope["time"]!.GetValue<string>());
        var baseData = envelope["data"]!["baseData"]!;
        Assert.Equal("AgentActivity", baseData["name"]!.GetValue<string>());
        Assert.Equal("Drafted reply · billing", baseData["properties"]!["title"]!.GetValue<string>());
        Assert.Equal(0.9, baseData["measurements"]!["confidence"]!.GetValue<double>());
    }

    [Fact]
    public async Task ReadsTheConnectionStringFromTheEnvironment()
    {
        var recorder = new Recorder();
        Environment.SetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=from-env");
        try
        {
            await AgentPulse.Create(new PulseOptions { AgentId = "a", HttpClient = new HttpClient(recorder) }).EmitAsync(Activity);
        }
        finally
        {
            Environment.SetEnvironmentVariable("APPLICATIONINSIGHTS_CONNECTION_STRING", null);
        }
        Assert.Equal("https://dc.services.visualstudio.com/v2.1/track", recorder.Calls[0].Request.RequestUri!.ToString());
        Assert.Equal("from-env", recorder.Envelope()["iKey"]!.GetValue<string>());
    }

    [Fact]
    public async Task IsANoopWithOneWarningWithoutAConnectionString()
    {
        var warnings = new List<string>();
        var pulse = AgentPulse.Create(new PulseOptions { AgentId = "a", ConnectionString = "", Warn = warnings.Add });
        await pulse.EmitAsync(Activity);
        Assert.Same(AgentPulse.Noop, pulse);
        Assert.Single(warnings);
    }

    [Fact]
    public async Task NeverThrowsWhenTheNetworkFails()
    {
        var warnings = new List<string>();
        var recorder = new Recorder((_, _) => throw new HttpRequestException("network down"));
        await Pulse(recorder, warnings).EmitAsync(Activity);
        Assert.Contains("network down", warnings.Single());
    }

    [Fact]
    public async Task WarnsOnANon2xxResponse()
    {
        var warnings = new List<string>();
        var recorder = new Recorder((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.BadRequest)));
        await Pulse(recorder, warnings).EmitAsync(Activity);
        Assert.Contains("HTTP 400", warnings.Single());
    }

    [Fact]
    public async Task GivesUpAfterTheTimeoutWithoutThrowing()
    {
        var warnings = new List<string>();
        var recorder = new Recorder(async (_, ct) =>
        {
            await Task.Delay(Timeout.Infinite, ct);
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var started = DateTime.UtcNow;
        await Pulse(recorder, warnings).EmitAsync(Activity);
        Assert.InRange(DateTime.UtcNow - started, TimeSpan.FromSeconds(4), TimeSpan.FromSeconds(10));
        Assert.Contains("dropped", warnings.Single());
    }

    [Fact]
    public async Task DropsAnInvalidActivityWithAWarning()
    {
        var warnings = new List<string>();
        var recorder = new Recorder();
        await Pulse(recorder, warnings).EmitAsync(Activity with { ActivityType = "Not Valid" });
        Assert.Empty(recorder.Calls);
        Assert.Contains("invalid activityType", warnings.Single());
    }

    [Fact]
    public async Task SamplesAreDroppedUnlessOnAndMaskedWhenOn()
    {
        var withSample = Activity with { SampleRequest = "Hi Alex, mail me at alex@example.com", KnownNames = ["Alex"] };
        var off = new Recorder();
        var on = new Recorder();
        await Pulse(off).EmitAsync(withSample);
        await Pulse(on, samples: true).EmitAsync(withSample);
        Assert.Null(off.Envelope()["data"]!["baseData"]!["properties"]!["sampleRequest"]);
        Assert.Equal("Hi *****, mail me at *****", on.Envelope()["data"]!["baseData"]!["properties"]!["sampleRequest"]!.GetValue<string>());
    }

    [Fact]
    public void FormatUtcWritesMillisecondsAndZ() =>
        Assert.Equal("2026-09-01T08:00:00.000Z", AgentPulse.FormatUtc(new DateTimeOffset(2026, 9, 1, 9, 0, 0, TimeSpan.FromHours(1))));

    [Fact]
    public async Task FlushWaitsForEmitsInFlight()
    {
        var gate = new TaskCompletionSource();
        var done = false;
        var recorder = new Recorder(async (_, _) =>
        {
            await gate.Task;
            done = true;
            return new HttpResponseMessage(HttpStatusCode.OK);
        });
        var pulse = Pulse(recorder);
        _ = pulse.EmitAsync(Activity);
        var flushed = pulse.FlushAsync();
        Assert.False(done);
        gate.SetResult();
        await flushed;
        Assert.True(done);
    }

    [Fact]
    public async Task NoopDoesNothing()
    {
        await AgentPulse.Noop.EmitAsync(Activity);
        await AgentPulse.Noop.FlushAsync();
    }
}
