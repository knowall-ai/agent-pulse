"""Masks personal data with ``*****`` before text leaves an agent as an AgentActivity sample.

Three layers, over-eager by design: a masked false positive costs nothing, a leaked name costs
trust.

1. Known names: names and addresses the caller already holds for this item (e.g. the sender).
   Regex alone cannot find "Alex" in "Hi Alex," but the agent knows who wrote in, so every token
   of their name is masked wherever it appears.
2. Greetings and sign-offs: the name after "Hi"/"Dear" and the short lines after
   "Thanks"/"Kind regards" are where third-party names live.
3. Patterns: email addresses (masked first of all), UK phone numbers and postcodes, 7-digit
   account numbers, dates of birth and ages, street addresses, and names cued by a title
   ("Mrs Smith") or a relationship ("my son Sam").

CAVEAT: this is a backstop, not a guarantee. Free-standing names with no cue ("Sam can't make
it") are not caught. Run named-entity recognition (e.g. Azure AI Language PII detection, in your
own tenant) as well before you turn samples on for real users, and never sample sensitive items.

Mirrors the TypeScript implementation; spec/test-vectors.json keeps them in step. Patterns use
``re.ASCII`` so ``\\b`` and ``\\d`` behave as they do in JavaScript, except the ones that find names
(known names, titles, relationships, greetings): those are Unicode-aware, as the TypeScript ones
are with the ``u`` flag, so "Éabha" and "Ní Bhriain" are masked like "Alex".
"""

from __future__ import annotations

import re
import sys
import unicodedata
from itertools import groupby
from typing import Iterable

MASK = "*****"

_A = re.ASCII


def _letter_classes(*categories: str) -> list[str]:
    """Character class bodies for Unicode categories, standing in for JavaScript's ``\\p{Lu}`` etc."""
    ranges: dict[str, list[str]] = {c: [] for c in categories}
    # Every cased letter is below U+20000 (planes 2 and up hold ideographs and private use).
    code_points = range(min(sys.maxunicode, 0x1FFFF) + 1)
    for category, run in groupby(code_points, key=lambda cp: unicodedata.category(chr(cp))):
        if category in ranges:
            first = last = next(run)
            for last in run:
                pass
            ranges[category].append(f"\\U{first:08x}-\\U{last:08x}")
    return ["".join(ranges[c]) for c in categories]


_LU, _LL = _letter_classes("Lu", "Ll")  # \p{Lu}, \p{Ll}
# Unicode \w (letters, numbers, _) on either side of a name, in place of JavaScript's \b, which is
# ASCII-only: \b finds no boundary before "É" in "Éabha" and finds one after "M" in "Máine".
_NOT_AFTER_WORD = r"(?<!\w)"
_NOT_BEFORE_WORD = r"(?!\w)"
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", _A)

_PATTERNS: list[tuple[re.Pattern[str], int | None]] = [
    (re.compile(r"(?:\+44[\s-]?\(?0?\)?[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b", _A), None),
    (re.compile(r"\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}\b", _A), None),
    (re.compile(r"\b\d{7}\b", _A), None),
    (
        re.compile(
            r"\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)\d{2}\b"
            r"|\bborn\s+(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+(?:19|20)\d{2}\b"
            r"|\baged?\s+\d{1,2}\b",
            _A | re.IGNORECASE,
        ),
        None,
    ),
    (
        re.compile(
            r"\b\d{1,4}\s+[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,3}\s+"
            r"(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Gardens|Close|Court|Crescent|Terrace|Way|Place|Park)\b",
            _A,
        ),
        None,
    ),
    # Names in the three cue patterns below are Unicode letters, so "Dear Éabha" and "Mrs Ní Bhriain"
    # are caught. A title may be followed by a one-letter initial or particle ("Mr Ó Briain").
    (
        re.compile(
            rf"{_NOT_AFTER_WORD}(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+((?:[{_LU}]\s+)?[{_LU}][{_LL}]+(?:\s+[{_LU}][{_LL}]+)?)"
        ),
        1,
    ),
    (
        re.compile(
            rf"{_NOT_AFTER_WORD}[Mm]y\s+"
            r"(?:son|daughter|wife|husband|partner|father|mother|mum|dad|brother|sister|grandson|granddaughter)"
            rf"\s+([{_LU}][{_LL}]+(?:\s+[{_LU}][{_LL}]+)?)"
        ),
        1,
    ),
    # Greetings: "Hi Alex," / "Dear Alex Morgan": the name, not the greeting.
    (
        re.compile(
            rf"{_NOT_AFTER_WORD}(?:Hi|Hello|Hey|Dear|Morning|Afternoon|Evening)"
            rf"\s+([{_LU}][{_LL}'-]+(?:\s+[{_LU}][{_LL}'-]+)?)"
        ),
        1,
    ),
]

_SIGN_OFF = re.compile(
    r"^\s*(?:thanks|thank you|many thanks|thanks again|kind regards|best regards|warm regards|regards|best wishes"
    r"|best|cheers|all the best|yours sincerely|yours faithfully|sincerely)[\s,.!]*$",
    re.IGNORECASE,
)


def _mask_signatures(text: str) -> str:
    """Up to two short lines after a sign-off are a signature: mask them whole."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if not _SIGN_OFF.match(line):
            continue
        masked = 0
        j = i + 1
        while j < len(lines) and masked < 2:
            stripped = lines[j].strip()
            if stripped != "":
                if len(stripped) <= 40 and MASK not in stripped:
                    lines[j] = MASK
                masked += 1
            j += 1
    return "\n".join(lines)


def _known_tokens(known: Iterable[str]) -> list[str]:
    """The whole entry plus each part of 2+ characters that contains a (Unicode) letter, longest first."""
    tokens: dict[str, None] = {}
    for entry in known:
        if not entry or not entry.strip():
            continue
        tokens[entry.strip()] = None
        local = entry.split("@")[0] if "@" in entry else entry
        for part in re.split(r"[\s._+-]+", local):
            if len(part) >= 2 and any(ch.isalpha() for ch in part):
                tokens[part] = None
    return sorted((t for t in tokens if len(t) >= 2), key=len, reverse=True)


def mask_pii(text: str, known: Iterable[str] = ()) -> str:
    """Mask personal data in ``text`` with ``*****``.

    ``known`` carries names and addresses already held for this item (e.g. the sender) so they
    are masked everywhere they appear.

    A backstop, not a guarantee: free-standing names with no cue are missed. Add named-entity
    recognition (e.g. Azure AI Language PII detection) before turning samples on for real users.
    """
    out = _EMAIL.sub(MASK, text)

    for token in _known_tokens(known):
        # Unicode, not ASCII, so IGNORECASE also folds "É" to "é".
        out = re.sub(rf"{_NOT_AFTER_WORD}{re.escape(token)}{_NOT_BEFORE_WORD}", MASK, out, flags=re.IGNORECASE)

    for pattern, group in _PATTERNS:

        def replace(match: re.Match[str], group: int | None = group) -> str:
            whole = match.group(0)
            value = whole if group is None else match.group(group)
            return whole.replace(value, MASK, 1) if value else whole

        out = pattern.sub(replace, out)

    return _mask_signatures(out)
