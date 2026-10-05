using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace EyeOfGod.Api;

public sealed class Workflow(SettingsStore settings, Store store, IHttpClientFactory clients)
{
    public readonly SemaphoreSlim Mutation = new(1);
    private readonly SemaphoreSlim _modelLock = new(1);
    private readonly SemaphoreSlim _summaryLock = new(1);
    private List<string> _catalog = [];
    private string? _catalogKey;
    private DateTimeOffset _checkedAt;

    public IRepository Repository(Settings? configuration = null)
    {
        var current = configuration ?? settings.Current;
        return current.Demo ? new DemoRepository() : new AzureDevOps(current, clients.CreateClient("external"));
    }

    private IAiProvider Provider(Settings current)
    {
        return current.Demo ? new DemoProvider() :
            current.Provider == "copilot" ? new CopilotProvider(current) : new OpenAiProvider(current, clients.CreateClient("external"));
    }

    public async Task<object> Details(int id, bool sandbox, CancellationToken ct)
    {
        PullRequest pr;
        Changes changes;
        var current = settings.Current;
        if (sandbox)
        {
            (pr, changes) = Fixtures.Sandbox();
        }
        else
        {
            var repository = Repository(current);
            pr = await repository.Get(id, ct);
            changes = await repository.Changes(pr, ct);
        }

        return new { pr, changes, reviews = store.Reviews(sandbox ? Fixtures.SandboxScope : current.Scope, pr.Id), sandbox };
    }

    public async Task<Review> Generate(int id, bool sandbox, ReviewRequest request, CancellationToken ct)
    {
        var current = settings.Current with { Demo = sandbox ? false : settings.Current.Demo };
        current = current with { Model = string.IsNullOrWhiteSpace(request.Model) ? current.Model : request.Model.Trim() };
        current.Validate();
        if (request.Options == null)
        {
            throw new AppError("Review options are required.");
        }

        request.Options.Validate();
        PullRequest pr;
        Changes changes;
        if (sandbox)
        {
            (pr, changes) = Fixtures.Sandbox();
        }
        else
        {
            var repository = Repository(current);
            pr = await repository.Get(id, ct);
            changes = await repository.Changes(pr, ct);
        }

        var review = await ReviewEngine.Generate(pr, changes, request.Options, current, Provider(current), ct);
        if (sandbox)
        {
            review.Scope = Fixtures.SandboxScope;
        }

        store.Save(review);
        return review;
    }

    public async Task<object> Summary(int id, CancellationToken ct)
    {
        var current = settings.Current;
        var repository = Repository(current);
        var pr = await repository.Get(id, ct);
        var changes = await repository.Changes(pr, ct);
        var key = Hash(Json.Write(new
        {
            current.Scope, id, changes.SourceCommit, changes.TargetCommit, changes.BaseCommit, current.Provider, current.Model, current.ApiBase,
            current.StructuredMode,
        }));
        var (sample, warnings) = Prompts.Limit(changes, 8000);
        await _summaryLock.WaitAsync(ct);
        try
        {
            var summary = store.Summary(key);
            if (summary == null)
            {
                summary = await Provider(current).Generate<Summary>(Prompts.Summary, Prompts.Data(pr, sample), ct);
                store.SaveSummary(key, summary);
            }

            return new { summary, partial = warnings.Count > 0, additions = changes.Additions, deletions = changes.Deletions, updated = pr.Updated };
        }
        finally
        {
            _summaryLock.Release();
        }
    }

    public async Task<object> Models(JsonObject edits, CancellationToken ct)
    {
        var current = settings.Merge(edits);
        var key = Hash(Json.Write(new { current.Provider, current.ApiBase, current.ApiKey }));
        await _modelLock.WaitAsync(ct);
        try
        {
            if (edits["refresh"]?.GetValue<bool>() == true || key != _catalogKey || DateTimeOffset.UtcNow - _checkedAt > TimeSpan.FromMinutes(5))
            {
                _catalogKey = null;
                _catalog = [];
                _catalog = await new OpenAiProvider(current, clients.CreateClient("external")).ListModels(ct);
                _catalogKey = key;
                _checkedAt = DateTimeOffset.UtcNow;
            }

            return new
            {
                models = _catalog, provider = current.Provider, checked_at = _checkedAt,
                message = $"Connection verified. {_catalog.Count} available model(s).",
            };
        }
        finally
        {
            _modelLock.Release();
        }
    }

    public Review Edit(int id, string reviewId, string findingId, FindingEdit edit)
    {
        var review = store.Get(settings.Current.Scope, id, reviewId);
        var item = review.Findings.FirstOrDefault(f => f.Id == findingId) ?? throw new AppError("Finding not found.", 404);
        if (item.PublishState != "unpublished")
        {
            throw new AppError("This comment has been posted or has an unresolved publishing outcome.", 409);
        }

        var comment = edit.Comment?.Trim() ?? "";
        if (comment.Length is < 1 or > 12000 || edit.Decision is not ("draft" or "approved" or "ignored"))
        {
            throw new AppError("Enter a comment of 1-12,000 characters and a valid decision.");
        }

        item.Comment = comment;
        item.Decision = edit.Decision;
        store.Save(review);
        return review;
    }

    public static List<ReviewFinding> Approved(Review review, string? only)
    {
        return review.Findings.Where(f => f.Decision == "approved" && f.PublishState == "unpublished" && (only == null || f.Id == only)).ToList();
    }

    public static string Hash(string value)
    {
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    }

    public static string Digest(Review review, string? only)
    {
        return Hash(Json.Write(new { review = review.Id, scope = review.Scope, changes = review.Changes, comments = Approved(review, only) }));
    }

    public object Preview(int id, string reviewId, string? findingId)
    {
        var review = store.Get(settings.Current.Scope, id, reviewId);
        return new
        {
            review, approved = Approved(review, findingId), digest = Digest(review, findingId), finding_id = findingId, demo = settings.Current.Demo,
        };
    }

    public async Task<object> Publish(int id, string reviewId, PublishRequest request, CancellationToken ct)
    {
        var currentSettings = settings.Current;
        var review = store.Get(currentSettings.Scope, id, reviewId);
        var approved = Approved(review, request.FindingId);
        if (request.Confirm != "publish" || approved.Count == 0)
        {
            throw new AppError("No approved unpublished comments were selected.", 409);
        }

        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(request.Digest ?? ""),
                Encoding.UTF8.GetBytes(Digest(review, request.FindingId))))
        {
            throw new AppError("Approved comments changed since the preview. Open the preview again before posting.", 409);
        }

        var repository = Repository(currentSettings);
        var pr = await repository.Get(id, ct);
        var changes = await repository.Changes(pr, ct);
        if (pr.Status != "active" || !ReviewEngine.SameRevision(review.Changes, changes) ||
            (pr.SourceCommit.Length > 0 && pr.SourceCommit != changes.SourceCommit) ||
            (pr.TargetCommit.Length > 0 && pr.TargetCommit != changes.TargetCommit))
        {
            throw new AppError("The PR changed or is no longer active. Generate and approve a new review.", 409);
        }

        if (approved.Any(f => ReviewEngine.FindingError(f.Finding, review.Changes) != null || ReviewEngine.FindingError(f.Finding, changes) != null))
        {
            throw new AppError("A finding no longer refers to valid changed lines. Generate a new review.", 409);
        }

        var posted = 0;
        foreach (var item in approved)
        {
            var file = changes.Files.Single(f => f.Path == item.Finding.File);
            var payload = AzureDevOps.ThreadPayload(item.Finding, file, changes, item.Comment);
            ct.ThrowIfCancellationRequested();
            item.PublishState = "publishing";
            store.Save(review);
            try
            {
                item.ThreadId = await repository.Publish(id, payload, ct);
                item.PublishState = "published";
                posted++;
            }
            catch (Exception)
            {
                item.PublishState = "uncertain";
                store.Save(review);
                throw new AppError(
                    $"{posted} comment(s) posted. The next outcome is uncertain. Check Azure DevOps manually; this comment is blocked from re-posting.",
                    502);
            }

            store.Save(review);
        }

        return new { posted, demo = currentSettings.Demo };
    }
}
