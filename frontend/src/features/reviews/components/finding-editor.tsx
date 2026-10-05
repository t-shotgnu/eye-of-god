import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Save,
  Send,
  Trash2,
} from "lucide-react";
import { Notice } from "@/components/notice";
import { SeverityBadge } from "@/components/severity-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Review, ReviewFinding } from "@/types";
import { showDiff } from "../diff/navigation";

export function FindingEditor({
  item,
  review,
  index,
  sandbox,
  stale,
  update,
}: {
  item: ReviewFinding;
  review: Review;
  index: number;
  sandbox: boolean;
  stale: boolean;
  update: (review: Review) => void;
}) {
  const [comment, setComment] = useState(item.comment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => setComment(item.comment), [item.comment]);
  async function save(decision: "draft" | "ignored" | "approved") {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      update(
        await api<Review>(
          `/prs/${review.pr_id}/reviews/${review.id}/findings/${item.id}`,
          "PUT",
          {
            comment,
            decision,
          },
        ),
      );
      setNotice(
        decision === "approved" ? "Comment approved." : "Comment saved.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const dirty = comment !== item.comment;
  return (
    <article
      id={`finding-${item.id}`}
      className={`finding ${item.decision === "ignored" ? "ignored" : ""}`}
    >
      <div className="finding-heading">
        <span className="finding-number">
          {String(index + 1).padStart(2, "0")}
        </span>
        <SeverityBadge severity={item.finding.severity}>
          {item.finding.severity}
        </SeverityBadge>
        <code>
          {item.finding.file}:{item.finding.line_start}
          {item.finding.line_end !== item.finding.line_start &&
            `-${item.finding.line_end}`}
        </code>
        <span className="muted">
          {item.finding.side} / {item.finding.category}
        </span>
        <span className="decision">
          {item.publish_state === "unpublished"
            ? item.decision
            : item.publish_state}
        </span>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{notice}</Notice>
      {sandbox || item.publish_state !== "unpublished" ? (
        <p className="comment-text">{item.comment}</p>
      ) : (
        <>
          <Label className="comment-label" htmlFor={`comment-${item.id}`}>
            Edit comment
          </Label>
          <Textarea
            id={`comment-${item.id}`}
            rows={5}
            maxLength={12000}
            value={comment}
            disabled={busy}
            onChange={(e) => {
              setComment(e.target.value);
              setNotice("");
            }}
          />
          <div className="finding-actions">
            <Button
              disabled={busy || !comment.trim()}
              onClick={() => void save("draft")}
              variant="outline"
            >
              <Save size={15} />
              Save draft
            </Button>
            <Button
              disabled={busy || !comment.trim()}
              onClick={() => void save("ignored")}
              variant="outline"
            >
              <Trash2 size={15} />
              Dismiss
            </Button>
            <Button
              disabled={busy || !comment.trim()}
              onClick={() => void save("approved")}
              variant="success"
            >
              <Check size={16} />
              Approve comment
            </Button>
            {item.decision === "approved" && !dirty && !stale && (
              <Button asChild variant="default">
                <Link
                  to={`/prs/${review.pr_id}/reviews/${review.id}/publish?finding_id=${item.id}`}
                >
                  <Send size={15} />
                  Publish this
                </Link>
              </Button>
            )}
          </div>
        </>
      )}
      {item.publish_state === "published" && (
        <p className="published">
          {review.provider === "demo"
            ? "Simulated publish"
            : "Published to Azure DevOps"}{" "}
          / Thread #{item.thread_id}
        </p>
      )}
      {["publishing", "uncertain"].includes(item.publish_state) && (
        <Notice error>
          Posting may have succeeded. Check Azure DevOps manually. Re-posting is
          blocked.
        </Notice>
      )}
      <Collapsible className="evidence">
        <CollapsibleTrigger className="disclosure-trigger">
          Original neutral finding &amp; suggested change
          <ChevronDown size={15} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>{item.finding.explanation}</p>
          {item.finding.suggested_change && (
            <pre>{item.finding.suggested_change}</pre>
          )}
        </CollapsibleContent>
      </Collapsible>
      <div className="finding-navigation">
        <Button onClick={() => showDiff(item)} variant="link">
          <ArrowLeft size={14} /> View in diff
        </Button>
        {index > 0 && (
          <a href={`#finding-${review.findings[index - 1].id}`}>Previous</a>
        )}
        {index < review.findings.length - 1 && (
          <a href={`#finding-${review.findings[index + 1].id}`}>
            Next <ArrowRight size={14} />
          </a>
        )}
      </div>
    </article>
  );
}
