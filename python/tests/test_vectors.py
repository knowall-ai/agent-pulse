"""Every implementation runs the same vectors: spec/test-vectors.json."""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

import pytest
from conftest import VECTORS

from agent_pulse import (
    SENT_AS_IS,
    AgentActivity,
    activity_id_from,
    edit_distance,
    mask_pii,
    parse_connection_string,
    similarity,
    strip_quoted,
    to_envelope,
    validate_activity_type,
)


def expand(value: Any) -> Any:
    if isinstance(value, dict) and "repeat" in value:
        return value["repeat"] * value["times"] + value.get("suffix", "")
    return value


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def to_activity(raw: dict[str, Any]) -> AgentActivity:
    fields = {snake(k): v for k, v in raw.items()}
    for key in ("sample_request", "sample_response"):
        if key in fields:
            fields[key] = expand(fields[key])
    if "measurements" in fields:
        fields["measurements"] = {
            k: (math.nan if v == "NaN" else math.inf if v == "Infinity" else v) for k, v in fields["measurements"].items()
        }
    return AgentActivity(**fields)


def parse_time(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


@pytest.mark.parametrize("vector", VECTORS["envelopes"], ids=lambda v: v["name"])
def test_envelope(vector):
    options = vector["options"]

    def build():
        return to_envelope(
            to_activity(vector["activity"]),
            agent_id=options["agentId"],
            instrumentation_key=options["instrumentationKey"],
            time=parse_time(options["time"]),
            actor=options.get("actor"),
            samples=options.get("samples", False),
        )

    if vector.get("error"):
        with pytest.raises(ValueError):
            build()
        return
    envelope = build()
    expected = vector["expected"]
    assert envelope["name"] == expected["name"]
    assert envelope["time"] == expected["time"]
    assert envelope["iKey"] == expected["iKey"]
    assert envelope["tags"] == expected["tags"]
    assert envelope["data"]["baseType"] == expected["baseType"]
    assert envelope["data"]["baseData"]["name"] == expected["eventName"]
    assert envelope["data"]["baseData"]["ver"] == expected["ver"]
    assert envelope["data"]["baseData"]["properties"] == {k: expand(v) for k, v in expected["properties"].items()}
    assert envelope["data"]["baseData"]["measurements"] == expected["measurements"]


@pytest.mark.parametrize("activity_type", VECTORS["activityTypes"]["valid"])
def test_valid_activity_type(activity_type):
    assert validate_activity_type(activity_type)


@pytest.mark.parametrize("activity_type", VECTORS["activityTypes"]["invalid"])
def test_invalid_activity_type(activity_type):
    assert not validate_activity_type(activity_type)


@pytest.mark.parametrize("vector", VECTORS["activityIdFrom"], ids=lambda v: v["input"] or "empty")
def test_activity_id_from(vector):
    assert activity_id_from(vector["input"]) == vector["expected"]


@pytest.mark.parametrize("vector", VECTORS["connectionStrings"], ids=lambda v: v["input"][:40] or "empty")
def test_connection_string(vector):
    assert parse_connection_string(vector["input"]) == vector["expected"]


@pytest.mark.parametrize("vector", VECTORS["masking"], ids=lambda v: v["text"][:40])
def test_masking(vector):
    assert mask_pii(vector["text"], vector["known"]) == vector["expected"]
    assert mask_pii(vector["expected"], vector["known"]) == vector["expected"]


@pytest.mark.parametrize("vector", VECTORS["comparison"], ids=lambda v: f"{v['a'][:20]}|{v['b'][:20]}")
def test_comparison(vector):
    assert similarity(vector["a"], vector["b"]) == pytest.approx(vector["similarity"], abs=1e-9)
    assert edit_distance(vector["a"], vector["b"]) == vector["editDistance"]
    assert (similarity(vector["a"], vector["b"]) >= SENT_AS_IS) == vector["sentAsIs"]


@pytest.mark.parametrize("vector", VECTORS["stripQuoted"], ids=lambda v: v["input"][:30])
def test_strip_quoted(vector):
    assert strip_quoted(vector["input"]) == vector["expected"]
