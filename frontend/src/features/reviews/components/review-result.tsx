import { Link } from "react-router-dom";
import { Send, ShieldCheck } from "lucide-react";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import type { Review } from "@/types";
import { reviewOptionDefinitions } from "../options";
import { FindingEditor } from "./finding-editor";

export function ReviewResult({
  review,
  sandbox,
  stale,
  update,
}: {
  review: Review;
  sandbox: boolean;
  stale: boolean;
  update: (review: Review) => void;
}) {
  return (
    <article className="review-result">
      <div className="review-result-heading">
        <div>
          <p>{review.overview}</p>
          <small className="muted">
            {review.provider} / {review.model || "auto"} / Revision{" "}
            {review.changes.source_commit.slice(0, 10)}
          </small>
        </div>
        {!sandbox &&
          !stale &&
          review.findings.some(
            (f) =>
              f.decision === "approved" && f.publish_state === "unpublished",
          ) && (
            <Button asChild variant="outline">
              <Link to={`/prs/${review.pr_id}/reviews/${review.id}/publish`}>
                <Send size={16} /> Publish approved
              </Link>
            </Button>
          )}
      </div>
      <div className="review-parameters">
        {reviewOptionDefinitions.map(({ name, label }) => (
          <span key={name}>
            {label} <b>{review.options[name]}</b>
          </span>
        ))}
      </div>
      {review.warnings.map((warning, i) => (
        <Notice key={i}>{warning}</Notice>
      ))}
      {review.findings.map((item, i) => (
        <FindingEditor
          key={item.id}
          item={item}
          review={review}
          index={i}
          sandbox={sandbox}
          stale={stale}
          update={update}
        />
      ))}
      {!review.findings.length && (
        <div className="empty">
          <ShieldCheck size={35} />
          <h3>The work withstands scrutiny.</h3>
          <p>No supported findings in the supplied changes.</p>
        </div>
      )}
    </article>
  );
}
