"""agent-pulse: report what an AI agent does as AgentActivity v1 events to Application Insights."""

from .compare import SENT_AS_IS, edit_distance, similarity, strip_quoted
from .mask import MASK, mask_pii
from .pulse import (
    ACTIVITY_CHANNELS,
    ACTIVITY_EVENT_NAME,
    ACTIVITY_LEVELS,
    ACTIVITY_SCHEMA_VERSION,
    INGESTION_TIMEOUT_SECONDS,
    SAMPLE_MAX_CHARS,
    AgentActivity,
    Pulse,
    activity_id_from,
    create_pulse,
    noop_pulse,
    parse_connection_string,
    to_envelope,
    validate_activity_type,
)

__version__ = "0.1.1"

__all__ = [
    "ACTIVITY_CHANNELS",
    "ACTIVITY_EVENT_NAME",
    "ACTIVITY_LEVELS",
    "ACTIVITY_SCHEMA_VERSION",
    "INGESTION_TIMEOUT_SECONDS",
    "MASK",
    "SAMPLE_MAX_CHARS",
    "SENT_AS_IS",
    "AgentActivity",
    "Pulse",
    "activity_id_from",
    "create_pulse",
    "edit_distance",
    "mask_pii",
    "noop_pulse",
    "parse_connection_string",
    "similarity",
    "strip_quoted",
    "to_envelope",
    "validate_activity_type",
]
