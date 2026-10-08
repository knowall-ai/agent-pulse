using System.Text.RegularExpressions;

namespace KnowAll.AgentPulse;

/// <summary>
/// Masks personal data with <c>*****</c> before text leaves an agent as an AgentActivity sample.
/// </summary>
/// <remarks>
/// Three layers, over-eager by design: a masked false positive costs nothing, a leaked name costs trust.
/// (1) Known names the caller already holds for this item (e.g. the sender), masked wherever they appear.
/// (2) Greetings and sign-offs: the name after "Hi"/"Dear" and the short lines after "Kind regards".
/// (3) Patterns: email addresses (masked first of all), UK phone numbers and postcodes, 7-digit account
/// numbers, dates of birth and ages, street addresses, and names cued by a title or a relationship.
/// <para>
/// CAVEAT: this is a backstop, not a guarantee. Free-standing names with no cue ("Sam can't make it") are
/// not caught. Run named-entity recognition (e.g. Azure AI Language PII detection, in your own tenant) as
/// well before you turn samples on for real users, and never sample sensitive items.
/// </para>
/// Patterns use <see cref="RegexOptions.ECMAScript"/> so they behave as the TypeScript originals do, except the
/// ones that find names (known names, titles, relationships, greetings): those are Unicode-aware, as the
/// TypeScript ones are with the <c>u</c> flag, so "Éabha" and "Ní Bhriain" are masked like "Alex".
/// spec/test-vectors.json keeps all three implementations in step.
/// </remarks>
public static class PiiMask
{
    /// <summary>What every piece of personal data is replaced with.</summary>
    public const string Mask = "*****";

    private const RegexOptions Js = RegexOptions.ECMAScript | RegexOptions.CultureInvariant;
    private const RegexOptions JsI = Js | RegexOptions.IgnoreCase;
    // Unicode-aware, for patterns that find names (the TypeScript "u" flag).
    private const RegexOptions Uni = RegexOptions.CultureInvariant;
    private const RegexOptions UniI = Uni | RegexOptions.IgnoreCase;

    // No letter, number or _ on either side of a name, in place of \b, which is ASCII-only in JavaScript
    // and under ECMAScript: it finds no boundary before "É" in "Éabha" and finds one after "M" in "Máine".
    private const string NotAfterWord = @"(?<![\p{L}\p{N}_])";
    private const string NotBeforeWord = @"(?![\p{L}\p{N}_])";

    private static readonly Regex Email = new(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", Js);

    private static readonly (Regex Regex, int? Group)[] Patterns =
    [
        (new Regex(@"(?:\+44[\s-]?\(?0?\)?[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b", Js), null),
        (new Regex(@"\b[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2}\b", Js), null),
        (new Regex(@"\b\d{7}\b", Js), null),
        (new Regex(
            @"\b\d{1,2}[/\-.]\d{1,2}[/\-.](?:19|20)\d{2}\b" +
            @"|\bborn\s+(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+(?:19|20)\d{2}\b" +
            @"|\baged?\s+\d{1,2}\b", JsI), null),
        (new Regex(
            @"\b\d{1,4}\s+[A-Z][A-Za-z']+(?:\s+[A-Z][A-Za-z']+){0,3}\s+" +
            @"(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Gardens|Close|Court|Crescent|Terrace|Way|Place|Park)\b", Js), null),
        // Names in the three cue patterns below are Unicode letters, so "Dear Éabha" and "Mrs Ní Bhriain" are
        // caught. A title may be followed by a one-letter initial or particle ("Mr Ó Briain").
        (new Regex(
            NotAfterWord + @"(?:Mr|Mrs|Ms|Miss|Dr)\.?\s+((?:\p{Lu}\s+)?\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)", Uni), 1),
        (new Regex(
            NotAfterWord + @"[Mm]y\s+(?:son|daughter|wife|husband|partner|father|mother|mum|dad|brother|sister|grandson|granddaughter)" +
            @"\s+(\p{Lu}\p{Ll}+(?:\s+\p{Lu}\p{Ll}+)?)", Uni), 1),
        // Greetings: "Hi Alex," / "Dear Alex Morgan": the name, not the greeting.
        (new Regex(
            NotAfterWord + @"(?:Hi|Hello|Hey|Dear|Morning|Afternoon|Evening)\s+(\p{Lu}[\p{Ll}'-]+(?:\s+\p{Lu}[\p{Ll}'-]+)?)",
            Uni), 1),
    ];

    private static readonly Regex SignOff = new(
        @"^\s*(?:thanks|thank you|many thanks|thanks again|kind regards|best regards|warm regards|regards|best wishes" +
        @"|best|cheers|all the best|yours sincerely|yours faithfully|sincerely)[\s,.!]*$", JsI);

    private static readonly Regex TokenSplit = new(@"[\s._+-]+", Js);
    private static readonly Regex HasLetter = new(@"\p{L}", Uni);

    /// <summary>
    /// Mask personal data in <paramref name="text"/> with <c>*****</c>. <paramref name="known"/> carries names
    /// and addresses already held for this item (e.g. the sender) so they are masked everywhere they appear.
    /// A backstop, not a guarantee: add named-entity recognition before turning samples on for real users.
    /// </summary>
    public static string MaskPii(string text, IEnumerable<string>? known = null)
    {
        var output = Email.Replace(text, Mask);

        foreach (var token in KnownTokens(known ?? []))
        {
            output = Regex.Replace(output, NotAfterWord + EscapeJs(token) + NotBeforeWord, Mask, UniI);
        }

        foreach (var (regex, group) in Patterns)
        {
            output = regex.Replace(output, match =>
            {
                var whole = match.Value;
                string? value = group is int g ? (match.Groups[g].Success ? match.Groups[g].Value : null) : whole;
                if (string.IsNullOrEmpty(value)) return whole;
                var at = whole.IndexOf(value, StringComparison.Ordinal);
                return whole[..at] + Mask + whole[(at + value.Length)..];
            });
        }

        return MaskSignatures(output);
    }

    /// <summary>Up to two short lines after a sign-off are a signature: mask them whole.</summary>
    private static string MaskSignatures(string text)
    {
        var lines = text.Split('\n');
        for (var i = 0; i < lines.Length; i++)
        {
            if (!SignOff.IsMatch(lines[i])) continue;
            for (int j = i + 1, masked = 0; j < lines.Length && masked < 2; j++)
            {
                var line = lines[j].Trim();
                if (line.Length == 0) continue;
                if (line.Length <= 40 && !line.Contains(Mask, StringComparison.Ordinal)) lines[j] = Mask;
                masked++;
            }
        }
        return string.Join('\n', lines);
    }

    /// <summary>The whole entry plus each part of 2+ characters that contains a (Unicode) letter, longest first.</summary>
    private static IEnumerable<string> KnownTokens(IEnumerable<string> known)
    {
        var tokens = new List<string>();
        void Add(string token)
        {
            if (!tokens.Contains(token, StringComparer.Ordinal)) tokens.Add(token);
        }
        foreach (var entry in known)
        {
            if (string.IsNullOrWhiteSpace(entry)) continue;
            Add(entry.Trim());
            var local = entry.Contains('@') ? entry.Split('@')[0] : entry;
            foreach (var part in TokenSplit.Split(local))
            {
                if (part.Length >= 2 && HasLetter.IsMatch(part)) Add(part);
            }
        }
        return tokens.Where(t => t.Length >= 2).OrderByDescending(t => t.Length).ToList();
    }

    /// <summary>Escape the characters JavaScript's escapeRegExp escapes, nothing else.</summary>
    private static string EscapeJs(string value) =>
        Regex.Replace(value, @"[.*+?^${}()|[\]\\]", @"\$&", Js);
}
