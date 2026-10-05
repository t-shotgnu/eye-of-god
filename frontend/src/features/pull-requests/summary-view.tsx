import { LoaderCircle, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/icon-button";
import { useApiResource } from "@/hooks/use-api-resource";
import type { SummaryResult } from "@/types";

export function SummaryView({
  id,
  compact = false,
}: {
  id: number;
  compact?: boolean;
}) {
  const { data, error, reload } = useApiResource<SummaryResult>(
    `/prs/${id}/summary`,
  );
  if (error)
    return (
      <div className="summary-error">
        <span>{error}</span>
        <IconButton label="Retry summary" onClick={reload}>
          <RefreshCw size={16} />
        </IconButton>
      </div>
    );
  if (!data)
    return (
      <div className="muted summary-loading">
        <LoaderCircle className="spin" size={14} /> Observing the change
      </div>
    );
  return (
    <div className={`summary ${compact ? "compact" : ""}`}>
      <div className="summary-tags">
        <Badge variant="secondary">{data.summary.classification}</Badge>
        <span className={`risk risk-${data.summary.risk}`}>
          {data.summary.risk} risk
        </span>
        <span className="muted">{data.summary.size}</span>
        <span className="added">+{data.additions}</span>
        <span className="deleted">-{data.deletions}</span>
        {data.partial && <span className="warning-text">Partial coverage</span>}
      </div>
      <p>{data.summary.description}</p>
    </div>
  );
}
