using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class SettingsController(SettingsStore settings, Workflow workflow) : ControllerBase
{
    [HttpGet("/api/settings")]
    public object Get() => settings.Public();

    [HttpPut("/api/settings")]
    public async Task<object> Put([FromBody] JsonObject edits, CancellationToken ct)
    {
        await workflow.Mutation.WaitAsync(ct);
        try
        {
            settings.Save(edits);
            return settings.Public();
        }
        finally
        {
            workflow.Mutation.Release();
        }
    }

    [HttpPost("/api/settings/ai/models")]
    public Task<object> Models([FromBody] JsonObject edits, CancellationToken ct) => workflow.Models(edits, ct);
}