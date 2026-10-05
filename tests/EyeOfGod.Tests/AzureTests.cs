using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using EyeOfGod;
using EyeOfGod.Api;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace EyeOfGod.Tests;

public class AzureTests
{
    private static readonly Settings Configuration = new()
        { Demo = false, Organization = "org", Project = "project space", Repository = "repo", AzurePat = "test-pat" };

    private static object RawPr() => new
    {
        pullRequestId = 142, title = "Change", description = "Description", createdBy = new { displayName = "Author" },
        creationDate = "2026-10-03T12:00:00Z", sourceRefName = "refs/heads/feature", targetRefName = "refs/heads/main", status = "active",
        lastMergeSourceCommit = new { commitId = "source" }, lastMergeTargetCommit = new { commitId = "target" },
    };

    private static HttpResponseMessage Response(object body) => new(HttpStatusCode.OK)
        { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };

    private static HttpResponseMessage Iterations() => Response(new
    {
        value = new[]
        {
            new
            {
                id = 2, sourceRefCommit = new { commitId = "source" }, targetRefCommit = new { commitId = "target" },
                commonRefCommit = new { commitId = "base" }, updatedDate = "2026-10-04T08:00:00Z",
            },
        },
    });

    private static HttpResponseMessage Changes() => Response(new
    {
        changeEntries = new[]
        {
            new { item = new { path = "/new.py", isFolder = false }, originalPath = "/old.py", changeType = "rename, edit", changeTrackingId = 8 },
        },
        nextSkip = 0,
    });

    private static HttpResponseMessage Read(HttpRequestMessage request)
    {
        var path = request.RequestUri!.AbsolutePath;
        if (path.EndsWith("/iterations"))
        {
            return Iterations();
        }

        if (path.EndsWith("/changes"))
        {
            return Changes();
        }

        if (path.EndsWith("/items"))
        {
            return new(HttpStatusCode.OK)
            {
                Content = new StringContent(request.RequestUri.Query.Contains("versionDescriptor.version=base") ? "return old\n" : "return new\n"),
            };
        }

        return Response(RawPr());
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }

    [Fact]
    public async Task RenameReadsOldPathAtBaseAndNewPathAtImmutableSource()
    {
        var requests = new List<string>();
        using var client = new HttpClient(new Handler(request =>
        {
            requests.Add(request.RequestUri!.ToString());
            Assert.Equal("Basic", request.Headers.Authorization!.Scheme);
            Assert.Equal(":test-pat", Encoding.UTF8.GetString(Convert.FromBase64String(request.Headers.Authorization.Parameter!)));
            return Read(request);
        }));
        var azure = new AzureDevOps(Configuration, client);
        var pr = await azure.Get(142, CancellationToken.None);
        var changes = await azure.Changes(pr, CancellationToken.None);
        Assert.Equal("feature", pr.SourceBranch);
        Assert.Equal(2, changes.Iteration);
        Assert.Equal("base", changes.BaseCommit);
        var file = Assert.Single(changes.Files);
        Assert.Equal("/old.py", file.OldPath);
        Assert.Equal(8, file.TrackingId);
        Assert.Equal(1, file.Additions);
        Assert.Equal(1, file.Deletions);
        Assert.Contains(requests, p => p.Contains("path=%2Fold.py") && p.Contains("versionDescriptor.version=base"));
        Assert.Contains(requests, p => p.Contains("path=%2Fnew.py") && p.Contains("versionDescriptor.version=source"));
        Assert.Contains(requests, p => p.Contains("%24compareTo=0"));
        Assert.All(requests, p => Assert.Contains("api-version=7.1", p));
    }

    [Theory]
    [InlineData("binary")]
    [InlineData("oversize")]
    [InlineData("encoding")]
    [InlineData("lines")]
    public async Task UnreviewableFilesAreExplicitlyExcluded(string kind)
    {
        using var client = new HttpClient(new Handler(request =>
        {
            if (!request.RequestUri!.AbsolutePath.EndsWith("/items"))
            {
                return Read(request);
            }

            byte[] bytes = kind switch
            {
                "binary" => [0, 1], "oversize" => new byte[400001], "encoding" => [255, 254, 253],
                _ => Encoding.UTF8.GetBytes(string.Join('\n', Enumerable.Repeat("line", 8001))),
            };
            return new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) };
        }));
        var azure = new AzureDevOps(Configuration, client);
        var changes = await azure.Changes(await azure.Get(142, CancellationToken.None), CancellationToken.None);
        Assert.NotNull(changes.Files[0].SkippedReason);
        Assert.Empty(changes.Files[0].Lines);
    }

    [Fact]
    public async Task InvalidPaginationAndMissingIterationsFailClearly()
    {
        using var client = new HttpClient(new Handler(request =>
            request.RequestUri!.AbsolutePath.EndsWith("/changes")
                ? Response(new { changeEntries = Array.Empty<object>(), nextSkip = 1 })
                : Read(request)));
        var azure = new AzureDevOps(Configuration, client);
        Assert.Contains("pagination", (await Assert.ThrowsAsync<AppError>(() => azure.Changes(Fixtures.Pr(142), CancellationToken.None))).Message);
        using var empty = new HttpClient(new Handler(_ => Response(new { value = Array.Empty<object>() })));
        Assert.Contains("iterations",
            (await Assert.ThrowsAsync<AppError>(() => new AzureDevOps(Configuration, empty).Changes(Fixtures.Pr(142), CancellationToken.None)))
            .Message);
    }

    [Fact]
    public async Task PartialPublicationPersistsSuccessAndBlocksUncertainComment()
    {
        int posts = 0;
        using var app = new TestApp
        {
            Respond = request =>
            {
                if (request.Method != HttpMethod.Post)
                {
                    return Read(request);
                }

                posts++;
                if (posts == 2)
                {
                    throw new HttpRequestException("Unknown remote outcome");
                }

                var body = JsonNode.Parse(request.Content!.ReadAsStringAsync().Result)!;
                Assert.Equal("approved text", body["comments"]![0]!["content"]!.GetValue<string>());
                Assert.Equal("/new.py", body["threadContext"]!["filePath"]!.GetValue<string>());
                return Response(new { id = 123 });
            },
        };
        using var client = app.Client();
        var response = await TestApp.Send(client, "PUT", "/api/settings", Configuration);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var changes = new Changes
        {
            PrId = 142, Iteration = 2, SourceCommit = "source", TargetCommit = "target", BaseCommit = "base",
            Files = [Diff.Create("/new.py", "return old\n", "return new\n")],
        };
        changes.Files[0].TrackingId = 8;
        var finding = new Finding("/new.py", "right", 1, 1, "warning", "bug", "Issue", null);
        var review = new Review
        {
            Scope = Configuration.Scope, PrId = 142, Changes = changes,
            Findings =
            [
                new() { Finding = finding, Comment = "approved text", Decision = "approved" },
                new() { Finding = finding, Comment = "approved text", Decision = "approved" },
            ],
        };
        var store = app.Services.GetRequiredService<Store>();
        store.Save(review);
        response = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish",
            new PublishRequest(Workflow.Digest(review, null), null, "publish"));
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var saved = store.Get(Configuration.Scope, 142, review.Id);
        Assert.Equal("published", saved.Findings[0].PublishState);
        Assert.Equal(123, saved.Findings[0].ThreadId);
        Assert.Equal("uncertain", saved.Findings[1].PublishState);
        response = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish",
            new PublishRequest(Workflow.Digest(saved, null), null, "publish"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(2, posts);
    }
}
