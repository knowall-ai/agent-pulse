/**
 * Draft versus what the human actually sent. Pure functions behind the
 * `email.compared` measurements (similarity, editDistance, sentAsIs): given
 * the agent's draft and the reply a person sent, how much changed.
 *
 * Word-level: text is lowercased, punctuation becomes spaces, and only the
 * first 1,500 words of each side are compared.
 */
/** Similarity at or above this counts as sent as-is (a signature or a typo fix). */
export declare const SENT_AS_IS = 0.97;
/** Cut the quoted thread ("From: … ", "On … wrote:", "-----Original Message-----") off a reply. */
export declare function stripQuoted(text: string): string;
/** Word-level similarity, 0 to 1 (2 x LCS / total words). Identical text, or two empty texts, is 1. */
export declare function similarity(a: string, b: string): number;
/** Word-level edit size: words added plus words removed. */
export declare function editDistance(a: string, b: string): number;
//# sourceMappingURL=compare.d.ts.map