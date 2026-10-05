using DiffPlex.DiffBuilder;
using DiffPlex.DiffBuilder.Model;

namespace EyeOfGod.Api;

public static class Diff
{
    public static FileChange Create(string path, string before, string after, int trackingId = 1)
    {
        static string WithoutFinalLineEnding(string text)
        {
            return text.EndsWith("\r\n") ? text[..^2] : text.EndsWith('\n') || text.EndsWith('\r') ? text[..^1] : text;
        }

        var diff = InlineDiffBuilder.Diff(WithoutFinalLineEnding(before), WithoutFinalLineEnding(after), false);
        var all = new List<DiffLine>();
        int oldLine = 1, newLine = 1;
        foreach (var piece in diff.Lines)
        {
            if (piece.Type == ChangeType.Deleted)
            {
                all.Add(new DiffLine("delete", piece.Text, oldLine++));
            }
            else if (piece.Type == ChangeType.Inserted)
            {
                all.Add(new DiffLine("add", piece.Text, New: newLine++));
            }
            else
            {
                all.Add(new DiffLine("context", piece.Text, oldLine++, newLine++));
            }
        }

        // Keep three context lines around every changed line; merge overlapping windows.
        var visible = new bool[all.Count];
        for (var i = 0; i < all.Count; i++)
        {
            if (all[i].Kind != "context")
            {
                for (var j = Math.Max(0, i - 3); j <= Math.Min(all.Count - 1, i + 3); j++)
                {
                    visible[j] = true;
                }
            }
        }

        var lines = new List<DiffLine>();
        for (var i = 0; i < all.Count; i++)
        {
            if (!visible[i])
            {
                continue;
            }

            if (i == 0 || !visible[i - 1])
            {
                var end = i;
                while (end + 1 < all.Count && visible[end + 1])
                {
                    end++;
                }

                var hunk = all.GetRange(i, end - i + 1);
                var oldStart = hunk.FirstOrDefault(l => l.Old.HasValue)?.Old ?? all.Take(i).Count(l => l.Old.HasValue);
                var newStart = hunk.FirstOrDefault(l => l.New.HasValue)?.New ?? all.Take(i).Count(l => l.New.HasValue);
                lines.Add(new DiffLine("hunk", $"@@ -{oldStart},{hunk.Count(l => l.Old.HasValue)} +{newStart},{hunk.Count(l => l.New.HasValue)} @@"));
            }

            lines.Add(all[i]);
        }

        return new FileChange
        {
            Path = path,
            OldPath = path,
            TrackingId = trackingId,
            ChangeType = before.Length == 0 ? "add" : after.Length == 0 ? "delete" : "edit",
            Lines = lines,
            Additions = all.Count(l => l.Kind == "add"),
            Deletions = all.Count(l => l.Kind == "delete"),
        };
    }
}
