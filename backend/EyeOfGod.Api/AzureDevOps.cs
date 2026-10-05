using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace EyeOfGod.Api;

public sealed class AzureDevOps(Settings settings, HttpClient client) : IRepository
{
    private readonly string _root =
        $"https://dev.azure.com/{Uri.EscapeDataString(settings.Organization)}/{Uri.EscapeDataString(settings.Project)}/_apis/git/repositories/{Uri.EscapeDataString(settings.Repository)}";
    private readonly Settings _settings = Validate(settings);

    private static Settings Validate(Settings settings)
    {
        settings.Validate(true);
        return settings;
    }

    public async Task<List<PullRequest>> List(CancellationToken ct)
    {
        var result = new List<PullRequest>();
        for (var skip = 0;; skip += 100)
        {
            var raw = await Send(HttpMethod.Get, "/pullrequests", ct,
                new Dictionary<string, string> { ["searchCriteria.status"] = "active", ["$top"] = "100", ["$skip"] = skip.ToString() });
            var page = raw["value"]!.AsArray();
            result.AddRange(page.Select(n => Map(n!)));
            if (page.Count < 100)
            {
                return result.OrderByDescending(p => p.Created).ToList();
            }

            if (skip >= 900)
            {
                throw new AppError("More than 1,000 active PRs. Select a smaller repository.");
            }
        }
    }

    public async Task<PullRequest> Get(int id, CancellationToken ct)
    {
        return Map(await Send(HttpMethod.Get, $"/pullrequests/{id}", ct));
    }

    public async Task<Changes> Changes(PullRequest pr, CancellationToken ct)
    {
        var prefix = $"/pullrequests/{pr.Id}";
        var iterations = (await Send(HttpMethod.Get, prefix + "/iterations", ct))["value"]!.AsArray();
        if (iterations.Count == 0)
        {
            throw new AppError("This PR has no reviewable iterations.");
        }

        var latest = iterations.OrderByDescending(n => n!["id"]!.GetValue<int>()).First()!;
        var result = new Changes
        {
            PrId = pr.Id,
            Iteration = latest["id"]!.GetValue<int>(),
            SourceCommit = latest["sourceRefCommit"]!["commitId"]!.GetValue<string>(),
            TargetCommit = latest["targetRefCommit"]!["commitId"]!.GetValue<string>(),
            BaseCommit = latest["commonRefCommit"]?["commitId"]?.GetValue<string>() ?? "",
        };
        if (result.BaseCommit.Length == 0)
        {
            throw new AppError("Azure DevOps did not provide a common ancestor for this PR.");
        }

        if (latest["updatedDate"] is { } date)
        {
            pr.Updated = DateTimeOffset.Parse(date.GetValue<string>());
        }

        var entries = new List<JsonNode>();
        var skip = 0;
        while (true)
        {
            var page = await Send(HttpMethod.Get, $"{prefix}/iterations/{result.Iteration}/changes", ct,
                new Dictionary<string, string> { ["$compareTo"] = "0", ["$top"] = "100", ["$skip"] = skip.ToString() });
            entries.AddRange(page["changeEntries"]!.AsArray().Select(n => n!));
            if (entries.Count > 500)
            {
                throw new AppError("This PR exceeds 500 changed files. Split it before reviewing.");
            }

            var next = page["nextSkip"]?.GetValue<int>() ?? 0;
            if (next == 0)
            {
                break;
            }

            if (next <= skip)
            {
                throw new AppError("Azure DevOps returned invalid pagination for PR changes.");
            }

            skip = next;
        }

        using var semaphore = new SemaphoreSlim(6);
        var files = await Task.WhenAll(entries.Select(async (entry, index) =>
        {
            var item = entry["item"]!;
            var change = new FileChange
            {
                Path = item["path"]!.GetValue<string>(),
                OldPath = entry["originalPath"]?.GetValue<string>() ?? item["path"]!.GetValue<string>(),
                ChangeType = entry["changeType"]!.GetValue<string>(),
                TrackingId = entry["changeTrackingId"]!.GetValue<int>(),
            };
            if (item["isFolder"]?.GetValue<bool>() == true)
            {
                change.SkippedReason = "Directory entry.";
                return change;
            }

            if (index >= 100)
            {
                change.SkippedReason = "Only the first 100 files are read; excluded from analysis.";
                return change;
            }

            await semaphore.WaitAsync(ct);
            try
            {
                var kinds = change.ChangeType.Split(',').Select(k => k.Trim().ToLowerInvariant()).ToHashSet();
                var old = kinds.Contains("add") ? (Text: "", Reason: null) : await FileText(change.OldPath, result.BaseCommit, ct);
                var next = kinds.Contains("delete") ? (Text: "", Reason: null) : await FileText(change.Path, result.SourceCommit, ct);
                change.SkippedReason = old.Reason ?? next.Reason;
                if (change.SkippedReason == null)
                {
                    var diff = Diff.Create(change.Path, old.Text, next.Text);
                    change.Lines = diff.Lines;
                    change.Additions = diff.Additions;
                    change.Deletions = diff.Deletions;
                }

                return change;
            }
            finally
            {
                semaphore.Release();
            }
        }));
        result.Files = files.ToList();
        return result;
    }

    public async Task<int> Publish(int id, object payload, CancellationToken ct)
    {
        return (await Send(HttpMethod.Post, $"/pullrequests/{id}/threads", ct, body: payload))["id"]!.GetValue<int>();
    }

    private HttpRequestMessage Request(HttpMethod method, string path, Dictionary<string, string>? query = null)
    {
        query ??= [];
        query["api-version"] = "7.1";
        var message = new HttpRequestMessage(method,
            _root + path + "?" + string.Join("&", query.Select(p => $"{Uri.EscapeDataString(p.Key)}={Uri.EscapeDataString(p.Value)}")));
        message.Headers.Authorization =
            new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(":" + _settings.AzurePat)));
        return message;
    }

    private async Task<JsonNode> Send(HttpMethod method, string path, CancellationToken ct, Dictionary<string, string>? query = null,
        object? body = null)
    {
        using var request = Request(method, path, query);
        if (body != null)
        {
            request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        }

        try
        {
            using var response = await client.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode)
            {
                throw new AppError($"Azure DevOps returned HTTP {(int)response.StatusCode}. Check PAT permissions and connection settings.", 502);
            }

            return JsonNode.Parse(await response.Content.ReadAsStringAsync(ct)) ??
                   throw new AppError("Azure DevOps returned an invalid response.", 502);
        }
        catch (HttpRequestException)
        {
            throw new AppError("Could not reach Azure DevOps. Check the connection and try again.", 502);
        }
    }

    private PullRequest Map(JsonNode raw)
    {
        var id = raw["pullRequestId"]!.GetValue<int>();
        return new PullRequest
        {
            Id = id,
            Title = raw["title"]!.GetValue<string>(),
            Description = raw["description"]?.GetValue<string>() ?? "",
            Author = raw["createdBy"]?["displayName"]?.GetValue<string>() ?? "Unknown author",
            Created = DateTimeOffset.Parse(raw["creationDate"]!.GetValue<string>()),
            SourceBranch = raw["sourceRefName"]!.GetValue<string>().Replace("refs/heads/", ""),
            TargetBranch = raw["targetRefName"]!.GetValue<string>().Replace("refs/heads/", ""),
            Status = raw["status"]!.GetValue<string>(),
            Draft = raw["isDraft"]?.GetValue<bool>() ?? false,
            SourceCommit = raw["lastMergeSourceCommit"]?["commitId"]?.GetValue<string>() ?? "",
            TargetCommit = raw["lastMergeTargetCommit"]?["commitId"]?.GetValue<string>() ?? "",
            Url =
                $"https://dev.azure.com/{Uri.EscapeDataString(_settings.Organization)}/{Uri.EscapeDataString(_settings.Project)}/_git/{Uri.EscapeDataString(_settings.Repository)}/pullrequest/{id}",
        };
    }

    private async Task<(string Text, string? Reason)> FileText(string path, string commit, CancellationToken ct)
    {
        using var request = Request(HttpMethod.Get, "/items",
            new Dictionary<string, string>
                { ["path"] = path, ["versionDescriptor.version"] = commit, ["versionDescriptor.versionType"] = "commit", ["download"] = "true" });
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/octet-stream"));
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode)
        {
            throw new AppError($"Azure DevOps could not retrieve a changed file (HTTP {(int)response.StatusCode}).", 502);
        }

        using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var data = new MemoryStream();
        var buffer = new byte[8192];
        int read;
        while ((read = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (data.Length + read > 400000)
            {
                return ("", "File exceeds 400 KB; excluded from analysis.");
            }

            data.Write(buffer, 0, read);
        }

        var bytes = data.ToArray();
        if (bytes.Contains((byte)0))
        {
            return ("", "Binary file; excluded from analysis.");
        }

        string value;
        try
        {
            value = new UTF8Encoding(false, true).GetString(bytes).TrimStart('\uFEFF');
        }
        catch (DecoderFallbackException)
        {
            return ("", "Non-UTF-8 file; excluded from analysis.");
        }

        if (value.Count(c => c == '\n') + 1 > 8000)
        {
            return ("", "File exceeds 8,000 lines; excluded from analysis.");
        }

        return (value, null);
    }

    public static object ThreadPayload(Finding finding, FileChange file, Changes changes, string comment)
    {
        return new Dictionary<string, object>
        {
            ["comments"] = new[] { new { parentCommentId = 0, content = comment, commentType = 1 } },
            ["status"] = 1,
            ["threadContext"] = new Dictionary<string, object>
            {
                ["filePath"] = file.Path, [$"{finding.Side}FileStart"] = new { line = finding.LineStart, offset = 1 },
                [$"{finding.Side}FileEnd"] = new { line = finding.LineEnd, offset = 1 },
            },
            ["pullRequestThreadContext"] = new
            {
                changeTrackingId = file.TrackingId,
                iterationContext = new { firstComparingIteration = changes.Iteration, secondComparingIteration = changes.Iteration },
            },
        };
    }
}
