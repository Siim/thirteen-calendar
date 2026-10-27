namespace Thirteen.Desktop.Support;

/// <summary>What a file or link handed to Thirteen asks for (§6.4 "Command line").</summary>
public enum ExternalKind
{
    /// <summary><c>Thirteen.exe "C:\path\file.ics"</c> or <c>--import &lt;path&gt;</c>: the Import dialog with these files.</summary>
    Import,

    /// <summary><c>webcal://...</c>, <c>webcals://...</c> or <c>thirteen://subscribe?url=...</c>: the Subscribe dialog prefilled.</summary>
    Subscribe,
}

/// <summary>
/// A request from the command line or a second start: files to import, or a link to subscribe to. Nothing is
/// imported or fetched until the user confirms in the dialog (§2.17 step 6).
/// </summary>
/// <param name="Kind">Import or subscribe.</param>
/// <param name="Files">Full paths of the files to import (Import).</param>
/// <param name="Link">The link to prefill, as given (Subscribe).</param>
public sealed record ExternalRequest(ExternalKind Kind, IReadOnlyList<string> Files, string? Link)
{
    /// <summary>The file extensions Import takes (§2.17 step 1).</summary>
    public static IReadOnlyList<string> ImportExtensions { get; } = [".ics", ".ical", ".ifb", ".zip"];

    /// <summary>The first request in the arguments: a subscribe link wins over files. Relative paths are resolved against <paramref name="workingDirectory"/>.</summary>
    public static ExternalRequest? Parse(IReadOnlyList<string> args, string? workingDirectory = null)
    {
        ArgumentNullException.ThrowIfNull(args);
        foreach (var arg in args)
        {
            if (SubscribeLink(arg) is { } link) return new ExternalRequest(ExternalKind.Subscribe, [], link);
        }
        var files = ImportFiles(args, workingDirectory);
        return files.Count == 0 ? null : new ExternalRequest(ExternalKind.Import, files, null);
    }

    /// <summary>The files to import in the arguments (bare paths with an Import extension, and <c>--import &lt;path&gt;</c>), as full paths.</summary>
    private static IReadOnlyList<string> ImportFiles(IReadOnlyList<string> args, string? workingDirectory)
    {
        var files = new List<string>();
        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            if (string.Equals(arg, "--import", StringComparison.OrdinalIgnoreCase))
            {
                if (i + 1 < args.Count && FullPath(args[i + 1], workingDirectory) is { } imported) files.Add(imported);
                i++;
                continue;
            }
            if (arg.StartsWith('-')) continue;
            if (IsImportFile(arg) && FullPath(arg, workingDirectory) is { } path) files.Add(path);
        }
        return files.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    /// <summary>
    /// The link to prefill from a <c>webcal://</c> / <c>webcals://</c> argument or a <c>thirteen://subscribe?url=</c>
    /// link (its <c>url</c> percent-decoded); null for anything else.
    /// </summary>
    public static string? SubscribeLink(string? arg)
    {
        if (string.IsNullOrWhiteSpace(arg)) return null;
        var text = arg.Trim();
        if (text.StartsWith("webcal://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("webcals://", StringComparison.OrdinalIgnoreCase)) return text;
        if (!text.StartsWith(DeepLink.Scheme + ":", StringComparison.OrdinalIgnoreCase)) return null;
        var rest = text[(DeepLink.Scheme.Length + 1)..].TrimStart('/');
        var query = rest.IndexOf('?', StringComparison.Ordinal);
        var path = (query < 0 ? rest : rest[..query]).TrimEnd('/');
        if (!path.Equals("subscribe", StringComparison.OrdinalIgnoreCase)) return null;
        if (query < 0) return "";
        foreach (var pair in rest[(query + 1)..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = pair.IndexOf('=', StringComparison.Ordinal);
            if (eq <= 0 || !pair[..eq].Equals("url", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                return Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
            }
            catch (UriFormatException)
            {
                return "";
            }
        }
        return "";
    }

    /// <summary>A file Import takes, by extension.</summary>
    public static bool IsImportFile(string arg) =>
        !arg.Contains("://", StringComparison.Ordinal)
        && ImportExtensions.Any(e => arg.EndsWith(e, StringComparison.OrdinalIgnoreCase));

    private static string? FullPath(string path, string? workingDirectory)
    {
        try
        {
            return Path.IsPathFullyQualified(path) ? Path.GetFullPath(path) : Path.GetFullPath(path, workingDirectory ?? Environment.CurrentDirectory);
        }
        catch (Exception e) when (e is ArgumentException or NotSupportedException or PathTooLongException)
        {
            return null;
        }
    }

    /// <summary>
    /// The arguments a second start hands to the running instance (§6.4 SingleInstance): its <c>thirteen://</c> link,
    /// subscribe links, and the files to import as full paths (the running instance has another working folder).
    /// </summary>
    public static IReadOnlyList<string> Forwarded(IReadOnlyList<string> args, string? workingDirectory = null)
    {
        ArgumentNullException.ThrowIfNull(args);
        var forwarded = new List<string>();
        foreach (var arg in args)
        {
            if (DeepLink.TryParse(arg) is not null || SubscribeLink(arg) is not null) forwarded.Add(arg.Trim());
        }
        forwarded.AddRange(ImportFiles(args, workingDirectory));
        return forwarded.Where(a => a.Length is > 0 and < 2048 && !a.Contains('\n') && !a.Contains('\r')).Distinct(StringComparer.Ordinal).ToArray();
    }
}
