using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class PullRequestsController(Workflow workflow) : ControllerBase
{
    [HttpGet("/api/prs")]
    public Task<List<PullRequest>> List(CancellationToken ct) => workflow.Repository().List(ct);

    [HttpGet("/api/prs/{id:int}")]
    public Task<object> Details(int id, CancellationToken ct) => workflow.Details(id, false, ct);

    [HttpGet("/api/prs/{id:int}/summary")]
    public Task<object> Summary(int id, CancellationToken ct) => workflow.Summary(id, ct);

    [HttpPost("/api/prs/{id:int}/review")]
    public Task<Review> Review(int id, [FromBody] ReviewRequest request, CancellationToken ct) =>
        workflow.Generate(id, false, request, ct);

    [HttpPut("/api/prs/{id:int}/reviews/{reviewId}/findings/{findingId}")]
    public async Task<object> Edit(int id, string reviewId, string findingId, [FromBody] FindingEdit request,
        CancellationToken ct)
    {
        await workflow.Mutation.WaitAsync(ct);
        try
        {
            return workflow.Edit(id, reviewId, findingId, request);
        }
        finally
        {
            workflow.Mutation.Release();
        }
    }

    [HttpGet("/api/prs/{id:int}/reviews/{reviewId}/publish")]
    public object Preview(int id, string reviewId, [FromQuery] string? findingId) =>
        workflow.Preview(id, reviewId, findingId);

    [HttpPost("/api/prs/{id:int}/reviews/{reviewId}/publish")]
    public async Task<object> Publish(int id, string reviewId, [FromBody] PublishRequest request,
        CancellationToken ct)
    {
        await workflow.Mutation.WaitAsync(ct);
        try
        {
            return await workflow.Publish(id, reviewId, request, ct);
        }
        finally
        {
            workflow.Mutation.Release();
        }
    }
}