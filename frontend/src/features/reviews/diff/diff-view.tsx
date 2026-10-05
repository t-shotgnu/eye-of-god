import { useState } from "react";
import { FileCode2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Changes, Review } from "@/types";
import { FileDiff } from "./file-diff";
import { showFileDiff } from "./navigation";

export function DiffView({
  changes,
  review,
}: {
  changes: Changes;
  review?: Review;
}) {
  const [view, setView] = useState("files");
  return (
    <section id="changes" className="changes-section">
      <Tabs value={view} onValueChange={setView}>
        <div className="diff-toolbar">
          <TabsList aria-label="Diff navigation">
            <TabsTrigger value="files">
              Files <span className="count">{changes.files.length}</span>
            </TabsTrigger>
            <TabsTrigger value="findings">
              Findings{" "}
              <span className="count">{review?.findings.length ?? 0}</span>
            </TabsTrigger>
          </TabsList>
          <div className="stats">
            <span className="added">
              +{changes.files.reduce((sum, f) => sum + f.additions, 0)}
            </span>
            <span className="deleted">
              -{changes.files.reduce((sum, f) => sum + f.deletions, 0)}
            </span>
          </div>
        </div>
        <TabsContent value="files">
          <nav className="file-navigation" aria-label="Changed files">
            {changes.files.map((f, i) => (
              <a
                key={f.path}
                href={`#file-${i}`}
                onClick={(event) => {
                  event.preventDefault();
                  showFileDiff(i);
                }}
              >
                <FileCode2 size={14} />
                {f.path}
              </a>
            ))}
          </nav>
        </TabsContent>
        <TabsContent value="findings">
          <nav className="file-navigation" aria-label="Review findings">
            {review?.findings.map((f) => (
              <a href={`#finding-${f.id}`} key={f.id}>
                <span
                  className={`severity-dot severity-${f.finding.severity}`}
                />
                {f.finding.file}:{f.finding.line_start}
              </a>
            ))}
            {!review?.findings.length && (
              <span className="muted">No findings</span>
            )}
          </nav>
        </TabsContent>
      </Tabs>
      {changes.files.map((file, index) => (
        <FileDiff
          key={`${changes.source_commit}-${file.path}`}
          file={file}
          index={index}
          findings={
            review?.findings.filter(
              (f) => f.finding.file === file.path && f.decision !== "ignored",
            ) ?? []
          }
        />
      ))}
    </section>
  );
}
