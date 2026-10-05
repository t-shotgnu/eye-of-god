import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, GitBranch, RefreshCw, Search } from "lucide-react";
import { useConfiguration } from "@/app/configuration-context";
import { Failure } from "@/components/failure";
import { Loading } from "@/components/loading-state";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiResource } from "@/hooks/use-api-resource";
import { formatTimestamp } from "@/lib/format";
import type { PullRequest } from "@/types";
import { SummaryView } from "./summary-view";

export function DashboardPage() {
  const { data, error, reload } = useApiResource<PullRequest[]>("/prs");
  const [query, setQuery] = useState("");
  const { config } = useConfiguration();
  const normalizedQuery = query.trim().toLowerCase();
  const filtered =
    data?.filter((pr) =>
      `${pr.id} ${pr.title} ${pr.author}`
        .toLowerCase()
        .includes(normalizedQuery),
    ) ?? [];
  return (
    <main className="page dashboard">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {config.settings.demo
              ? "Local workspace"
              : `${config.settings.organization} / ${config.settings.project}`}
          </span>
          <h1>
            Pull requests<span className="gold">.</span>
          </h1>
        </div>
        <IconButton label="Refresh pull requests" onClick={reload}>
          <RefreshCw size={19} />
        </IconButton>
      </div>
      <div className="queue-toolbar">
        <span>{data?.length ?? 0} active pull requests</span>
        <Label className="search focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
          <Search size={16} />
          <Input
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            aria-label="Filter pull requests"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter pull requests"
          />
        </Label>
      </div>
      {error ? (
        <Failure error={error} retry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <div className="queue">
          {filtered.map((pr) => (
            <article className="pr-entry" key={pr.id}>
              <div className="entry-number">
                <Link to={`/prs/${pr.id}`}>#{pr.id}</Link>
                <span className="status">{pr.draft ? "Draft" : "Active"}</span>
              </div>
              <div className="entry-content">
                <h2>
                  <Link to={`/prs/${pr.id}`}>{pr.title}</Link>
                </h2>
                <div className="meta">
                  {pr.author}
                  <span>{formatTimestamp(pr.created)}</span>
                </div>
                <div className="branches">
                  <GitBranch size={14} />
                  <code>{pr.source_branch}</code>
                  <ArrowRight size={14} />
                  <code>{pr.target_branch}</code>
                </div>
                <SummaryView id={pr.id} compact />
              </div>
              <IconButton
                asChild
                label={`Review PR ${pr.id}`}
                className="open-pr"
              >
                <Link to={`/prs/${pr.id}`}>
                  <ArrowRight size={22} />
                </Link>
              </IconButton>
            </article>
          ))}
          {data.length === 0 && (
            <div className="empty">No active pull requests.</div>
          )}
          {data.length > 0 && filtered.length === 0 && (
            <div className="empty">No matching pull requests.</div>
          )}
        </div>
      )}
    </main>
  );
}
