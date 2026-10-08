"""AgentActivity v1 events, sent straight to Application Insights. See spec/AGENT-ACTIVITY.md."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Sequence, Union

from .mask import mask_pii

ACTIVITY_EVENT_NAME = "AgentActivity"
ACTIVITY_SCHEMA_VERSION = "1"
SAMPLE_MAX_CHARS = 3500
"""Samples are cut to this many characters (including the trailing ellipsis) after masking."""
INGESTION_TIMEOUT_SECONDS = 5.0
DEFAULT_INGESTION_ENDPOINT = "https://dc.services.visualstudio.com"
ACTIVITY_LEVELS = ("info", "success", "warning", "error")
ACTIVITY_CHANNELS = ("email", "teams", "web", "voice", "api")

_ACTIVITY_TYPE = re.compile(r"^[a-z0-9]+(\.[a-z0-9_]+)+$", re.ASCII)
_UTC_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$", re.ASCII)

_log = logging.getLogger("agent_pulse")

Transport = Callable[[str, bytes, Mapping[str, str], float], int]
"""``transport(url, body, headers, timeout_seconds) -> HTTP status``. May raise; the pulse catches it."""


@dataclass
class AgentActivity:
    """One thing an agent did. Field names are the contract's, in snake_case."""

    activity_type: str
    title: str
    level: str
    activity_id: str
    channel: str | None = None
    subject: str | None = None
    detail: str | None = None
    actor: str | None = None
    url: str | None = None
    related_activity_id: str | None = None
    occurred_at: Union[str, datetime, None] = None
    backfilled: bool = False
    sample_request: str | None = None
    sample_response: str | None = None
    known_names: Sequence[str] = field(default_factory=tuple)
    measurements: Mapping[str, float] | None = None


ActivityLike = Union[AgentActivity, Mapping[str, Any]]


def validate_activity_type(activity_type: str) -> bool:
    """True when ``activity_type`` is dotted lowercase, e.g. ``email.drafted``."""
    return isinstance(activity_type, str) and _ACTIVITY_TYPE.fullmatch(activity_type) is not None


def activity_id_from(upstream_id: str) -> str:
    """A stable activity id from an upstream id: lowercase sha256 hex of its UTF-8 bytes."""
    return hashlib.sha256(upstream_id.encode("utf-8")).hexdigest()


def format_utc(time: datetime) -> str:
    """ISO-8601 UTC with milliseconds and a ``Z``, the form every implementation writes."""
    if time.tzinfo is None:
        raise ValueError("datetime must be timezone-aware")
    utc = time.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def _truncate(text: str) -> str:
    return text[: SAMPLE_MAX_CHARS - 1] + "…" if len(text) > SAMPLE_MAX_CHARS else text


def _kind(activity: object) -> str:
    if isinstance(activity, AgentActivity):
        return str(activity.activity_type)
    if isinstance(activity, Mapping):
        return str(activity.get("activity_type"))
    return "activity"


def _as_activity(activity: ActivityLike) -> AgentActivity:
    return activity if isinstance(activity, AgentActivity) else AgentActivity(**dict(activity))


def to_envelope(
    activity: ActivityLike,
    *,
    agent_id: str,
    instrumentation_key: str,
    time: datetime,
    actor: str | None = None,
    samples: bool = False,
) -> dict[str, Any]:
    """The App Insights envelope for one activity. Raises ValueError on a contract violation."""
    a = _as_activity(activity)
    if not agent_id:
        raise ValueError("agent_id is required")
    if not validate_activity_type(a.activity_type):
        raise ValueError(f'invalid activity_type "{a.activity_type}"')
    if not a.title:
        raise ValueError("title is required")
    if not a.activity_id:
        raise ValueError("activity_id is required")
    if a.level not in ACTIVITY_LEVELS:
        raise ValueError(f'invalid level "{a.level}"')
    if a.channel is not None and a.channel not in ACTIVITY_CHANNELS:
        raise ValueError(f'invalid channel "{a.channel}"')

    occurred_at: str | None = None
    if isinstance(a.occurred_at, datetime):
        occurred_at = format_utc(a.occurred_at)
    elif a.occurred_at:
        if not _UTC_TIMESTAMP.fullmatch(a.occurred_at):
            raise ValueError(f'occurred_at must be ISO-8601 UTC ending in Z, got "{a.occurred_at}"')
        occurred_at = a.occurred_at

    known = list(a.known_names or ())

    def sample(text: str | None) -> str | None:
        return _truncate(mask_pii(text, known)) if samples and text else None

    properties: dict[str, str] = {
        "schemaVersion": ACTIVITY_SCHEMA_VERSION,
        "agentId": agent_id,
        "activityType": a.activity_type,
        "title": a.title,
        "level": a.level,
        "activityId": a.activity_id,
    }
    optional = {
        "subject": a.subject,
        "detail": a.detail,
        "actor": a.actor or actor,
        "url": a.url,
        "relatedActivityId": a.related_activity_id,
        "channel": a.channel,
        "occurredAt": occurred_at,
        "backfilled": "true" if a.backfilled else None,
        "sampleRequest": sample(a.sample_request),
        "sampleResponse": sample(a.sample_response),
    }
    properties.update({k: v for k, v in optional.items() if v})

    measurements: dict[str, float] = {}
    for key, value in (a.measurements or {}).items():
        if isinstance(value, bool):
            measurements[key] = 1 if value else 0
        elif isinstance(value, (int, float)) and math.isfinite(value):
            measurements[key] = value

    return {
        "name": "Microsoft.ApplicationInsights.Event",
        "time": format_utc(time),
        "iKey": instrumentation_key,
        "tags": {"ai.cloud.role": agent_id},
        "data": {
            "baseType": "EventData",
            "baseData": {
                "ver": 2,
                "name": ACTIVITY_EVENT_NAME,
                "properties": properties,
                "measurements": measurements,
            },
        },
    }


def parse_connection_string(connection_string: str | None) -> dict[str, str] | None:
    """``{"instrumentationKey", "ingestionEndpoint"}`` from an App Insights connection string, or None."""
    if not connection_string:
        return None
    parts: dict[str, str] = {}
    for pair in connection_string.split(";"):
        at = pair.find("=")
        if at <= 0:
            continue
        key, value = pair[:at].strip().lower(), pair[at + 1 :].strip()
        if key and value:
            parts[key] = value
    ikey = parts.get("instrumentationkey")
    if not ikey:
        return None
    endpoint = parts.get("ingestionendpoint", DEFAULT_INGESTION_ENDPOINT).rstrip("/")
    return {"instrumentationKey": ikey, "ingestionEndpoint": endpoint}


def _urllib_transport(url: str, body: bytes, headers: Mapping[str, str], timeout: float) -> int:
    request = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (https from config)
            return int(response.status)
    except urllib.error.HTTPError as error:
        return int(error.code)


class Pulse:
    """Reports activities. ``emit`` never raises: failures are logged and the event dropped."""

    def emit(self, activity: ActivityLike) -> None:  # pragma: no cover - overridden
        raise NotImplementedError

    async def emit_async(self, activity: ActivityLike) -> None:
        """``emit`` on a worker thread, so an event loop is never blocked by the HTTP call."""
        await asyncio.to_thread(self.emit, activity)

    def flush(self) -> None:
        """Nothing is buffered: ``emit`` returns once the event is sent or dropped."""


class _NoopPulse(Pulse):
    def emit(self, activity: ActivityLike) -> None:
        return None


noop_pulse: Pulse = _NoopPulse()
"""A pulse that does nothing, for tests and for agents with telemetry switched off."""


class _AppInsightsPulse(Pulse):
    def __init__(
        self,
        *,
        agent_id: str,
        instrumentation_key: str,
        ingestion_endpoint: str,
        actor: str | None,
        samples: bool,
        transport: Transport,
        warn: Callable[[str], None],
        now: Callable[[], datetime],
    ) -> None:
        self._agent_id = agent_id
        self._ikey = instrumentation_key
        self._url = f"{ingestion_endpoint}/v2.1/track"
        self._actor = actor
        self._samples = samples
        self._transport = transport
        self._warn = warn
        self._now = now

    def emit(self, activity: ActivityLike) -> None:
        kind = _kind(activity)
        try:
            envelope = to_envelope(
                activity,
                agent_id=self._agent_id,
                instrumentation_key=self._ikey,
                time=self._now(),
                actor=self._actor,
                samples=self._samples,
            )
            body = json.dumps([envelope], ensure_ascii=False).encode("utf-8")
            status = self._transport(
                self._url, body, {"Content-Type": "application/json"}, INGESTION_TIMEOUT_SECONDS
            )
            if not 200 <= status < 300:
                self._warn(f"agent-pulse: ingestion returned HTTP {status} for {kind}")
        except Exception as error:  # noqa: BLE001 - telemetry must never fail the agent
            self._warn(f"agent-pulse: dropped {kind}: {error}")


def create_pulse(
    *,
    agent_id: str,
    connection_string: str | None = None,
    actor: str | None = None,
    samples: bool = False,
    transport: Transport | None = None,
    warn: Callable[[str], None] | None = None,
    now: Callable[[], datetime] | None = None,
) -> Pulse:
    """Report activities to the agent's own Application Insights.

    ``connection_string`` defaults to ``APPLICATIONINSIGHTS_CONNECTION_STRING``. Without one (or
    without ``agent_id``) a warning is logged once and a no-op pulse is returned. Samples are
    dropped unless ``samples=True``; when on they are masked, then truncated.
    """
    log = warn or _log.warning
    parsed = parse_connection_string(
        connection_string if connection_string is not None else os.environ.get("APPLICATIONINSIGHTS_CONNECTION_STRING")
    )
    if parsed is None:
        log("agent-pulse: APPLICATIONINSIGHTS_CONNECTION_STRING missing or invalid; activity will not be reported")
        return noop_pulse
    if not agent_id:
        log("agent-pulse: agent_id missing; activity will not be reported")
        return noop_pulse
    return _AppInsightsPulse(
        agent_id=agent_id,
        instrumentation_key=parsed["instrumentationKey"],
        ingestion_endpoint=parsed["ingestionEndpoint"],
        actor=actor,
        samples=samples,
        transport=transport or _urllib_transport,
        warn=log,
        now=now or (lambda: datetime.now(timezone.utc)),
    )
