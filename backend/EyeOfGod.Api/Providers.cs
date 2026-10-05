using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using GitHub.Copilot.SDK;

namespace EyeOfGod.Api;

public interface IAiProvider
{
    Task<T> Generate<T>(string instructions, string data, CancellationToken ct);
}

public sealed class OpenAiProvider(Settings settings, HttpClient client) : IAiProvider
{
    private string Base => settings.Provider == "openai" ? "https://api.openai.com/v1" : settings.ApiBase.TrimEnd('/');

    public async Task<T> Generate<T>(string instructions, string data, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(settings.Model))
        {
            throw new AppError("Set an AI model in Settings before generating a review.");
        }

        var schema = Output.Schema<T>();
        var payload = new JsonObject
        {
            ["model"] = settings.Model,
            [settings.Provider == "compatible" ? "max_tokens" : "max_completion_tokens"] = typeof(T) == typeof(Summary) ? 400 : 8000,
            ["messages"] = new JsonArray(
                new JsonObject
                {
                    ["role"] = "system", ["content"] = instructions + "\n\nReturn only JSON matching this schema:\n" + schema.ToJsonString(),
                }, new JsonObject { ["role"] = "user", ["content"] = data }),
        };
        if (settings.StructuredMode == "schema")
        {
            payload["response_format"] = new JsonObject
                { ["type"] = "json_schema", ["json_schema"] = new JsonObject { ["name"] = typeof(T).Name, ["strict"] = true, ["schema"] = schema } };
        }
        else if (settings.StructuredMode == "json")
        {
            payload["response_format"] = new JsonObject { ["type"] = "json_object" };
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(180));
        using var request = Request(HttpMethod.Post, "/chat/completions");
        request.Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json");
        try
        {
            using var response = await client.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                throw new AppError($"AI provider returned HTTP {(int)response.StatusCode}. Check credentials, model and output mode.", 502);
            }

            var raw = JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var message = raw?["choices"]?[0]?["message"];
            if (message?["refusal"] != null)
            {
                throw new AppError("The AI provider declined this request. No findings were accepted.", 502);
            }

            var content = message?["content"]?.GetValue<string>() ?? throw new AppError("The AI provider returned no text response.", 502);
            return Output.Parse<T>(content);
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException)
        {
            throw new AppError("AI provider request failed or timed out. Try again.", 502);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException or ArgumentOutOfRangeException)
        {
            throw new AppError("AI provider returned an unexpected response format.", 502);
        }
    }

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        if (settings.Provider == "openai" && settings.ApiKey.Length == 0)
        {
            throw new AppError("Set an API key in Settings or PRICK_API_KEY.");
        }

        var request = new HttpRequestMessage(method, Base + path);
        if (settings.ApiKey.Length > 0)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", settings.ApiKey);
        }

        return request;
    }

    public async Task<List<string>> ListModels(CancellationToken ct)
    {
        if (settings.Provider == "copilot")
        {
            throw new AppError("For Copilot, enter a model ID or use auto. Model discovery is available for OpenAI and compatible providers.");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(12));
        using var request = Request(HttpMethod.Get, "/models");
        try
        {
            using var response = await client.SendAsync(request, timeout.Token);
            if (!response.IsSuccessStatusCode)
            {
                throw new AppError(
                    $"Connection check returned HTTP {(int)response.StatusCode}. Check credentials, endpoint and Models read permission.", 502);
            }

            var raw = JsonNode.Parse(await response.Content.ReadAsStringAsync(timeout.Token));
            var rows = raw?["data"]?.AsArray() ?? throw new AppError("The provider returned an invalid model list.", 502);
            var models = rows.Select(r => r?["id"]?.GetValue<string>() ?? "").ToList();
            if (models.Any(m => string.IsNullOrWhiteSpace(m) || m.Length > 200 || m.Any(char.IsControl)))
            {
                throw new AppError("The provider returned an invalid model list.", 502);
            }

            return models.Distinct().Order().ToList();
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException)
        {
            throw new AppError("Connection check failed or timed out. Check the endpoint and network.", 502);
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            throw new AppError("The provider returned an invalid model list.", 502);
        }
    }
}

public sealed class CopilotProvider(Settings settings) : IAiProvider
{
    public async Task<T> Generate<T>(string instructions, string data, CancellationToken ct)
    {
        // An isolated working directory also prevents implicit repository instruction discovery.
        var directory = Path.Combine(Path.GetTempPath(), "eye-of-god-copilot", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        try
        {
            await using var client = new CopilotClient(new CopilotClientOptions
            {
                GitHubToken = string.IsNullOrWhiteSpace(settings.CopilotToken) ? null : settings.CopilotToken,
                CliPath = Environment.GetEnvironmentVariable("COPILOT_CLI_PATH"),
                Cwd = directory,
            });
            await using var session = await client.CreateSessionAsync(new SessionConfig
            {
                Model = string.IsNullOrWhiteSpace(settings.Model) ? "auto" : settings.Model,
                WorkingDirectory = directory,
                SystemMessage = new SystemMessageConfig
                {
                    Mode = SystemMessageMode.Append,
                    Content = instructions + "\nReturn only JSON matching this schema:\n" + Output.Schema<T>().ToJsonString(),
                },
                AvailableTools = [],
                EnableConfigDiscovery = false,
                SkillDirectories = [],
                DisabledSkills = ["*"],
                InfiniteSessions = new InfiniteSessionConfig { Enabled = false },
                OnPermissionRequest = (_, _) =>
                    Task.FromResult(new PermissionRequestResult { Kind = new PermissionRequestResultKind("denied-by-rules") }),
            }, ct);
            var response = await session.SendAndWaitAsync(new MessageOptions { Prompt = data }, TimeSpan.FromSeconds(170), ct);
            return Output.Parse<T>(response?.Data.Content ?? throw new AppError("Copilot returned no review output.", 502));
        }
        catch (AppError)
        {
            throw;
        }
        catch (Exception)
        {
            throw new AppError("Copilot SDK request failed. Check CLI installation, Copilot access, authentication and model.", 502);
        }
        finally
        {
            try
            {
                Directory.Delete(directory, true);
            }
            catch (IOException)
            {
            }
        }
    }
}

public sealed class DemoProvider : IAiProvider
{
    public Task<T> Generate<T>(string instructions, string data, CancellationToken ct)
    {
        var raw = JsonNode.Parse(data)!;
        if (typeof(T) == typeof(Summary))
        {
            return Task.FromResult((T)(object)Fixtures.Summary(raw["pr"]!["id"]!.GetValue<int>()));
        }

        if (typeof(T) == typeof(Analysis))
        {
            var findings = new List<Finding>();
            if (raw["pr"]!["id"]!.GetValue<int>() == 142)
            {
                findings.Add(new Finding("/src/retry.py", "right", 4, 4, "warning", "bug",
                    "When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling.",
                    "Handle an exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception."));
            }

            return Task.FromResult((T)(object)new Analysis(
                findings.Count == 0
                    ? "No supported findings in the supplied changes."
                    : "The retry budget can reach zero before the backoff calculation. An explicit exhausted-budget case is needed.", findings));
        }

        var presentation = raw["presentation"]!;
        int archaic = presentation["archaic_english"]!.GetValue<int>(), tone = presentation["tone"]!.GetValue<int>();
        var wording = archaic switch
        {
            0 =>
                "When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling. Handle an exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception.",
            <= 3 =>
                "When remaining is zero, calculating the backoff raises ZeroDivisionError and interrupts delivery handling. Handle the exhausted retry budget before dividing, lest delivery be interrupted; return a terminal result or raise a deliberate domain exception.",
            <= 6 =>
                "When remaining is zero, the backoff calculation doth raise ZeroDivisionError and interrupt delivery handling. Handle the exhausted retry budget before dividing; return a terminal result or raise a deliberate domain exception.",
            <= 9 =>
                "Thou shalt handle the exhausted retry budget before dividing: when remaining is zero, this backoff calculation doth raise ZeroDivisionError and interrupt delivery handling. Return a terminal result or raise a deliberate domain exception.",
            _ =>
                "Behold, gif remaining be nought, of the backoff reckoning ariseth ZeroDivisionError, wherethrough delivery handling is fordone. Ere thou dividest, forfend the retry budget's waning unto nought; a terminal result forthsend, or a deliberate domain exception uprear.",
        };
        if (tone <= 3)
        {
            wording = (archaic == 0 ? "Please consider adding this safeguard. " : "Pray, consider this safeguard. ") + wording;
        }

        if (tone >= 8)
        {
            wording = (archaic == 0
                ? "Zero is still not a valid divisor. Handle it explicitly. "
                : "Fie upon this reckoning; amend thou it forthwith. ") + wording;
        }

        return Task.FromResult((T)(object)new StyledComments(raw["findings"]!.AsArray()
            .Select(f => new StyledComment(f!["index"]!.GetValue<int>(), wording)).ToList()));
    }
}
