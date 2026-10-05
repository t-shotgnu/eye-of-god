using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class HealthController : ControllerBase
{
    [HttpGet("/health")]
    public object Get() => new { status = "ok" };
}
