/**
 * Masks personal data with `*****` before text leaves an agent as an
 * AgentActivity sample.
 *
 * Three layers, over-eager by design: a masked false positive costs nothing,
 * a leaked name costs trust.
 *   1. Known names: names and addresses the caller already holds for this item
 *      (e.g. the sender). Regex alone cannot find "Alex" in "Hi Alex," but the
 *      agent knows who wrote in, so every token of their name is masked
 *      wherever it appears.
 *   2. Greetings and sign-offs: the name after "Hi"/"Dear" and the short lines
 *      after "Thanks"/"Kind regards" are where third-party names live.
 *   3. Patterns: email addresses (masked first of all), UK phone numbers and postcodes, 7-digit
 *      account numbers, dates of birth and ages, street addresses, and names
 *      cued by a title ("Mrs Smith") or a relationship ("my son Sam").
 *
 * CAVEAT: this is a backstop, not a guarantee. Free-standing names with no cue
 * ("Sam can't make it") are not caught. Run named-entity recognition (e.g.
 * Azure AI Language PII detection, in your own tenant) as well before you turn
 * samples on for real users, and never sample sensitive items at all.
 *
 * The Python and .NET ports mirror these rules; spec/test-vectors.json keeps
 * all three in step.
 */

export const MASK = "*****";

// Email addresses go first, before known names: masking "alex" inside
// alex@example.com would otherwise stop the address matching and leak its domain.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const PATTERNS: Array<{ regex: RegExp; group?: number }> = [
  { regex: /(?:\+44[\s-]?\(?0?\)?[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/g },
  { regex: /\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}\b/g },
  { regex: /\b\d{7}\b/g },
  {
    regex:
      /\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)\d{2}\b|\bborn\s+(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+(?:19|20)\d{2}\b|\baged?\s+\d{1,2}\b/gi,
  },
  {
    regex:
      /\b\d{1,4}\s+[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Gardens|Close|Court|Crescent|Terrace|Way|Place|Park)\b/g,
  },
  // Names in the three cue patterns below are Unicode letters (\p{Lu}, \p{Ll}), so "Dear Éabha"
  // and "Mrs Ní Bhriain" are caught, and a lookbehind stands in for \b, which is ASCII-only in
  // JavaScript. A title may be followed by a one-letter initial or particle ("Mr Ó Briain"). Each
  // name word runs on to the end of the word, so "Dear O'Brien" or "Dear Éabha张伟" leaves no tail.
  {
    regex: /(?<![\p{L}\p{N}_])(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+((?:\p{Lu}\s+)?\p{Lu}\p{Ll}+[\p{L}\p{N}_]*(?:\s+\p{Lu}\p{Ll}+[\p{L}\p{N}_]*)?)/gu,
    group: 1,
  },
  {
    regex:
      /(?<![\p{L}\p{N}_])[Mm]y\s+(?:son|daughter|wife|husband|partner|father|mother|mum|dad|brother|sister|grandson|granddaughter)\s+(\p{Lu}\p{Ll}+[\p{L}\p{N}_]*(?:\s+\p{Lu}\p{Ll}+[\p{L}\p{N}_]*)?)/gu,
    group: 1,
  },
  // Greetings: "Hi Alex," / "Dear Alex Morgan": the name, not the greeting.
  {
    regex:
      /(?<![\p{L}\p{N}_])(?:Hi|Hello|Hey|Dear|Morning|Afternoon|Evening)\s+(\p{Lu}[\p{Ll}'-]+[\p{L}\p{N}_]*(?:\s+\p{Lu}[\p{Ll}'-]+[\p{L}\p{N}_]*)?)/gu,
    group: 1,
  },
];

const SIGN_OFF =
  /^\s*(?:thanks|thank you|many thanks|thanks again|kind regards|best regards|warm regards|regards|best wishes|best|cheers|all the best|yours sincerely|yours faithfully|sincerely)[\s,.!]*$/i;

/** Up to two short lines after a sign-off are a signature: mask them whole. */
function maskSignatures(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!SIGN_OFF.test(lines[i])) continue;
    for (let j = i + 1, masked = 0; j < lines.length && masked < 2; j++) {
      const line = lines[j].trim();
      if (line === "") continue;
      if (line.length <= 40 && !line.includes(MASK)) lines[j] = MASK;
      masked++;
    }
  }
  return lines.join("\n");
}

// Word boundaries for known names. JavaScript's \b only knows ASCII, so it finds no boundary
// before "É" in "Éabha" (the name leaks) and one after "M" in "Máine" (a fragment is masked).
// These lookarounds treat every Unicode letter and number as part of a word; use them with "u".
const NOT_AFTER_WORD = "(?<![\\p{L}\\p{N}_])";
const NOT_BEFORE_WORD = "(?![\\p{L}\\p{N}_])";

/** Escapes only syntax characters, so the result is also valid under the "u" flag. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Name and address tokens worth masking: the whole entry plus each part of 2+ chars with a (Unicode) letter. */
function knownTokens(known: string[]): string[] {
  const tokens = new Set<string>();
  for (const entry of known) {
    if (!entry || !entry.trim()) continue;
    tokens.add(entry.trim());
    const local = entry.includes("@") ? entry.split("@")[0] : entry;
    for (const part of local.split(/[\s._+-]+/)) {
      if (part.length >= 2 && /\p{L}/u.test(part)) tokens.add(part);
    }
  }
  return [...tokens].filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
}

/**
 * Mask personal data in `text` with `*****`. `known` carries names and
 * addresses already held for this item (e.g. the sender) so they are masked
 * everywhere they appear.
 *
 * A backstop, not a guarantee: free-standing names with no cue are missed.
 * Add named-entity recognition (e.g. Azure AI Language PII detection) before
 * turning samples on for real users.
 */
export function maskPii(text: string, known: string[] = []): string {
  let out = text.replace(new RegExp(EMAIL.source, EMAIL.flags), MASK);

  for (const token of knownTokens(known)) {
    out = out.replace(new RegExp(`${NOT_AFTER_WORD}${escapeRegExp(token)}${NOT_BEFORE_WORD}`, "giu"), MASK);
  }

  for (const { regex, group } of PATTERNS) {
    out = out.replace(new RegExp(regex.source, regex.flags), (match, ...groups) => {
      const value = group !== undefined ? (groups[group - 1] as string | undefined) : match;
      return value ? match.replace(value, MASK) : match;
    });
  }

  return maskSignatures(out);
}
