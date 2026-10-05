using Microsoft.AspNetCore.Mvc;

namespace EyeOfGod.Api.Controllers;

[ApiController]
public sealed class SessionController(SettingsStore settings) : ControllerBase
{
    [HttpGet("/api/session")]
    public object Get() => new { configuration = settings.Public() };
}
