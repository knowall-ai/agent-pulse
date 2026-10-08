"""Draft versus what the human actually sent.

Pure functions behind the ``email.compared`` measurements (similarity, editDistance, sentAsIs):
given the agent's draft and the reply a person sent, how much changed. Word-level: text is
lowercased, punctuation becomes spaces, and only the first 1,500 words of each side are compared.
"""

from __future__ import annotations

import re
import unicodedata

SENT_AS_IS = 0.97
"""Similarity at or above this counts as sent as-is (a signature or a typo fix)."""

_MAX_WORDS = 1500

_QUOTED = re.compile(
    r"^\s*(?:From:\s.+|-{2,}\s*Original Message\s*-{2,}|On .{5,120} wrote:|_{10,})\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def strip_quoted(text: str) -> str:
    """Cut the quoted thread ("From: ...", "On ... wrote:", "-----Original Message-----") off a reply."""
    match = _QUOTED.search(text)
    return (text if match is None else text[: match.start()]).strip()


def _words(text: str) -> list[str]:
    cleaned = "".join(
        ch if ch.isspace() or unicodedata.category(ch)[0] in ("L", "N") else " " for ch in text.lower()
    )
    return cleaned.split()[:_MAX_WORDS]


def _lcs(a: list[str], b: list[str]) -> int:
    if not a or not b:
        return 0
    prev = [0] * (len(b) + 1)
    for x in a:
        row = [0] * (len(b) + 1)
        for j, y in enumerate(b, start=1):
            row[j] = prev[j - 1] + 1 if x == y else max(prev[j], row[j - 1])
        prev = row
    return prev[len(b)]


def similarity(a: str, b: str) -> float:
    """Word-level similarity, 0 to 1 (2 x LCS / total words). Identical or two empty texts give 1."""
    x, y = _words(a), _words(b)
    if not x and not y:
        return 1.0
    return (2 * _lcs(x, y)) / (len(x) + len(y))


def edit_distance(a: str, b: str) -> int:
    """Word-level edit size: words added plus words removed."""
    x, y = _words(a), _words(b)
    return len(x) + len(y) - 2 * _lcs(x, y)
