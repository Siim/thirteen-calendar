using System.Text;

namespace Thirteen.Core.Ics;

/// <summary>
/// JavaScript's <c>String.prototype.toUpperCase</c> (the Unicode default full case mapping, language-insensitive),
/// which the TypeScript module applies to component names, <c>STATUS</c>, <c>TRANSP</c>, <c>ACTION</c> and parameter
/// values before comparing them. .NET's <see cref="string.ToUpperInvariant"/> applies the simple mapping only, so
/// <c>STATUS:Straße</c> would read as <c>STRAßE</c> instead of <c>STRASSE</c>, and it leaves the dotless i alone,
/// so <c>TENTATıVE</c> would not be <c>TENTATIVE</c>. This adds what JavaScript does on top: the unconditional
/// one-to-many mappings of SpecialCasing.txt and U+0131 to <c>I</c>.
/// <para>
/// The table holds every code point whose <c>toUpperCase()</c> in Node 22 (ICU 77, Unicode 16.0) differs from
/// <c>ToUpperInvariant()</c> in .NET 10 by more than a Unicode version: compared over all code points, the only other
/// differences are letters of recent scripts (U+A7CE to U+A7D5, U+16EA0 to U+16ED3) that one runtime's Unicode
/// data maps and the other's does not yet; they are left to the runtime. Lower-casing needs no table: the module
/// lower-cases only to look up ASCII keys (CSS color names, Windows zone ids), and no difference there makes or
/// breaks an ASCII match.
/// </para>
/// </summary>
internal static class JsCase
{
    /// <summary>Code point to its JavaScript upper case where that is not .NET's invariant one (all in the BMP).</summary>
    private static readonly Dictionary<char, string> Special = new()
    {
        [(char)0x00DF] = "\u0053\u0053",
        [(char)0x0131] = "\u0049",
        [(char)0x0149] = "\u02BC\u004E",
        [(char)0x01F0] = "\u004A\u030C",
        [(char)0x0390] = "\u0399\u0308\u0301",
        [(char)0x03B0] = "\u03A5\u0308\u0301",
        [(char)0x0587] = "\u0535\u0552",
        [(char)0x1E96] = "\u0048\u0331",
        [(char)0x1E97] = "\u0054\u0308",
        [(char)0x1E98] = "\u0057\u030A",
        [(char)0x1E99] = "\u0059\u030A",
        [(char)0x1E9A] = "\u0041\u02BE",
        [(char)0x1F50] = "\u03A5\u0313",
        [(char)0x1F52] = "\u03A5\u0313\u0300",
        [(char)0x1F54] = "\u03A5\u0313\u0301",
        [(char)0x1F56] = "\u03A5\u0313\u0342",
        [(char)0x1F80] = "\u1F08\u0399",
        [(char)0x1F81] = "\u1F09\u0399",
        [(char)0x1F82] = "\u1F0A\u0399",
        [(char)0x1F83] = "\u1F0B\u0399",
        [(char)0x1F84] = "\u1F0C\u0399",
        [(char)0x1F85] = "\u1F0D\u0399",
        [(char)0x1F86] = "\u1F0E\u0399",
        [(char)0x1F87] = "\u1F0F\u0399",
        [(char)0x1F88] = "\u1F08\u0399",
        [(char)0x1F89] = "\u1F09\u0399",
        [(char)0x1F8A] = "\u1F0A\u0399",
        [(char)0x1F8B] = "\u1F0B\u0399",
        [(char)0x1F8C] = "\u1F0C\u0399",
        [(char)0x1F8D] = "\u1F0D\u0399",
        [(char)0x1F8E] = "\u1F0E\u0399",
        [(char)0x1F8F] = "\u1F0F\u0399",
        [(char)0x1F90] = "\u1F28\u0399",
        [(char)0x1F91] = "\u1F29\u0399",
        [(char)0x1F92] = "\u1F2A\u0399",
        [(char)0x1F93] = "\u1F2B\u0399",
        [(char)0x1F94] = "\u1F2C\u0399",
        [(char)0x1F95] = "\u1F2D\u0399",
        [(char)0x1F96] = "\u1F2E\u0399",
        [(char)0x1F97] = "\u1F2F\u0399",
        [(char)0x1F98] = "\u1F28\u0399",
        [(char)0x1F99] = "\u1F29\u0399",
        [(char)0x1F9A] = "\u1F2A\u0399",
        [(char)0x1F9B] = "\u1F2B\u0399",
        [(char)0x1F9C] = "\u1F2C\u0399",
        [(char)0x1F9D] = "\u1F2D\u0399",
        [(char)0x1F9E] = "\u1F2E\u0399",
        [(char)0x1F9F] = "\u1F2F\u0399",
        [(char)0x1FA0] = "\u1F68\u0399",
        [(char)0x1FA1] = "\u1F69\u0399",
        [(char)0x1FA2] = "\u1F6A\u0399",
        [(char)0x1FA3] = "\u1F6B\u0399",
        [(char)0x1FA4] = "\u1F6C\u0399",
        [(char)0x1FA5] = "\u1F6D\u0399",
        [(char)0x1FA6] = "\u1F6E\u0399",
        [(char)0x1FA7] = "\u1F6F\u0399",
        [(char)0x1FA8] = "\u1F68\u0399",
        [(char)0x1FA9] = "\u1F69\u0399",
        [(char)0x1FAA] = "\u1F6A\u0399",
        [(char)0x1FAB] = "\u1F6B\u0399",
        [(char)0x1FAC] = "\u1F6C\u0399",
        [(char)0x1FAD] = "\u1F6D\u0399",
        [(char)0x1FAE] = "\u1F6E\u0399",
        [(char)0x1FAF] = "\u1F6F\u0399",
        [(char)0x1FB2] = "\u1FBA\u0399",
        [(char)0x1FB3] = "\u0391\u0399",
        [(char)0x1FB4] = "\u0386\u0399",
        [(char)0x1FB6] = "\u0391\u0342",
        [(char)0x1FB7] = "\u0391\u0342\u0399",
        [(char)0x1FBC] = "\u0391\u0399",
        [(char)0x1FC2] = "\u1FCA\u0399",
        [(char)0x1FC3] = "\u0397\u0399",
        [(char)0x1FC4] = "\u0389\u0399",
        [(char)0x1FC6] = "\u0397\u0342",
        [(char)0x1FC7] = "\u0397\u0342\u0399",
        [(char)0x1FCC] = "\u0397\u0399",
        [(char)0x1FD2] = "\u0399\u0308\u0300",
        [(char)0x1FD3] = "\u0399\u0308\u0301",
        [(char)0x1FD6] = "\u0399\u0342",
        [(char)0x1FD7] = "\u0399\u0308\u0342",
        [(char)0x1FE2] = "\u03A5\u0308\u0300",
        [(char)0x1FE3] = "\u03A5\u0308\u0301",
        [(char)0x1FE4] = "\u03A1\u0313",
        [(char)0x1FE6] = "\u03A5\u0342",
        [(char)0x1FE7] = "\u03A5\u0308\u0342",
        [(char)0x1FF2] = "\u1FFA\u0399",
        [(char)0x1FF3] = "\u03A9\u0399",
        [(char)0x1FF4] = "\u038F\u0399",
        [(char)0x1FF6] = "\u03A9\u0342",
        [(char)0x1FF7] = "\u03A9\u0342\u0399",
        [(char)0x1FFC] = "\u03A9\u0399",
        [(char)0xFB00] = "\u0046\u0046",
        [(char)0xFB01] = "\u0046\u0049",
        [(char)0xFB02] = "\u0046\u004C",
        [(char)0xFB03] = "\u0046\u0046\u0049",
        [(char)0xFB04] = "\u0046\u0046\u004C",
        [(char)0xFB05] = "\u0053\u0054",
        [(char)0xFB06] = "\u0053\u0054",
        [(char)0xFB13] = "\u0544\u0546",
        [(char)0xFB14] = "\u0544\u0535",
        [(char)0xFB15] = "\u0544\u053B",
        [(char)0xFB16] = "\u054E\u0546",
        [(char)0xFB17] = "\u0544\u053D",
    };

    /// <summary>JavaScript <c>toUpperCase()</c>: .NET's invariant upper case plus the mappings of <see cref="Special"/>.</summary>
    public static string Upper(string text)
    {
        var first = -1;
        for (var i = 0; i < text.Length; i++)
        {
            if (text[i] >= 0x80 && Special.ContainsKey(text[i]))
            {
                first = i;
                break;
            }
        }
        if (first < 0) return text.ToUpperInvariant();
        var output = new StringBuilder(text.Length + 8);
        var run = 0;
        for (var i = first; i < text.Length; i++)
        {
            if (text[i] < 0x80 || !Special.TryGetValue(text[i], out var mapped)) continue;
            output.Append(text[run..i].ToUpperInvariant()).Append(mapped);
            run = i + 1;
        }
        return output.Append(text[run..].ToUpperInvariant()).ToString();
    }
}
