using System.Text.Json;
using System.Text.Json.Nodes;

namespace EyeOfGod.Api;

public static class Output
{
    private static JsonObject Text(int max, params string[] choices)
    {
        var value = new JsonObject { ["type"] = "string", ["minLength"] = 1, ["maxLength"] = max };
        if (choices.Length > 0)
        {
            value["enum"] = new JsonArray(choices.Select(c => (JsonNode?)JsonValue.Create(c)).ToArray());
        }

        return value;
    }

    private static JsonObject Number(int min)
    {
        return new JsonObject { ["type"] = "integer", ["minimum"] = min };
    }

    private static JsonObject Array(JsonObject item)
    {
        return new JsonObject { ["type"] = "array", ["items"] = item, ["maxItems"] = 100 };
    }

    private static JsonObject Object(params (string Name, JsonObject Schema)[] fields)
    {
        return new JsonObject
        {
            ["type"] = "object",
            ["additionalProperties"] = false,
            ["properties"] = new JsonObject(fields.Select(f => new KeyValuePair<string, JsonNode?>(f.Name, f.Schema))),
            ["required"] = new JsonArray(fields.Select(f => (JsonNode?)JsonValue.Create(f.Name)).ToArray()),
        };
    }

    public static JsonObject Schema<T>()
    {
        if (typeof(T) == typeof(Summary))
        {
            return Object(("classification", Text(40, "SMALL BUGFIX", "LARGE FEATURE", "REFACTOR", "CLEANUP", "CONFIGURATION", "TESTS", "MIXED")),
                ("size", Text(10, "small", "medium", "large")), ("risk", Text(10, "low", "medium", "high")), ("description", Text(500)));
        }

        if (typeof(T) == typeof(StyledComments))
        {
            return Object(("comments", Array(Object(("index", Number(0)), ("comment", Text(12000))))));
        }

        if (typeof(T) != typeof(Analysis))
        {
            throw new InvalidOperationException("Unsupported output schema.");
        }

        var suggestion = new JsonObject { ["anyOf"] = new JsonArray(Text(6000), new JsonObject { ["type"] = "null" }) };
        return Object(("overview", Text(3000)), ("findings", Array(Object(("file", Text(1000)), ("side", Text(10, "left", "right")),
            ("line_start", Number(1)), ("line_end", Number(1)),
            ("severity", Text(20, "nit", "suggestion", "warning", "must-fix")),
            ("category", Text(30, "bug", "security", "performance", "error-handling", "maintainability", "convention", "style", "tests")),
            ("explanation", Text(6000)), ("suggested_change", suggestion)))));
    }

    private static bool Valid(JsonElement element, JsonObject schema)
    {
        if (schema["anyOf"] is JsonArray alternatives)
        {
            return alternatives.Any(s => Valid(element, s!.AsObject()));
        }

        switch (schema["type"]!.GetValue<string>())
        {
            case "null": return element.ValueKind == JsonValueKind.Null;
            case "string":
                if (element.ValueKind != JsonValueKind.String)
                {
                    return false;
                }

                var text = element.GetString()!;
                return text.Length >= schema["minLength"]!.GetValue<int>() && text.Length <= schema["maxLength"]!.GetValue<int>() &&
                       (schema["enum"] is not JsonArray choices || choices.Any(c => c!.GetValue<string>() == text));
            case "integer":
                return element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) &&
                       number >= schema["minimum"]!.GetValue<int>();
            case "array":
                return element.ValueKind == JsonValueKind.Array && element.GetArrayLength() <= schema["maxItems"]!.GetValue<int>() &&
                       element.EnumerateArray().All(e => Valid(e, schema["items"]!.AsObject()));
            case "object":
                if (element.ValueKind != JsonValueKind.Object)
                {
                    return false;
                }

                var properties = schema["properties"]!.AsObject();
                return element.EnumerateObject().Count() == properties.Count &&
                       properties.All(p => element.TryGetProperty(p.Key, out var value) && Valid(value, p.Value!.AsObject()));
            default: return false;
        }
    }

    public static T Parse<T>(string content)
    {
        if (content.Length > 200000)
        {
            throw new AppError("AI response was too large. No findings were accepted.", 502);
        }

        content = content.Trim();
        if (content.StartsWith("```json\n") && content.EndsWith("```"))
        {
            content = content[8..^3].Trim();
        }
        else if (content.StartsWith("```\n") && content.EndsWith("```"))
        {
            content = content[4..^3].Trim();
        }

        try
        {
            using var doc = JsonDocument.Parse(content);
            if (!Valid(doc.RootElement, Schema<T>()))
            {
                throw new JsonException();
            }

            var result = Json.Read<T>(content);
            if (result is Analysis analysis && analysis.Findings.Any(f => f.LineEnd < f.LineStart || (long)f.LineEnd - f.LineStart > 30))
            {
                throw new JsonException();
            }

            return result;
        }
        catch (JsonException)
        {
            throw new AppError("AI returned invalid structured output. No findings were accepted; try another model or output mode.", 502);
        }
    }
}
