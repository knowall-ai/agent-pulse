from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import pytest

from agent_pulse import AgentActivity, create_pulse, noop_pulse, to_envelope

CONNECTION = (
    "InstrumentationKey=ikey-1;IngestionEndpoint=https://uksouth-1.in.applicationinsights.azure.com/;"
    "LiveEndpoint=https://x"
)
ACTIVITY = AgentActivity(
    activity_type="email.drafted",
    title="Drafted reply · billing",
    level="success",
    activity_id="a" * 64,
    channel="email",
    subject="billing",
    measurements={"confidence": 0.9},
)
NOW = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)


class Recorder:
    def __init__(self, status: int = 200, error: Exception | None = None) -> None:
        self.calls: list[tuple[str, bytes, dict, float]] = []
        self.status = status
        self.error = error

    def __call__(self, url, body, headers, timeout):
        self.calls.append((url, body, dict(headers), timeout))
        if self.error:
            raise self.error
        return self.status

    def envelope(self, i: int = 0) -> dict:
        return json.loads(self.calls[i][1])[0]


def test_posts_one_envelope_to_the_ingestion_endpoint():
    transport = Recorder()
    pulse = create_pulse(connection_string=CONNECTION, agent_id="acme-helpdesk", transport=transport, now=lambda: NOW)
    pulse.emit(ACTIVITY)
    url, _, headers, timeout = transport.calls[0]
    assert url == "https://uksouth-1.in.applicationinsights.azure.com/v2.1/track"
    assert headers["Content-Type"] == "application/json"
    assert timeout == 5.0
    assert transport.envelope() == to_envelope(
        ACTIVITY, agent_id="acme-helpdesk", instrumentation_key="ikey-1", time=NOW
    )


def test_reads_the_connection_string_from_the_environment(monkeypatch):
    monkeypatch.setenv("APPLICATIONINSIGHTS_CONNECTION_STRING", "InstrumentationKey=from-env")
    transport = Recorder()
    create_pulse(agent_id="a", transport=transport).emit(ACTIVITY)
    assert transport.calls[0][0] == "https://dc.services.visualstudio.com/v2.1/track"
    assert transport.envelope()["iKey"] == "from-env"


def test_noop_with_one_warning_without_a_connection_string(monkeypatch):
    monkeypatch.delenv("APPLICATIONINSIGHTS_CONNECTION_STRING", raising=False)
    warnings: list[str] = []
    transport = Recorder()
    pulse = create_pulse(agent_id="a", transport=transport, warn=warnings.append)
    pulse.emit(ACTIVITY)
    assert pulse is noop_pulse
    assert len(warnings) == 1
    assert transport.calls == []


def test_never_raises_when_the_network_fails():
    warnings: list[str] = []
    pulse = create_pulse(
        connection_string=CONNECTION, agent_id="a", transport=Recorder(error=OSError("network down")), warn=warnings.append
    )
    pulse.emit(ACTIVITY)
    assert "network down" in warnings[0]


def test_warns_on_a_non_2xx_response():
    warnings: list[str] = []
    pulse = create_pulse(connection_string=CONNECTION, agent_id="a", transport=Recorder(status=400), warn=warnings.append)
    pulse.emit(ACTIVITY)
    assert "HTTP 400" in warnings[0]


def test_drops_an_invalid_activity_with_a_warning():
    warnings: list[str] = []
    transport = Recorder()
    pulse = create_pulse(connection_string=CONNECTION, agent_id="a", transport=transport, warn=warnings.append)
    pulse.emit({"activity_type": "Not Valid", "title": "t", "level": "info", "activity_id": "x"})
    assert transport.calls == []
    assert "invalid activity_type" in warnings[0]


def test_accepts_a_mapping():
    transport = Recorder()
    pulse = create_pulse(connection_string=CONNECTION, agent_id="a", transport=transport)
    pulse.emit({"activity_type": "chat.answered", "title": "Answered", "level": "success", "activity_id": "x"})
    assert transport.envelope()["data"]["baseData"]["properties"]["activityType"] == "chat.answered"


def test_samples_are_dropped_unless_on_and_masked_when_on():
    activity = AgentActivity(
        activity_type="email.drafted", title="t", level="info", activity_id="x",
        sample_request="Hi Alex, mail me at alex@example.com", known_names=["Alex"],
    )
    off, on = Recorder(), Recorder()
    create_pulse(connection_string=CONNECTION, agent_id="a", transport=off).emit(activity)
    create_pulse(connection_string=CONNECTION, agent_id="a", transport=on, samples=True).emit(activity)
    assert "sampleRequest" not in off.envelope()["data"]["baseData"]["properties"]
    assert on.envelope()["data"]["baseData"]["properties"]["sampleRequest"] == "Hi *****, mail me at *****"


def test_datetime_occurred_at_is_written_as_utc():
    from datetime import timedelta

    local = datetime(2026, 9, 1, 9, 0, tzinfo=timezone(timedelta(hours=1)))
    activity = AgentActivity(activity_type="email.drafted", title="t", level="info", activity_id="x", occurred_at=local)
    envelope = to_envelope(activity, agent_id="a", instrumentation_key="k", time=NOW)
    assert envelope["data"]["baseData"]["properties"]["occurredAt"] == "2026-09-01T08:00:00.000Z"


def test_naive_datetime_is_rejected():
    activity = AgentActivity(
        activity_type="email.drafted", title="t", level="info", activity_id="x", occurred_at=datetime(2026, 9, 1)
    )
    with pytest.raises(ValueError):
        to_envelope(activity, agent_id="a", instrumentation_key="k", time=NOW)


def test_boolean_measurements_become_0_or_1():
    activity = AgentActivity(
        activity_type="email.drafted", title="t", level="info", activity_id="x", measurements={"sensitive": True}
    )
    envelope = to_envelope(activity, agent_id="a", instrumentation_key="k", time=NOW)
    assert envelope["data"]["baseData"]["measurements"] == {"sensitive": 1}


def test_emit_async_runs_off_the_event_loop():
    def slow(url, body, headers, timeout):
        time.sleep(0.2)
        return 200

    pulse = create_pulse(connection_string=CONNECTION, agent_id="a", transport=slow)

    async def main() -> float:
        ticks = 0

        async def ticker():
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        task = asyncio.create_task(ticker())
        await pulse.emit_async(ACTIVITY)
        task.cancel()
        return ticks

    assert asyncio.run(main()) > 5


def test_noop_pulse_does_nothing():
    noop_pulse.emit(ACTIVITY)
    noop_pulse.flush()
    asyncio.run(noop_pulse.emit_async(ACTIVITY))
