namespace EyeOfGod.Api.Middleware;

public sealed class ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            context.Abort();
        }
        catch (Exception error) when (!context.Response.HasStarted)
        {
            context.Response.Clear();
            if (error is AppError applicationError)
            {
                context.Response.StatusCode = applicationError.Status;
                await context.Response.WriteAsJsonAsync(new { error = applicationError.Message });
            }
            else
            {
                logger.LogError(error, "Unhandled request failure for {Method} {Path}",
                    context.Request.Method, context.Request.Path);
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;
                await context.Response.WriteAsJsonAsync(new { error = "An unexpected server error occurred. Reload and try again." });
            }
        }
    }
}
