using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using EyeOfGod;
using EyeOfGod.Api;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace EyeOfGod.Tests;

public sealed class TestApp : WebApplicationFactory<Program>
{
    public string DataPath { get; } = Path.Combine(Path.GetTempPath(), "eye-of-god-tests", Guid.NewGuid().ToString("N"));
    public Func<HttpRequestMessage, HttpResponseMessage>? Respond { get; set; }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("PRICK_DATA_DIR", DataPath);
        builder.ConfigureTestServices(services =>
        {
            if (Respond != null)
            {
                services.RemoveAll<IHttpClientFactory>();
                services.AddSingleton<IHttpClientFactory>(new MockClients(Respond));
            }
        });
    }

    public HttpClient Client() => CreateClient(new() { BaseAddress = new Uri("http://localhost"), AllowAutoRedirect = false });

    public static Task<HttpResponseMessage> Send(HttpClient client, string method, string path, object body) =>
        client.SendAsync(new(new HttpMethod(method), path) { Content = new StringContent(Json.Write(body), Encoding.UTF8, "application/json") });

    private sealed class MockClients(Func<HttpRequestMessage, HttpResponseMessage> respond) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(new Handler(respond)) { Timeout = TimeSpan.FromSeconds(5) };
    }

    private sealed class Handler(Func<HttpRequestMessage, HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond(request));
    }
}

public class WorkflowTests
{
    [Fact]
    public async Task FullDemoReviewEditApprovePreviewAndPublishPersists()
    {
        using var app = new TestApp();
        using var client = app.Client();
        var result = await TestApp.Send(client, "POST", "/api/prs/142/review", new ReviewRequest(new(), null));
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var review = Json.Read<Review>(await result.Content.ReadAsStringAsync());
        var item = Assert.Single(review.Findings);
        Assert.Equal("draft", item.Decision);
        result = await TestApp.Send(client, "PUT", $"/api/prs/142/reviews/{review.Id}/findings/{item.Id}",
            new FindingEdit("Edited and explicitly approved", "approved"));
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        var preview = JsonNode.Parse(await client.GetStringAsync($"/api/prs/142/reviews/{review.Id}/publish"))!;
        Assert.Equal("Edited and explicitly approved", preview["approved"]![0]!["comment"]!.GetValue<string>());
        result = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish",
            new PublishRequest(preview["digest"]!.GetValue<string>(), null, "publish"));
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        result = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish",
            new PublishRequest(preview["digest"]!.GetValue<string>(), null, "publish"));
        Assert.Equal(HttpStatusCode.Conflict, result.StatusCode);
        Assert.Equal("published", app.Services.GetRequiredService<Store>().Get("demo", 142, review.Id).Findings[0].PublishState);
        Assert.Equal(HttpStatusCode.Conflict,
            (await TestApp.Send(client, "PUT", $"/api/prs/142/reviews/{review.Id}/findings/{item.Id}", new FindingEdit("retry", "draft")))
            .StatusCode);
    }

    [Fact]
    public async Task ChangedPreviewAndStaleRevisionAreRejected()
    {
        using var app = new TestApp();
        using var client = app.Client();
        var response = await TestApp.Send(client, "POST", "/api/prs/142/review", new ReviewRequest(new(), null));
        var review = Json.Read<Review>(await response.Content.ReadAsStringAsync());
        review.Findings[0].Decision = "approved";
        var store = app.Services.GetRequiredService<Store>();
        store.Save(review);
        var oldDigest = Workflow.Digest(review, null);
        review.Findings[0].Comment = "changed";
        store.Save(review);
        response = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish", new PublishRequest(oldDigest, null, "publish"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        review.Changes.SourceCommit = "old revision";
        store.Save(review);
        response = await TestApp.Send(client, "POST", $"/api/prs/142/reviews/{review.Id}/publish",
            new PublishRequest(Workflow.Digest(review, null), null, "publish"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal("unpublished", store.Get("demo", 142, review.Id).Findings[0].PublishState);
    }

    [Fact]
    public async Task ApiFallbackReturnsNotFound()
    {
        using var app = new TestApp();
        using var client = app.Client();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/nonexistent")).StatusCode);
    }

    [Fact]
    public async Task ApplicationErrorsPreserveStatusAndMessageAsJson()
    {
        using var app = new TestApp();
        using var client = app.Client();
        using var response = await client.GetAsync("/api/prs/-1");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("Demo PR not found.",
            JsonNode.Parse(await response.Content.ReadAsStringAsync())!["error"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/api/session")]
    [InlineData("/api/nonexistent")]
    [InlineData("/api/prs/-1")]
    public async Task SecurityHeadersAreIncludedOnSuccessfulAndErrorResponses(string path)
    {
        using var app = new TestApp();
        using var client = app.Client();
        using var response = await client.GetAsync(path);
        var policy = response.Headers.GetValues("Content-Security-Policy").Single();
        Assert.Contains("frame-ancestors 'none'", policy);
        Assert.Contains("style-src 'self' 'unsafe-inline'", policy);
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
    }

    [Fact]
    public async Task UnexpectedErrorsReturnJsonWithoutExposingExceptionDetails()
    {
        using var app = new TestApp
        {
            Respond = _ => throw new IOException("private-unexpected-error"),
        };
        using var client = app.Client();
        using var response = await TestApp.Send(client, "POST", "/api/settings/ai/models",
            new { provider = "compatible", api_base = "http://localhost:11434/v1", refresh = true });
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType!.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("private-unexpected-error", body);
        Assert.Equal("An unexpected server error occurred. Reload and try again.",
            JsonNode.Parse(body)!["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task CredentialsAreRedactedRetainedAndExplicitlyCleared()
    {
        using var app = new TestApp();
        using var client = app.Client();
        var response = await TestApp.Send(client, "PUT", "/api/settings",
            new { api_key = "test-private-key", azure_pat = "test-pat", copilot_token = "test-copilot" });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.DoesNotContain("test-private-key", await response.Content.ReadAsStringAsync());
        Assert.DoesNotContain("test-pat", await client.GetStringAsync("/api/session"));
        await TestApp.Send(client, "PUT", "/api/settings", new { api_key = "" });
        Assert.Equal("test-private-key", app.Services.GetRequiredService<SettingsStore>().Current.ApiKey);
        await TestApp.Send(client, "PUT", "/api/settings", new { clear_api_key = true });
        Assert.Equal("", app.Services.GetRequiredService<SettingsStore>().Current.ApiKey);
        response = await TestApp.Send(client, "PUT", "/api/settings", new { api_base = "http://user:secret@localhost/v1" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.DoesNotContain("secret", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task SandboxIsLocalAndUsesConfiguredAiEvenInDemoMode()
    {
        int calls = 0;
        using var app = new TestApp
        {
            Respond = request =>
            {
                calls++;
                return new(HttpStatusCode.OK)
                {
                    Content = new StringContent(
                        "{\"choices\":[{\"message\":{\"content\":\"{\\\"overview\\\":\\\"No findings\\\",\\\"findings\\\":[]}\"}}]}")
                };
            }
        };
        using var client = app.Client();
        await client.GetStringAsync("/api/sandbox");
        Assert.Equal(0, calls);
        await TestApp.Send(client, "PUT", "/api/settings",
            new { provider = "compatible", model = "default-model", api_base = "http://localhost:11434/v1" });
        var response = await TestApp.Send(client, "POST", "/api/sandbox/review", new ReviewRequest(new(), "override-model"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(1, calls);
        var review = Json.Read<Review>(await response.Content.ReadAsStringAsync());
        Assert.Equal(Fixtures.SandboxScope, review.Scope);
        Assert.Equal("compatible", review.Provider);
        Assert.Equal("override-model", review.Model);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/prs/1/reviews/{review.Id}/publish")).StatusCode);
        Assert.Equal("default-model", app.Services.GetRequiredService<SettingsStore>().Current.Model);
    }

    [Fact]
    public async Task InterruptedPublicationIsRecoveredWithoutLosingLegacyData()
    {
        using var app = new TestApp();
        using var client = app.Client();
        var response = await TestApp.Send(client, "POST", "/api/prs/142/review", new ReviewRequest(new(), null));
        var review = Json.Read<Review>(await response.Content.ReadAsStringAsync());
        review.Findings[0].PublishState = "publishing";
        var settings = app.Services.GetRequiredService<SettingsStore>();
        app.Services.GetRequiredService<Store>().Save(review);
        var recovered = new Store(settings).Get("demo", 142, review.Id);
        Assert.Equal("uncertain", recovered.Findings[0].PublishState);
        Assert.Equal(review.Findings[0].Comment, recovered.Findings[0].Comment);
        Assert.Equal(0, recovered.Options.ArchaicEnglish);
    }

    [Fact]
    public async Task ProviderPayloadModelListAndFailuresAreValidatedWithoutLeakingErrors()
    {
        int calls = 0;
        string payload = "";
        using var app = new TestApp
        {
            Respond = request =>
            {
                calls++;
                if (request.RequestUri!.AbsolutePath.EndsWith("/models"))
                {
                    return new(HttpStatusCode.OK)
                        { Content = new StringContent("{\"data\":[{\"id\":\"beta\"},{\"id\":\"alpha\"},{\"id\":\"alpha\"}]}") };
                }

                payload = request.Content!.ReadAsStringAsync().Result;
                return new(HttpStatusCode.Unauthorized) { Content = new StringContent("private-key-provider-error") };
            },
        };
        using var client = app.Client();
        await TestApp.Send(client, "PUT", "/api/settings",
            new { provider = "compatible", model = "local", api_base = "http://localhost:11434/v1", api_key = "private-key" });
        var response = await TestApp.Send(client, "POST", "/api/settings/ai/models", new { refresh = true });
        var models = JsonNode.Parse(await response.Content.ReadAsStringAsync())!["models"]!.AsArray();
        Assert.Equal(new[] { "alpha", "beta" }, models.Select(m => m!.GetValue<string>()));
        await TestApp.Send(client, "POST", "/api/settings/ai/models", new { refresh = false });
        Assert.Equal(1, calls);
        response = await TestApp.Send(client, "POST", "/api/sandbox/review", new ReviewRequest(new(), null));
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.DoesNotContain("private-key", await response.Content.ReadAsStringAsync());
        var data = JsonNode.Parse(payload)!;
        Assert.NotNull(data["max_tokens"]);
        Assert.Null(data["max_completion_tokens"]);
        Assert.Equal("json_schema", data["response_format"]!["type"]!.GetValue<string>());
    }
}
