using Microsoft.Data.Sqlite;

namespace EyeOfGod.Api;

public sealed class Store
{
    private readonly string _connectionString;

    public Store(SettingsStore settings)
    {
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = Path.Combine(settings.DirectoryPath, "reviews.sqlite3"),
            DefaultTimeout = 10,
        }.ToString();
        using var db = Open();
        using var command = db.CreateCommand();
        command.CommandText = """
                              CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, scope TEXT NOT NULL, pr_id INTEGER NOT NULL, created TEXT NOT NULL, body TEXT NOT NULL);
                              CREATE INDEX IF NOT EXISTS review_pr ON reviews(scope, pr_id, created);
                              CREATE TABLE IF NOT EXISTS summaries (key TEXT PRIMARY KEY, body TEXT NOT NULL);
                              """;
        command.ExecuteNonQuery();
        command.CommandText = "SELECT body FROM reviews";
        using var rows = command.ExecuteReader();
        var interrupted = new List<Review>();
        while (rows.Read())
        {
            var review = Json.Read<Review>(rows.GetString(0));
            if (review.Findings.Any(f => f.PublishState == "publishing"))
            {
                foreach (var finding in review.Findings.Where(f => f.PublishState == "publishing"))
                {
                    finding.PublishState = "uncertain";
                }

                interrupted.Add(review);
            }
        }

        rows.Close();
        foreach (var review in interrupted)
        {
            Save(review);
        }
    }

    private SqliteConnection Open()
    {
        var db = new SqliteConnection(_connectionString);
        db.Open();
        return db;
    }

    private void Execute(string sql, params (string Name, object Value)[] values)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in values)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        cmd.ExecuteNonQuery();
    }

    public void Save(Review review)
    {
        Execute("INSERT OR REPLACE INTO reviews VALUES ($id,$scope,$pr,$created,$body)",
            ("$id", review.Id), ("$scope", review.Scope), ("$pr", review.PrId), ("$created", review.Created.ToString("O")),
            ("$body", Json.Write(review)));
    }

    public List<Review> Reviews(string scope, int prId)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT body FROM reviews WHERE scope=$scope AND pr_id=$pr ORDER BY created DESC LIMIT 10";
        cmd.Parameters.AddWithValue("$scope", scope);
        cmd.Parameters.AddWithValue("$pr", prId);
        using var rows = cmd.ExecuteReader();
        var result = new List<Review>();
        while (rows.Read())
        {
            result.Add(Json.Read<Review>(rows.GetString(0)));
        }

        return result;
    }

    public Review Get(string scope, int prId, string id)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT body FROM reviews WHERE id=$id AND scope=$scope AND pr_id=$pr";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$scope", scope);
        cmd.Parameters.AddWithValue("$pr", prId);
        return cmd.ExecuteScalar() is string body ? Json.Read<Review>(body) : throw new AppError("Review not found for this repository and PR.", 404);
    }

    public Summary? Summary(string key)
    {
        using var db = Open();
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT body FROM summaries WHERE key=$key";
        cmd.Parameters.AddWithValue("$key", key);
        return cmd.ExecuteScalar() is string body ? Json.Read<Summary>(body) : null;
    }

    public void SaveSummary(string key, Summary summary)
    {
        Execute("INSERT OR REPLACE INTO summaries VALUES ($key,$body)", ("$key", key), ("$body", Json.Write(summary)));
    }
}
