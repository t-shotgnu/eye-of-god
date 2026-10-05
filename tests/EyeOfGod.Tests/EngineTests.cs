using System.Text.Json;
using EyeOfGod.Api;
using Xunit;

namespace EyeOfGod.Tests;

public class EngineTests
{
    [Fact]
    public void PresentationControlsDoNotEnterDetection()
    {
        var options = new ReviewOptions();
        Assert.Equal(Prompts.Detection(options, "Use domain exceptions"), Prompts.Detection(options with { Tone = 10, ArchaicEnglish = 10 }, "Use domain exceptions"));
        Assert.NotEqual(Prompts.Detection(options, ""), Prompts.Detection(options with { Thoroughness = 10 }, ""));
        Assert.Contains("EVERY", Prompts.Presentation(options with { ArchaicEnglish = 10 }, false));
        Assert.Contains("Do not use profanity", Prompts.Presentation(options with { Tone = 3 }, true));
    }
    [Theory]
    [InlineData(0, 0, false)]
    [InlineData(1, 0, true)]
    [InlineData(10, 10, true)]
    [InlineData(11, 0, false)]
    [InlineData(5, -1, false)]
    [InlineData(5, 11, false)]
    public void SlidersHaveIndependentBounds(int thoroughness, int archaic, bool valid)
    {
        var options = new ReviewOptions { Thoroughness = thoroughness, ArchaicEnglish = archaic };
        if (valid)
        {
            options.Validate();
        }
        else
        {
            Assert.Throws<AppError>(options.Validate);
        }
    }
    [Fact]
    public void ExactFileSideRangeAndChangedLinesAreRequired()
    {
        var changes = Fixtures.Changes(Fixtures.Pr(142));
        var finding = new Finding("/src/retry.py", "right", 4, 4, "warning", "bug", "Zero divisor", null);
        Assert.Null(ReviewEngine.FindingError(finding, changes));
        Assert.NotNull(ReviewEngine.FindingError(finding with { File = "src/retry.py" }, changes));
        Assert.NotNull(ReviewEngine.FindingError(finding with { Side = "left" }, changes));
        Assert.NotNull(ReviewEngine.FindingError(finding with { LineStart = 400, LineEnd = 400 }, changes));
        Assert.NotNull(ReviewEngine.FindingError(finding with { LineStart = 4, LineEnd = 3 }, changes));
        Assert.NotNull(ReviewEngine.FindingError(finding with { LineEnd = int.MaxValue }, changes));
        var contextual = new Changes { Files = [Diff.Create("/a", "one\ntwo\nthree\n", "one\nchanged\nthree\n")] };
        Assert.NotNull(ReviewEngine.FindingError(finding with { File = "/a", LineStart = 1, LineEnd = 1 }, contextual));
    }
    [Fact]
    public void BudgetKeepsOnlyCompleteEvidenceAndExclusions()
    {
        var original = Fixtures.Changes(Fixtures.Pr(142));
        var (limited, warnings) = Prompts.Limit(original, 90);
        Assert.NotEmpty(warnings);
        Assert.True(limited.Files[0].Lines.Count < original.Files[0].Lines.Count);
        var finding = new Finding("/src/retry.py", "right", 4, 4, "warning", "bug", "Division", null);
        Assert.NotNull(ReviewEngine.FindingError(finding, limited));
        Assert.NotEmpty(original.Files[0].Lines);
    }
    [Fact]
    public void DiffUsesExactLineNumbersAndBoundsContext()
    {
        var before = string.Join('\n', Enumerable.Range(1, 30).Select(n => $"line {n}"));
        var after = before.Replace("line 5\n", "changed 5\n").Replace("line 25\n", "changed 25\n");
        var diff = Diff.Create("/a", before, after);
        Assert.Equal(2, diff.Additions); Assert.Equal(2, diff.Deletions);
        Assert.Equal(new[] { 5, 25 }, diff.Lines.Where(l => l.Kind == "add").Select(l => l.New!.Value));
        Assert.Equal(2, diff.Lines.Count(l => l.Kind == "hunk"));
        Assert.DoesNotContain(diff.Lines, l => l.Old == 15);
        Assert.Empty(Diff.Create("/a", "same\n", "same\n").Lines);
        Assert.Equal(1, Diff.Create("/a", "", "new\n").Additions);
        Assert.Equal(1, Diff.Create("/a", "old\n", "").Deletions);
        Assert.Equal(1, Diff.Create("/a", "one\n", "one\n\n").Additions);
    }
    [Fact]
    public void StructuredOutputRejectsUnexpectedMissingAndWronglyTypedFields()
    {
        var analysis = new Analysis("No findings", []);
        Assert.Empty(Output.Parse<Analysis>(Json.Write(analysis)).Findings);
        Assert.Empty(Output.Parse<Analysis>("```json\n" + Json.Write(analysis) + "\n```").Findings);
        Assert.Throws<AppError>(() => Output.Parse<Analysis>("{\"overview\":\"Okay\",\"findings\":[],\"extra\":true}"));
        Assert.Throws<AppError>(() => Output.Parse<Analysis>("{\"overview\":\"Okay\"}"));
        Assert.Throws<AppError>(() => Output.Parse<Analysis>("{\"overview\":42,\"findings\":[]}"));
        Assert.Throws<AppError>(() => Output.Parse<Summary>(Json.Write(new Summary("UNKNOWN", "small", "low", "desc"))));
        Assert.Throws<AppError>(() => Output.Parse<Analysis>(new string('x', 200001)));
        var bad = new Analysis("Issue", [new("/a", "right", 4, 3, "warning", "bug", "Explanation", null)]);
        Assert.Throws<AppError>(() => Output.Parse<Analysis>(Json.Write(bad)));
    }
    [Fact]
    public async Task InvalidPresentationRetainsNeutralTechnicalFindings()
    {
        var finding = new Finding("/src/retry.py", "right", 4, 4, "warning", "bug", "Use `CancellationToken` with Task.Delay and userId at /api/users.", "Call SendAsync before updating user_id.");
        var provider = new FixedProvider(new("Issue", [finding]), new([new(0, "Changed all identifiers")]));
        var review = await ReviewEngine.Generate(Fixtures.Pr(142), Fixtures.Changes(Fixtures.Pr(142)), new() { Tone = 10, ArchaicEnglish = 10 }, new Settings(), provider, default);
        Assert.Equal(finding, review.Findings[0].Finding);
        Assert.Equal(ReviewEngine.Neutral(finding), review.Findings[0].Comment);
        Assert.Contains(review.Warnings, w => w.Contains("protected identifier"));
        Assert.Contains("`CancellationToken`", Prompts.Protected(finding));
    }
    [Fact]
    public async Task DetectionRejectsInvalidLocationsAndDeduplicates()
    {
        var finding = new Finding("/src/retry.py", "right", 4, 4, "warning", "bug", "Issue", null);
        var provider = new FixedProvider(new("Issues", [finding, finding, finding with { File = "/missing" }]), new([]));
        var result = await ReviewEngine.Generate(Fixtures.Pr(142), Fixtures.Changes(Fixtures.Pr(142)), new(), new(), provider, default);
        Assert.Single(result.Findings); Assert.Single(result.Warnings);
    }
    [Fact]
    public void AzureThreadPayloadUsesCamelCaseAndMatchingIterationIds()
    {
        var changes = Fixtures.Changes(Fixtures.Pr(142));
        var finding = new Finding("/src/retry.py", "left", 1, 2, "warning", "bug", "Issue", null);
        using var payload = JsonDocument.Parse(JsonSerializer.Serialize(AzureDevOps.ThreadPayload(finding, changes.Files[0], changes, "edited")));
        Assert.Equal("edited", payload.RootElement.GetProperty("comments")[0].GetProperty("content").GetString());
        Assert.Equal(1, payload.RootElement.GetProperty("threadContext").GetProperty("leftFileStart").GetProperty("line").GetInt32());
        Assert.Equal(changes.Iteration, payload.RootElement.GetProperty("pullRequestThreadContext").GetProperty("iterationContext").GetProperty("firstComparingIteration").GetInt32());
    }
    [Fact]
    public void EveryRevisionComponentAndPreviewTextAffectsGuards()
    {
        var changes = Fixtures.Changes(Fixtures.Pr(142)); var copied = Json.Copy(changes);
        Assert.True(ReviewEngine.SameRevision(changes, copied)); copied.BaseCommit = "different"; Assert.False(ReviewEngine.SameRevision(changes, copied));
        var review = new Review { Scope = "demo", Changes = changes, Findings = [new() { Finding = new("/src/retry.py", "right", 4, 4, "warning", "bug", "Issue", null), Comment = "before", Decision = "approved" }] };
        var digest = Workflow.Digest(review, null); review.Findings[0].Comment = "after";
        Assert.NotEqual(digest, Workflow.Digest(review, null));
    }
    private sealed class FixedProvider(Analysis analysis, StyledComments styled) : IAiProvider
    {
        public Task<T> Generate<T>(string instructions, string data, CancellationToken ct) => Task.FromResult((T)(typeof(T) == typeof(Analysis) ? (object)analysis : styled));
    }
}
