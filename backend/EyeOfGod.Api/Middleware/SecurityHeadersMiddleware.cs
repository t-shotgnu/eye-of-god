namespace EyeOfGod.Api.Middleware;

public sealed class SecurityHeadersMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        context.Response.OnStarting(() =>
        {
            context.Response.Headers.ContentSecurityPolicy =
                "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            return Task.CompletedTask;
        });
        return next(context);
    }
}
