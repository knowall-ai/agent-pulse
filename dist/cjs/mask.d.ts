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
export declare const MASK = "*****";
/**
 * Mask personal data in `text` with `*****`. `known` carries names and
 * addresses already held for this item (e.g. the sender) so they are masked
 * everywhere they appear.
 *
 * A backstop, not a guarantee: free-standing names with no cue are missed.
 * Add named-entity recognition (e.g. Azure AI Language PII detection) before
 * turning samples on for real users.
 */
export declare function maskPii(text: string, known?: string[]): string;
//# sourceMappingURL=mask.d.ts.map