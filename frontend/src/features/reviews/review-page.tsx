import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  GitBranch,
} from "lucide-react";
import { Failure } from "@/components/failure";
import { Loading } from "@/components/loading-state";
import { IconButton } from "@/components/icon-button";
import { Notice } from "@/components/notice";
import { OptionSelect } from "@/components/option-select";
import { Badge } from "@/components/ui/badge";
import { SelectItem } from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatTimestamp } from "@/lib/format";
import { SummaryView } from "@/features/pull-requests/summary-view";
import { DiffView } from "./diff/diff-view";
import { useReview } from "./use-review";
import { ReviewControls } from "./components/review-controls";
import { ReviewResult } from "./components/review-result";

export function ReviewPage({ sandbox = false }: { sandbox?: boolean }) {
  const { id } = useParams();
  const {
    data,
    error,
    reload,
    options,
    setOptions,
    model,
    setModel,
    busy,
    notice,
    actionError,
    review,
    stale,
    select,
    generate,
    updateReview,
  } = useReview(sandbox ? "/sandbox" : `/prs/${id}`, sandbox);
  if (error)
    return (
      <main className="page">
        <Failure error={error} retry={reload} />
      </main>
    );
  if (!data)
    return (
      <main className="page">
        <Loading />
      </main>
    );
  return (
    <main className="page detail-page">
      <div className="breadcrumb">
        <Link to="/">
          <ArrowLeft size={15} /> Pull requests
        </Link>
        <span>/ {sandbox ? "Sandbox" : `#${id}`}</span>
      </div>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {sandbox ? "AI review sandbox" : `Pull request #${id}`}
          </span>
          <h1>{data.pr.title}</h1>
          <div className="meta">
            {data.pr.author}
            <span>{formatTimestamp(data.pr.created)}</span>
            <span className="status">{data.pr.status}</span>
            {data.pr.draft && <Badge variant="secondary">Draft</Badge>}
          </div>
        </div>
        {data.pr.url && (
          <IconButton asChild label="Open in Azure DevOps">
            <a href={data.pr.url} target="_blank" rel="noreferrer">
              <ExternalLink size={18} />
            </a>
          </IconButton>
        )}
      </div>
      <div className="branches">
        <GitBranch size={16} />
        <code>{data.pr.source_branch}</code>
        <ArrowRight size={15} />
        <code>{data.pr.target_branch}</code>
        <span className="muted">Iteration {data.changes.iteration}</span>
      </div>
      {!sandbox && (
        <section className="observation">
          <span className="eyebrow">Observation</span>
          <SummaryView id={data.pr.id} />
        </section>
      )}
      {data.pr.description && (
        <Collapsible className="description" defaultOpen={sandbox}>
          <CollapsibleTrigger className="disclosure-trigger">
            {sandbox ? "Sample context" : "Pull request description"}
            <ChevronDown size={15} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p>{data.pr.description}</p>
          </CollapsibleContent>
        </Collapsible>
      )}
      <div className="analysis-layout">
        <div className="review-workspace">
          <DiffView
            changes={data.changes}
            review={stale ? undefined : review}
          />
          <section id="reviews" className="reviews-section">
            <div className="section-heading">
              <h2>
                Review findings{" "}
                <span className="count">{review?.findings.length ?? 0}</span>
              </h2>
              {data.reviews.length > 0 && (
                <OptionSelect
                  aria-label="Review history"
                  value={review?.id}
                  onValueChange={(value) => select(value)}
                >
                  {data.reviews.map((r, index) => (
                    <SelectItem key={r.id} value={r.id}>
                      {index === 0 ? "Latest" : "Previous"} /{" "}
                      {formatTimestamp(r.created)} / {r.model || "auto"}
                    </SelectItem>
                  ))}
                </OptionSelect>
              )}
            </div>
            <Notice>{notice}</Notice>
            <Notice error>{actionError}</Notice>
            {stale && (
              <Notice error>
                This review is from an earlier revision. Generate a new review
                before publishing.
              </Notice>
            )}
            {review ? (
              <ReviewResult
                review={review}
                sandbox={sandbox}
                stale={!!stale}
                update={updateReview}
              />
            ) : (
              <div className="empty">
                <img src="/observation.svg" width="60" height="60" alt="" />
                <h3>Awaiting judgement</h3>
              </div>
            )}
          </section>
        </div>
        <ReviewControls
          options={options}
          setOptions={setOptions}
          model={model}
          setModel={setModel}
          busy={busy}
          sandbox={sandbox}
          onSubmit={generate}
        />
      </div>
    </main>
  );
}
