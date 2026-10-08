# KnowAll.AgentPulse (.NET)

The .NET implementation of [agent-pulse](https://github.com/knowall-ai/agent-pulse): report what
your AI agent does as `AgentActivity` events to its own Application Insights. net8.0, no
dependencies beyond the BCL.

Until it is on NuGet, reference the project or pack it yourself:

```
dotnet add reference path/to/agent-pulse/dotnet/src/KnowAll.AgentPulse
# or
dotnet pack dotnet/src/KnowAll.AgentPulse -c Release -o ./nupkg
dotnet add package KnowAll.AgentPulse --source ./nupkg
```

See the [main README](https://github.com/knowall-ai/agent-pulse#readme) for usage and the
[AgentActivity v1 contract](https://github.com/knowall-ai/agent-pulse/blob/main/spec/AGENT-ACTIVITY.md).
