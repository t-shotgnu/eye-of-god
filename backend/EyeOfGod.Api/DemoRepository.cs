namespace EyeOfGod.Api;

public sealed class DemoRepository : IRepository
{
    public Task<List<PullRequest>> List(CancellationToken ct)
    {
        return Task.FromResult(Fixtures.List());
    }

    public Task<PullRequest> Get(int id, CancellationToken ct)
    {
        return Task.FromResult(Fixtures.Pr(id));
    }

    public Task<Changes> Changes(PullRequest pr, CancellationToken ct)
    {
        return Task.FromResult(Fixtures.Changes(pr));
    }

    public Task<int> Publish(int id, object payload, CancellationToken ct)
    {
        return Task.FromResult(Random.Shared.Next(10000, 99999));
    }
}
