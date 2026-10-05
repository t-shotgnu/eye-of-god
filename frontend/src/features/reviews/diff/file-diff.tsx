import { Fragment } from "react";
import { ArrowRight, ChevronDown, FileCode2 } from "lucide-react";
import { Notice } from "@/components/notice";
import { SeverityBadge } from "@/components/severity-badge";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import type { FileChange, ReviewFinding } from "@/types";

export function FileDiff({
  file,
  index,
  findings,
}: {
  file: FileChange;
  index: number;
  findings: ReviewFinding[];
}) {
  return (
    <Collapsible
      id={`file-${index}`}
      className="file-diff"
      data-path={file.path}
      defaultOpen={index === 0}
    >
      <CollapsibleTrigger className="disclosure-trigger">
        <FileCode2 size={16} />
        <code>{file.path}</code>
        <Badge variant="secondary">{file.change_type}</Badge>
        <span className="added">+{file.additions}</span>
        <span className="deleted">-{file.deletions}</span>
        <ChevronDown size={15} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {file.old_path !== file.path && (
          <p className="muted rename">Renamed from {file.old_path}</p>
        )}
        {file.skipped_reason ? (
          <Notice>{file.skipped_reason}</Notice>
        ) : !file.lines.length ? (
          <p className="muted rename">No line-content changes.</p>
        ) : (
          <div className="diff-scroll">
            <Table className="diff-table" aria-label={`Diff for ${file.path}`}>
              <TableBody>
                {file.lines.map((line, i) => (
                  <Fragment key={i}>
                    <TableRow
                      className={
                        `diff-${line.kind}` + " border-0 hover:bg-transparent"
                      }
                      data-old={line.old ?? ""}
                      data-new={line.new ?? ""}
                    >
                      <TableCell className="line-number px-1 py-0">
                        {line.old}
                      </TableCell>
                      <TableCell className="line-number px-1 py-0">
                        {line.new}
                      </TableCell>
                      <TableCell className="diff-marker px-1 py-0">
                        {line.kind === "add"
                          ? "+"
                          : line.kind === "delete"
                            ? "-"
                            : ""}
                      </TableCell>
                      <TableCell className="code-line px-1 py-0">
                        <pre>{line.text || " "}</pre>
                      </TableCell>
                    </TableRow>
                    {findings
                      .filter(
                        (f) =>
                          (f.finding.side === "right" ? line.new : line.old) ===
                          f.finding.line_start,
                      )
                      .map((f) => (
                        <TableRow
                          className="inline-finding border-0 hover:bg-transparent"
                          key={f.id}
                        >
                          <TableCell colSpan={4} className="px-1 py-0">
                            <a href={`#finding-${f.id}`}>
                              <SeverityBadge severity={f.finding.severity}>
                                {f.finding.severity}
                              </SeverityBadge>
                              <span>{f.finding.explanation}</span>
                              <ArrowRight size={16} />
                            </a>
                          </TableCell>
                        </TableRow>
                      ))}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
