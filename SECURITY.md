# Security Policy

Pulse runs inside AI agents and sends what they do to Application Insights. A vulnerability in it
could leak an agent's telemetry credentials or the personal data of the people the agent serves,
so please report anything you find, and please do it privately.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: on this repository, go to
**Security → Advisories → Report a vulnerability**. Only the maintainers can see the report.

If you cannot use GitHub, email **support@knowall.ai** with the subject line
`Security: agent-pulse`. **Put no vulnerability details in the first message.** Say only that you
have a security report and ask for an encryption key; we will reply with a PGP public key and a
named contact, and you send the details encrypted.

Include what you can: the version or commit, the implementation (TypeScript, Python, .NET),
steps to reproduce, and the impact you believe it has. A minimal proof of concept is welcome;
please do not run it against an Application Insights resource you do not own.

## What to expect

- **Acknowledgement within 3 working days.**
- **An initial assessment within 10 working days**, with a severity and a plan.
- **A fix for confirmed high or critical issues within 30 days**, sooner where practical. Lower
  severities are scheduled into the next release.
- We will keep you informed, credit you in the release notes if you wish, and tell you before
  anything about the report is made public.

We do not run a paid bug bounty at present.

## Scope

In scope: this repository's code, the published packages, and the way they handle connection
strings, instrumentation keys and sample text.

Things we would particularly like to hear about:

- Personal data that `maskPii` should catch under its documented rules but does not, in a way
  that would reach a sample. (Free-standing names with no cue are a documented limitation; see
  the README's privacy section.)
- Any path by which samples are sent while samples are off, or sent unmasked or untruncated.
- Connection strings, instrumentation keys or sample text leaking through logs, warnings or
  error messages.
- Ways a crafted activity could make the library throw into the calling agent, hang it past the
  timeout, or send to an endpoint other than the one in the connection string.

Out of scope: vulnerabilities in Application Insights, Node.js, Python or .NET themselves (please
report those upstream), issues that require an already-compromised host, and findings from
automated scanners with no demonstrated impact.

## Safe harbour

If you make a good-faith effort to follow this policy, we will not pursue legal action or a
complaint to your provider, and we will work with you to understand and resolve the issue quickly.
Please avoid privacy violations, data destruction, and disruption of KnowAll's or its clients'
agents while researching.

## Supported versions

Security fixes are made on the latest release only. Please upgrade before reporting if you are on
an older version and the problem may already be fixed.
