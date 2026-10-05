namespace EyeOfGod.Api;

public static class ReviewEngine
{
    public static string? FindingError(Finding finding, Changes changes)
    {
        if (finding.Side is not ("left" or "right") || finding.LineStart < 1 || finding.LineEnd < finding.LineStart ||
            (long)finding.LineEnd - finding.LineStart > 30)
        {
            return "Invalid finding side or line range.";
        }

        var file = changes.Files.FirstOrDefault(f => f.Path == finding.File);
        if (file == null || file.SkippedReason != null)
        {
            return "File is not among the supplied reviewable changes.";
        }

        var numbers = file.Lines.Select(l => finding.Side == "right" ? l.New : l.Old).ToHashSet();
        var required = Enumerable.Range(finding.LineStart, finding.LineEnd - finding.LineStart + 1).ToArray();
        if (!required.All(n => numbers.Contains(n)))
        {
            return "Line range is not visible in the supplied diff.";
        }

        var changed = file.Lines.Where(l => l.Kind == (finding.Side == "right" ? "add" : "delete"))
            .Select(l => finding.Side == "right" ? l.New : l.Old).ToHashSet();
        return required.Any(n => changed.Contains(n)) ? null : "Finding does not touch a changed line.";
    }

    public static bool SameRevision(Changes before, Changes after)
    {
        return before.Iteration == after.Iteration && before.SourceCommit == after.SourceCommit && before.TargetCommit == after.TargetCommit &&
               before.BaseCommit == after.BaseCommit;
    }

    public static string Neutral(Finding finding)
    {
        return $"[{finding.Severity}] {finding.Explanation}" +
               (string.IsNullOrEmpty(finding.SuggestedChange) ? "" : "\n\nSuggested change:\n" + finding.SuggestedChange);
    }

    public static async Task<Review> Generate(PullRequest pr, Changes changes, ReviewOptions options, Settings settings, IAiProvider provider,
        CancellationToken ct)
    {
        options.Validate();
        var (supplied, warnings) = Prompts.Limit(changes);
        if (!supplied.Files.Any(f => f.Lines.Any(l => l.Kind is "add" or "delete")))
        {
            throw new AppError("No reviewable text changes were available. Check file exclusions in the diff.");
        }

        var analysis = await provider.Generate<Analysis>(Prompts.Detection(options, settings.RepositoryInstructions), Prompts.Data(pr, supplied), ct);
        var valid = new List<Finding>();
        foreach (var finding in analysis.Findings)
        {
            if (FindingError(finding, supplied) is { } error)
            {
                warnings.Add($"Rejected an AI finding: {error}");
            }
            else if (!valid.Contains(finding))
            {
                valid.Add(finding);
            }
        }

        var comments = valid.Select(Neutral).ToArray();
        if (valid.Count > 0 && (options.Tone != 5 || options.ArchaicEnglish != 0))
        {
            try
            {
                var styled = await provider.Generate<StyledComments>(Prompts.Presentation(options, settings.Profanity), Json.Write(new
                {
                    findings = valid.Select((f, index) => new { index, finding = f, protected_tokens = Prompts.Protected(f) }),
                    presentation = new { options.Tone, options.ArchaicEnglish },
                }), ct);
                if (styled.Comments.Count != valid.Count ||
                    !styled.Comments.Select(c => c.Index).Order().SequenceEqual(Enumerable.Range(0, valid.Count)))
                {
                    throw new AppError("Presentation response did not preserve finding identities.");
                }

                foreach (var comment in styled.Comments)
                {
                    var finding = valid[comment.Index];
                    if (Prompts.Protected(finding).All(token => comment.Comment.Contains(token, StringComparison.Ordinal)))
                    {
                        comments[comment.Index] = $"[{finding.Severity}] {comment.Comment}";
                    }
                    else
                    {
                        warnings.Add("Presentation changed a protected identifier or code span; the original professional comment was retained.");
                    }
                }
            }
            catch (AppError)
            {
                warnings.Add("Presentation rewriting failed validation; original professional comments were retained.");
            }
        }

        return new Review
        {
            Scope = settings.Scope,
            PrId = pr.Id,
            Options = options,
            Provider = settings.Demo ? "demo" : settings.Provider,
            Model = settings.Demo ? "fixture" : settings.Model,
            Changes = supplied,
            Overview = analysis.Overview,
            Warnings = warnings,
            Findings = valid.Select((f, i) => new ReviewFinding { Finding = f, Comment = comments[i] }).ToList(),
        };
    }
}
