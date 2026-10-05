namespace EyeOfGod.Api;

public interface IRepository
{
    Task<List<PullRequest>> List(CancellationToken ct);
    Task<PullRequest> Get(int id, CancellationToken ct);
    Task<Changes> Changes(PullRequest pr, CancellationToken ct);
    Task<int> Publish(int id, object payload, CancellationToken ct);
}
