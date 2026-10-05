import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, LoaderCircle, RefreshCw, Send } from "lucide-react";
import { Failure } from "@/components/failure";
import { Loading } from "@/components/loading-state";
import { IconButton } from "@/components/icon-button";
import { Notice } from "@/components/notice";
import { SeverityBadge } from "@/components/severity-badge";
import { Button } from "@/components/ui/button";
import { useApiResource } from "@/hooks/use-api-resource";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Preview } from "@/types";

export function PublishPage() {
  const { id, reviewId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const only = search.get("finding_id");
  const { data, error, reload } = useApiResource<Preview>(
    `/prs/${id}/reviews/${reviewId}/publish${only ? `?finding_id=${encodeURIComponent(only)}` : ""}`,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  async function publish() {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/prs/${id}/reviews/${reviewId}/publish`, "POST", {
        digest: data.digest,
        finding_id: only,
        confirm: "publish",
      });
      navigate(`/prs/${id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page publish-page">
      <Link className="breadcrumb" to={`/prs/${id}`}>
        <ArrowLeft size={15} /> Back to review
      </Link>
      <h1>Publishing preview</h1>
      {error ? (
        <Failure error={error} retry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <p className="muted">
            {data.demo
              ? "Simulated publishing to the local demo."
              : `Post ${data.approved.length} approved comment(s) to Azure DevOps PR #${id}.`}
          </p>
          <Notice error>{actionError}</Notice>
          {data.approved.length === 0 ? (
            <Notice>No approved unpublished comments were selected.</Notice>
          ) : (
            data.approved.map((f) => (
              <article className="publish-comment" key={f.id}>
                <div className="finding-heading">
                  <SeverityBadge severity={f.finding.severity}>
                    {f.finding.severity}
                  </SeverityBadge>
                  <code>
                    {f.finding.file}:{f.finding.line_start}-{f.finding.line_end}
                  </code>
                  <span>{f.finding.side}</span>
                </div>
                <pre>{f.comment}</pre>
              </article>
            ))
          )}
          <div className="publish-actions">
            <Button asChild variant="outline">
              <Link to={`/prs/${id}`}>
                <ArrowLeft size={16} /> Back
              </Link>
            </Button>
            <Button
              disabled={busy || !data.approved.length}
              onClick={() => void publish()}
              variant="default"
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Send size={16} />
              )}
              {busy ? "Publishing..." : "Publish"}
            </Button>
            <IconButton
              label="Refresh publishing preview"
              disabled={busy}
              onClick={reload}
            >
              <RefreshCw size={16} />
            </IconButton>
          </div>
        </>
      )}
    </main>
  );
}
