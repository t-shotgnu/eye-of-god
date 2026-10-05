using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class SandboxController(Workflow workflow) : ControllerBase
{
    [HttpGet("/api/sandbox")]
    public Task<object> Details(CancellationToken ct) => workflow.Details(1, true, ct);

    [HttpPost("/api/sandbox/review")]
    public Task<Review> Review([FromBody] ReviewRequest request, CancellationToken ct) =>
        workflow.Generate(1, true, request, ct);
}