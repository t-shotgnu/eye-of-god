using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class RootController : ControllerBase
{
    [HttpGet("/")]
    public ContentResult Fallback() => Content(
        "Build the React frontend with npm --prefix frontend run build, or run its Vite dev server.",
        "text/plain");
}