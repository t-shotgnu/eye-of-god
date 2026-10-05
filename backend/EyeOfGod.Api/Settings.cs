using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace EyeOfGod.Api;

public sealed record Settings
{
    public bool Demo { get; init; } = true;
    public string Organization { get; init; } = "";
    public string Project { get; init; } = "";
    public string Repository { get; init; } = "";
    public string AzurePat { get; init; } = "";
    public string Provider { get; init; } = "openai";
    public string Model { get; init; } = "";
    public string ApiBase { get; init; } = "https://api.openai.com/v1";
    public string ApiKey { get; init; } = "";
    public string StructuredMode { get; init; } = "schema";
    public string CopilotToken { get; init; } = "";
    public bool Profanity { get; init; }
    public string RepositoryInstructions { get; init; } = "";
    public ReviewOptions Defaults { get; init; } = new();
    [JsonIgnore] public string Scope => Demo ? "demo" : $"{Organization}/{Project}/{Repository}";

    public void Validate(bool requireAzure = false)
    {
        Defaults.Validate();
        if (!Regex.IsMatch(Organization, "^[A-Za-z0-9_-]*$"))
        {
            throw new AppError("Enter an organization name, not a URL.");
        }

        if (!Uri.TryCreate(ApiBase, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") || uri.UserInfo != "" ||
            uri.Query != "" || uri.Fragment != "")
        {
            throw new AppError("API base must be an HTTP(S) URL without credentials, query or fragment.");
        }

        if (Provider is not ("openai" or "compatible" or "copilot") || StructuredMode is not ("schema" or "json" or "prompt"))
        {
            throw new AppError("Invalid provider or output mode.");
        }

        if (RepositoryInstructions.Length > 20000)
        {
            throw new AppError("Repository instructions exceed 20,000 characters.");
        }

        if (Model.Length > 200 || Model.Any(char.IsControl))
        {
            throw new AppError("Model ID must be at most 200 characters without control characters.");
        }

        if (requireAzure && new[] { Organization, Project, Repository, AzurePat }.Any(string.IsNullOrWhiteSpace))
        {
            throw new AppError("Configure Azure DevOps organization, project, repository and PAT in Settings.");
        }
    }
}

public sealed class SettingsStore
{
    public static readonly Dictionary<string, string> EnvironmentFields = new()
    {
        ["organization"] = "PRICK_AZURE_ORGANIZATION",
        ["project"] = "PRICK_AZURE_PROJECT",
        ["repository"] = "PRICK_AZURE_REPOSITORY",
        ["azure_pat"] = "PRICK_AZURE_PAT",
        ["provider"] = "PRICK_PROVIDER",
        ["model"] = "PRICK_MODEL",
        ["api_base"] = "PRICK_API_BASE",
        ["api_key"] = "PRICK_API_KEY",
        ["copilot_token"] = "PRICK_COPILOT_TOKEN",
        ["demo"] = "PRICK_DEMO",
    };

    private static readonly string[] Secrets = ["azure_pat", "api_key", "copilot_token"];

    public SettingsStore(IConfiguration configuration, IHostEnvironment environment)
    {
        var root = new DirectoryInfo(environment.ContentRootPath);
        while (root.Parent != null && !File.Exists(Path.Combine(root.FullName, "EyeOfGod.slnx")))
        {
            root = root.Parent;
        }

        var defaultRoot = File.Exists(Path.Combine(root.FullName, "EyeOfGod.slnx")) ? root.FullName : environment.ContentRootPath;
        DirectoryPath = Path.GetFullPath(configuration["PRICK_DATA_DIR"] ?? Path.Combine(defaultRoot, ".data"));
        Directory.CreateDirectory(DirectoryPath);
        Current = Load();
    }

    public string DirectoryPath { get; }
    private string PathName => Path.Combine(DirectoryPath, "settings.json");
    public Settings Current { get; private set; }

    private JsonObject Saved()
    {
        return File.Exists(PathName) ? JsonNode.Parse(File.ReadAllText(PathName))!.AsObject() : new JsonObject();
    }

    public Settings Load()
    {
        var data = Saved();
        ApplyEnvironment(data);
        var settings = Json.Read<Settings>(data.ToJsonString());
        settings.Validate();
        return settings;
    }

    private static void ApplyEnvironment(JsonObject data)
    {
        foreach (var (name, variable) in EnvironmentFields)
        {
            if (Environment.GetEnvironmentVariable(variable) is { } value)
            {
                if (name == "demo")
                {
                    data[name] = value.ToLowerInvariant() is "true" or "1" or "yes";
                }
                else
                {
                    data[name] = value;
                }
            }
        }
    }

    public object Public()
    {
        return new
        {
            settings = new
            {
                Current.Demo,
                Current.Organization,
                Current.Project,
                Current.Repository,
                Current.Provider,
                Current.Model,
                Current.ApiBase,
                Current.StructuredMode,
                Current.Profanity,
                Current.RepositoryInstructions,
                Current.Defaults,
            },
            credentials = new
                { azure_pat = Current.AzurePat.Length > 0, api_key = Current.ApiKey.Length > 0, copilot_token = Current.CopilotToken.Length > 0 },
            environment_fields = EnvironmentFields.Where(p => Environment.GetEnvironmentVariable(p.Value) != null).ToDictionary(),
        };
    }

    public Settings Merge(JsonObject edits)
    {
        var data = JsonNode.Parse(Json.Write(Current))!.AsObject();
        foreach (var field in data.Select(p => p.Key).ToArray())
        {
            if (Secrets.Contains(field))
            {
                if (edits[$"clear_{field}"]?.GetValue<bool>() == true)
                {
                    data[field] = "";
                }
                else if (edits[field] is JsonValue value && !string.IsNullOrWhiteSpace(value.GetValue<string>()))
                {
                    data[field] = value.GetValue<string>().Trim();
                }
            }
            else if (edits.TryGetPropertyValue(field, out var value))
            {
                data[field] = value?.DeepClone() ?? throw new AppError("Settings fields cannot be null.");
            }
        }

        ApplyEnvironment(data);
        var settings = Json.Read<Settings>(data.ToJsonString());
        settings.Validate();
        return settings;
    }

    public void Save(JsonObject edits)
    {
        var settings = Merge(edits);
        settings.Validate(!settings.Demo);
        var data = JsonNode.Parse(Json.Write(settings))!.AsObject();
        var previous = Saved();
        var defaults = JsonNode.Parse(Json.Write(new Settings()))!.AsObject();
        foreach (var (field, variable) in EnvironmentFields)
        {
            if (Environment.GetEnvironmentVariable(variable) != null)
            {
                data[field] = (previous[field] ?? defaults[field])?.DeepClone();
            }
        }

        var temporary = PathName + ".tmp";
        File.WriteAllText(temporary, data.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        if (!OperatingSystem.IsWindows())
        {
            File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        }

        File.Move(temporary, PathName, true);
        Current = Load();
    }
}
