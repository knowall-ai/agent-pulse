/**
 * Draft versus what the human actually sent. Pure functions behind the
 * `email.compared` measurements (similarity, editDistance, sentAsIs): given
 * the agent's draft and the reply a person sent, how much changed.
 *
 * Word-level: text is lowercased, punctuation becomes spaces, and only the
 * first 1,500 words of each side are compared.
 */
/** Similarity at or above this counts as sent as-is (a signature or a typo fix). */
export const SENT_AS_IS = 0.97;
const MAX_WORDS = 1500;
/** Cut the quoted thread ("From: … ", "On … wrote:", "-----Original Message-----") off a reply. */
export function stripQuoted(text) {
    const cut = text.search(/^\s*(?:From:\s.+|-{2,}\s*Original Message\s*-{2,}|On .{5,120} wrote:|_{10,})\s*$/im);
    return (cut === -1 ? text : text.slice(0, cut)).trim();
}
function words(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, MAX_WORDS);
}
/** Longest common subsequence length over two token arrays. */
function lcs(a, b) {
    if (a.length === 0 || b.length === 0)
        return 0;
    let prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
        const row = new Array(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j++) {
            row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
        }
        prev = row;
    }
    return prev[b.length];
}
/** Word-level similarity, 0 to 1 (2 x LCS / total words). Identical text, or two empty texts, is 1. */
export function similarity(a, b) {
    const x = words(a);
    const y = words(b);
    if (x.length === 0 && y.length === 0)
        return 1;
    return (2 * lcs(x, y)) / (x.length + y.length);
}
/** Word-level edit size: words added plus words removed. */
export function editDistance(a, b) {
    const x = words(a);
    const y = words(b);
    return x.length + y.length - 2 * lcs(x, y);
}
//# sourceMappingURL=compare.js.map