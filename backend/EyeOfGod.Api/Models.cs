using System.Text.Json;
using System.Text.Json.Serialization;

namespace EyeOfGod.Api;

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = false,
    };

    public static string Write<T>(T value)
    {
        return JsonSerializer.Serialize(value, Options);
    }

    public static T Read<T>(string value)
    {
        return JsonSerializer.Deserialize<T>(value, Options) ?? throw new JsonException();
    }

    public static T Copy<T>(T value)
    {
        return Read<T>(Write(value));
    }
}

public class AppError(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}

public record ReviewOptions
{
    public int Thoroughness { get; init; } = 5;
    public int Nitpicking { get; init; } = 3;
    public int Conventions { get; init; } = 5;
    public int Tone { get; init; } = 5;
    public int ArchaicEnglish { get; init; }

    public void Validate()
    {
        if (new[] { Thoroughness, Nitpicking, Conventions, Tone }.Any(v => v is < 1 or > 10) || ArchaicEnglish is < 0 or > 10)
        {
            throw new AppError("Review values must be 1-10; Archaic English must be 0-10.");
        }
    }
}

public sealed record Summary(string Classification, string Size, string Risk, string Description);

public sealed class PullRequest
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Author { get; set; } = "";
    public DateTimeOffset Created { get; set; }
    public DateTimeOffset? Updated { get; set; }
    public string SourceBranch { get; set; } = "";
    public string TargetBranch { get; set; } = "";
    public string Status { get; set; } = "active";
    public string SourceCommit { get; set; } = "";
    public string TargetCommit { get; set; } = "";
    public bool Draft { get; set; }
    public string Url { get; set; } = "";
    public Summary? Summary { get; set; }
}

public sealed record DiffLine(string Kind, string Text, int? Old = null, int? New = null);

public sealed class FileChange
{
    public string Path { get; set; } = "";
    public string OldPath { get; set; } = "";
    public string ChangeType { get; set; } = "edit";
    public int TrackingId { get; set; }
    public List<DiffLine> Lines { get; set; } = [];
    public int Additions { get; set; }
    public int Deletions { get; set; }
    public string? SkippedReason { get; set; }
}

public sealed class Changes
{
    public int PrId { get; set; }
    public int Iteration { get; set; }
    public string SourceCommit { get; set; } = "";
    public string TargetCommit { get; set; } = "";
    public string BaseCommit { get; set; } = "";
    public List<FileChange> Files { get; set; } = [];
    [JsonIgnore] public int Additions => Files.Sum(f => f.Additions);
    [JsonIgnore] public int Deletions => Files.Sum(f => f.Deletions);
}

public sealed record Finding(
    string File,
    string Side,
    int LineStart,
    int LineEnd,
    string Severity,
    string Category,
    string Explanation,
    string? SuggestedChange);

public sealed record Analysis(string Overview, List<Finding> Findings);

public sealed record StyledComment(int Index, string Comment);

public sealed record StyledComments(List<StyledComment> Comments);

public sealed class ReviewFinding
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public Finding Finding { get; set; } = null!;
    public string Comment { get; set; } = "";
    public string Decision { get; set; } = "draft";
    public string PublishState { get; set; } = "unpublished";
    public int? ThreadId { get; set; }
}

public sealed class Review
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Scope { get; set; } = "";
    public int PrId { get; set; }
    public DateTimeOffset Created { get; set; } = DateTimeOffset.UtcNow;
    public ReviewOptions Options { get; set; } = new();
    public string Provider { get; set; } = "";
    public string Model { get; set; } = "";
    public Changes Changes { get; set; } = null!;
    public string Overview { get; set; } = "";
    public List<ReviewFinding> Findings { get; set; } = [];
    public List<string> Warnings { get; set; } = [];
}

public sealed record ReviewRequest(ReviewOptions Options, string? Model);

public sealed record FindingEdit(string Comment, string Decision);

public sealed record PublishRequest(string Digest, string? FindingId, string Confirm);
