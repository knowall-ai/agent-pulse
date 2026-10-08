using System.Text;
using System.Text.RegularExpressions;

namespace KnowAll.AgentPulse;

/// <summary>
/// Draft versus what the human actually sent. Pure functions behind the <c>email.compared</c>
/// measurements (similarity, editDistance, sentAsIs). Word-level: text is lowercased, punctuation
/// becomes spaces, and only the first 1,500 words of each side are compared.
/// </summary>
public static class EditComparison
{
    /// <summary>Similarity at or above this counts as sent as-is (a signature or a typo fix).</summary>
    public const double SentAsIs = 0.97;

    private const int MaxWords = 1500;

    private static readonly Regex Quoted = new(
        @"^\s*(?:From:\s.+|-{2,}\s*Original Message\s*-{2,}|On .{5,120} wrote:|_{10,})\s*$",
        RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>Cut the quoted thread ("From: ...", "On ... wrote:", "-----Original Message-----") off a reply.</summary>
    public static string StripQuoted(string text)
    {
        var match = Quoted.Match(text);
        return (match.Success ? text[..match.Index] : text).Trim();
    }

    /// <summary>Word-level similarity, 0 to 1 (2 x LCS / total words). Identical or two empty texts give 1.</summary>
    public static double Similarity(string a, string b)
    {
        var x = Words(a);
        var y = Words(b);
        if (x.Length == 0 && y.Length == 0) return 1;
        return 2.0 * Lcs(x, y) / (x.Length + y.Length);
    }

    /// <summary>Word-level edit size: words added plus words removed.</summary>
    public static int EditDistance(string a, string b)
    {
        var x = Words(a);
        var y = Words(b);
        return x.Length + y.Length - 2 * Lcs(x, y);
    }

    private static string[] Words(string text)
    {
        var builder = new StringBuilder(text.Length);
        foreach (var ch in text.ToLowerInvariant())
        {
            builder.Append(char.IsLetter(ch) || char.IsNumber(ch) || char.IsWhiteSpace(ch) ? ch : ' ');
        }
        return builder.ToString().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Take(MaxWords).ToArray();
    }

    private static int Lcs(string[] a, string[] b)
    {
        if (a.Length == 0 || b.Length == 0) return 0;
        var prev = new int[b.Length + 1];
        for (var i = 1; i <= a.Length; i++)
        {
            var row = new int[b.Length + 1];
            for (var j = 1; j <= b.Length; j++)
            {
                row[j] = a[i - 1] == b[j - 1] ? prev[j - 1] + 1 : Math.Max(prev[j], row[j - 1]);
            }
            prev = row;
        }
        return prev[b.Length];
    }
}
