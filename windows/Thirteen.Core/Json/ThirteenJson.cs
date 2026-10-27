using System.Diagnostics.CodeAnalysis;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;

namespace Thirteen.Core.Json;

/// <summary>
/// System.Text.Json support producing the exact JSON of @thirteen/core (key names and order, explicit
/// nulls, ThirteenDate <c>{kind, system, year, month|id ...}</c>, weekdays as integers, ids as strings).
/// The converters are attached to the types with attributes, so any options with camelCase naming work;
/// <see cref="Options"/> is a ready-made, read-only instance. <see cref="GregorianDate"/>,
/// <see cref="ThirteenDate"/> and <see cref="FormatOptions"/> also deserialise, with full validation.
/// </summary>
public static class ThirteenJson
{
    /// <summary>camelCase, compact, relaxed escaping. Read-only.</summary>
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
        };
        options.MakeReadOnly();
        return options;
    }

    /// <summary>Serialises any Thirteen.Core value to the core JSON form.</summary>
    [RequiresUnreferencedCode(ReflectionNote), RequiresDynamicCode(ReflectionNote)]
    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Options);

    /// <summary>Deserialises a <see cref="GregorianDate"/>, <see cref="ThirteenDate"/> or <see cref="FormatOptions"/>.</summary>
    [RequiresUnreferencedCode(ReflectionNote), RequiresDynamicCode(ReflectionNote)]
    public static T? Deserialize<T>(string json) => JsonSerializer.Deserialize<T>(json, Options);

    private const string ReflectionNote = "Uses reflection-based System.Text.Json metadata (DefaultJsonTypeInfoResolver).";
}

internal sealed class WeekdayJsonConverter : JsonConverter<Weekday>
{
    public override Weekday Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.Number || !reader.TryGetInt32(out var value) || !Weekdays.IsValid(value))
            throw new JsonException("Weekday must be an integer 0..6");
        return (Weekday)value;
    }

    public override void Write(Utf8JsonWriter writer, Weekday value, JsonSerializerOptions options) => writer.WriteNumberValue((int)value);
}

internal sealed class CalendarSystemIdJsonConverter : JsonConverter<CalendarSystemId>
{
    public override CalendarSystemId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String && CalendarSystemIdExtensions.TryParse(reader.GetString(), out var id)
            ? id
            : throw new JsonException("system must be 'ifc' or 'positivist'");

    public override void Write(Utf8JsonWriter writer, CalendarSystemId value, JsonSerializerOptions options) => writer.WriteStringValue(value.RawValue());
}

internal sealed class IntercalaryDayIdJsonConverter : JsonConverter<IntercalaryDayId>
{
    public override IntercalaryDayId Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String && IntercalaryDayIdExtensions.TryParse(reader.GetString(), out var id)
            ? id
            : throw new JsonException("id must be 'year-day' or 'leap-day'");

    public override void Write(Utf8JsonWriter writer, IntercalaryDayId value, JsonSerializerOptions options) => writer.WriteStringValue(value.RawValue());
}

internal sealed class DateStyleJsonConverter : JsonConverter<DateStyle>
{
    public override DateStyle Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType == JsonTokenType.String
            ? reader.GetString() switch
            {
                "long" => DateStyle.Long,
                "medium" => DateStyle.Medium,
                "short" => DateStyle.Short,
                "numeric" => DateStyle.Numeric,
                var other => throw new JsonException($"Unknown style \"{other}\" (expected long, medium, short or numeric)"),
            }
            : throw new JsonException("style must be a string");

    public override void Write(Utf8JsonWriter writer, DateStyle value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value switch
        {
            DateStyle.Medium => "medium",
            DateStyle.Short => "short",
            DateStyle.Numeric => "numeric",
            _ => "long",
        });
}

internal sealed class GregorianDateJsonConverter : JsonConverter<GregorianDate>
{
    public override GregorianDate Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        using var doc = JsonDocument.ParseValue(ref reader);
        return FromElement(doc.RootElement);
    }

    internal static GregorianDate FromElement(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) throw new JsonException("GregorianDate must be an object {year, month, day}");
        try
        {
            return new GregorianDate(e.GetProperty("year").GetInt32(), e.GetProperty("month").GetInt32(), e.GetProperty("day").GetInt32());
        }
        catch (ThirteenException error)
        {
            throw new JsonException(error.Message, error);
        }
        catch (KeyNotFoundException error)
        {
            throw new JsonException("GregorianDate needs year, month and day", error);
        }
    }

    public override void Write(Utf8JsonWriter writer, GregorianDate value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        writer.WriteNumber("year", value.Year);
        writer.WriteNumber("month", value.Month);
        writer.WriteNumber("day", value.Day);
        writer.WriteEndObject();
    }
}

internal sealed class ThirteenDateJsonConverter<T> : JsonConverter<T> where T : ThirteenDate
{
    public override T? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.Null) return null;
        using var doc = JsonDocument.ParseValue(ref reader);
        return FromElement(doc.RootElement) as T ?? throw new JsonException($"Expected a {typeof(T).Name}");
    }

    internal static ThirteenDate FromElement(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.Object) throw new JsonException("ThirteenDate must be an object");
        try
        {
            var kind = e.GetProperty("kind").GetString();
            var system = CalendarSystemIdExtensions.TryParse(e.GetProperty("system").GetString(), out var s)
                ? s
                : throw new JsonException("system must be 'ifc' or 'positivist'");
            var year = e.GetProperty("year").GetInt32();
            return kind switch
            {
                "month" => new ThirteenMonthDate(year, e.GetProperty("month").GetInt32(), e.GetProperty("day").GetInt32(), system),
                "intercalary" => new ThirteenIntercalaryDate(year, IntercalaryDayIdExtensions.TryParse(e.GetProperty("id").GetString(), out var id)
                    ? id
                    : throw new JsonException("id must be 'year-day' or 'leap-day'"), system),
                _ => throw new JsonException($"kind must be 'month' or 'intercalary', got '{kind}'"),
            };
        }
        catch (ThirteenException error)
        {
            throw new JsonException(error.Message, error);
        }
        catch (KeyNotFoundException error)
        {
            throw new JsonException("ThirteenDate is missing a property", error);
        }
    }

    public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        switch (value)
        {
            case ThirteenMonthDate m:
                writer.WriteString("kind", "month");
                writer.WriteString("system", m.System.RawValue());
                writer.WriteNumber("year", m.Year);
                writer.WriteNumber("month", m.Month);
                writer.WriteNumber("day", m.Day);
                break;
            case ThirteenIntercalaryDate i:
                writer.WriteString("kind", "intercalary");
                writer.WriteString("system", i.System.RawValue());
                writer.WriteNumber("year", i.Year);
                writer.WriteString("id", i.Id.RawValue());
                break;
        }
        writer.WriteEndObject();
    }
}

internal sealed class ThirteenSlotJsonConverter : JsonConverter<ThirteenSlot>
{
    public override ThirteenSlot Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        throw new NotSupportedException("ThirteenSlot is serialise-only; rebuild slots with ThirteenSlot.InYear");

    // The nested values are written with the caller's options: a converter only runs inside a serializer
    // call, and that call (ThirteenJson, or JsonSerializer with reflection-based options) carries the
    // trimming warning itself; with source-generated options the nested types come from the context.
    [UnconditionalSuppressMessage("Trimming", "IL2026", Justification = "Runs only inside a JsonSerializer call that is annotated at its call site.")]
    [UnconditionalSuppressMessage("AOT", "IL3050", Justification = "Runs only inside a JsonSerializer call that is annotated at its call site.")]
    public override void Write(Utf8JsonWriter writer, ThirteenSlot value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        switch (value)
        {
            case ThirteenMonthSlot m:
                writer.WriteString("kind", "month");
                writer.WriteNumber("month", m.Month);
                writer.WritePropertyName("monthInfo");
                JsonSerializer.Serialize(writer, m.MonthInfo, options);
                break;
            case ThirteenIntercalarySlot i:
                writer.WriteString("kind", "intercalary");
                writer.WriteString("id", i.Id.RawValue());
                writer.WritePropertyName("occurrence");
                JsonSerializer.Serialize(writer, i.Occurrence, options);
                break;
        }
        writer.WriteEndObject();
    }
}

internal sealed class FormatOptionsJsonConverter : JsonConverter<FormatOptions>
{
    public override FormatOptions Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType != JsonTokenType.StartObject) throw new JsonException("Format options must be an object");
        DateStyle? style = null;
        bool? includeYear = null, includeWeekday = null;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            var name = reader.GetString();
            reader.Read();
            switch (name)
            {
                case "style":
                    style = new DateStyleJsonConverter().Read(ref reader, typeof(DateStyle), options);
                    break;
                case "includeYear":
                    includeYear = ReadBool(ref reader, name);
                    break;
                case "includeWeekday":
                    includeWeekday = ReadBool(ref reader, name);
                    break;
                default:
                    throw new JsonException($"Unknown format option \"{name}\" (expected 'style', 'includeYear', 'includeWeekday')");
            }
        }
        return new FormatOptions(style, includeYear, includeWeekday);
    }

    private static bool ReadBool(ref Utf8JsonReader reader, string name) => reader.TokenType switch
    {
        JsonTokenType.True => true,
        JsonTokenType.False => false,
        _ => throw new JsonException($"Format option {name} must be a boolean"),
    };

    public override void Write(Utf8JsonWriter writer, FormatOptions value, JsonSerializerOptions options)
    {
        writer.WriteStartObject();
        if (value.Style is { } style)
        {
            writer.WritePropertyName("style");
            new DateStyleJsonConverter().Write(writer, style, options);
        }
        if (value.IncludeYear is { } includeYear) writer.WriteBoolean("includeYear", includeYear);
        if (value.IncludeWeekday is { } includeWeekday) writer.WriteBoolean("includeWeekday", includeWeekday);
        writer.WriteEndObject();
    }
}
