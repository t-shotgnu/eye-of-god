import React, {
  useCallback,
  useContext,
  useEffect,
  useState,
  createContext,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileCode2,
  GitBranch,
  GitPullRequest,
  LoaderCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import type {
  Changes,
  Configuration,
  Detail,
  FileChange,
  Options,
  Preview,
  PullRequest,
  Review,
  ReviewFinding,
  SummaryResult,
} from "./types";
import "./style.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IconButton } from "@/components/icon-button";
import { OptionSelect } from "@/components/option-select";
import { CheckedField } from "@/components/checked-field";
import { SeverityBadge } from "@/components/severity-badge";
import { Notice } from "@/components/notice";
import { Loading } from "@/components/loading-state";
const Context = createContext<{
  config: Configuration;
  update: (config: Configuration) => void;
}>(null!);
const labels: Record<keyof Options, string> = {
  thoroughness: "Thoroughness",
  nitpicking: "Nitpicking",
  conventions: "Conventions",
  tone: "Tone",
  archaic_english: "Archaic English",
};
const stamp = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const message = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed.";
function useLoad<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined);
    setError("");
    api<T>(path, "GET", undefined, controller.signal)
      .then(setData)
      .catch((e) => {
        if (!controller.signal.aborted) setError(message(e));
      });
    return () => controller.abort();
  }, [path, attempt]);
  return {
    data,
    setData,
    error,
    reload: () => setAttempt((a) => a + 1),
  };
}
function Failure({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div>
      <Notice error>{error}</Notice>
      <Button onClick={retry} variant="outline">
        <RefreshCw size={16} /> Retry
      </Button>
    </div>
  );
}
function App() {
  const [config, update] = useState<Configuration>();
  const [error, setError] = useState("");
  const connect = useCallback(() => {
    setError("");
    api<{ configuration: Configuration }>("/session")
      .then((s) => {
        update(s.configuration);
      })
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(connect, [connect]);
  if (!config)
    return (
      <main className="page">
        {error ? <Failure error={error} retry={connect} /> : <Loading />}
      </main>
    );
  return (
    <Context.Provider
      value={{
        config,
        update,
      }}
    >
      <BrowserRouter>
        <header className="topbar">
          <Link className="brand" to="/">
            <img src="/observation.svg" alt="" width="38" height="38" />
            <span>
              Eye of God
              <span className="brand-sub">The all-seeing reviewer</span>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            <NavLink to="/" end>
              <GitPullRequest size={17} /> Pull requests
            </NavLink>
            <NavLink to="/sandbox">
              <FileCode2 size={17} /> Sandbox
            </NavLink>
            <NavLink to="/settings">
              <Settings2 size={17} /> Settings
            </NavLink>
          </nav>
          <span className="connection">
            {config.settings.demo
              ? "Demo workspace"
              : config.settings.repository || "Azure DevOps"}
          </span>
        </header>
        {config.settings.demo && (
          <div className="demo-banner">
            <span>DEMO</span> Local sample pull requests{" "}
            <Link to="/settings">
              Connect Azure DevOps <ArrowRight size={13} />
            </Link>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/prs/:id" element={<ReviewPage key="pr" />} />
          <Route
            path="/sandbox"
            element={<ReviewPage key="sandbox" sandbox />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/prs/:id/reviews/:reviewId/publish"
            element={<PublishPage />}
          />
          <Route
            path="*"
            element={
              <main className="page">
                <h1>Page not found</h1>
                <Link to="/">Pull requests</Link>
              </main>
            }
          />
        </Routes>
        <footer>
          <span>
            Eye of God <span className="muted">/ Azure Repos</span>
          </span>
          <span>Human judgement comes last.</span>
        </footer>
      </BrowserRouter>
    </Context.Provider>
  );
}
function SummaryView({
  id,
  compact = false,
}: {
  id: number;
  compact?: boolean;
}) {
  const { data, error, reload } = useLoad<SummaryResult>(`/prs/${id}/summary`);
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
function Dashboard() {
  const { data, error, reload } = useLoad<PullRequest[]>("/prs");
  const [query, setQuery] = useState("");
  const { config } = useContext(Context);
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
          {data
            .filter((pr) =>
              `${pr.id} ${pr.title} ${pr.author}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((pr) => (
              <article className="pr-entry" key={pr.id}>
                <div className="entry-number">
                  <Link to={`/prs/${pr.id}`}>#{pr.id}</Link>
                  <span className="status">
                    {pr.draft ? "Draft" : "Active"}
                  </span>
                </div>
                <div className="entry-content">
                  <h2>
                    <Link to={`/prs/${pr.id}`}>{pr.title}</Link>
                  </h2>
                  <div className="meta">
                    {pr.author}
                    <span>{stamp(pr.created)}</span>
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
          {data.length > 0 &&
            !data.some((pr) =>
              `${pr.id} ${pr.title} ${pr.author}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            ) && <div className="empty">No matching pull requests.</div>}
        </div>
      )}
    </main>
  );
}
function Sliders({
  options,
  setOptions,
  disabled = false,
}: {
  options: Options;
  setOptions: (value: Options) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sliders">
      {(Object.keys(labels) as (keyof Options)[]).map((name) => (
        <div className="slider" key={name}>
          <div className="slider-heading">
            <Label id={`label-${name}`}>{labels[name]}</Label>
            <output aria-hidden="true">{options[name]}</output>
          </div>
          <Slider
            aria-labelledby={`label-${name}`}
            min={name === "archaic_english" ? 0 : 1}
            max={10}
            step={1}
            value={[options[name]]}
            disabled={disabled}
            onValueChange={([value]) =>
              setOptions({
                ...options,
                [name]: value,
              })
            }
          />
          <div className="slider-scale">
            <span>
              {name === "tone"
                ? "Gentle"
                : name === "archaic_english"
                  ? "Modern"
                  : "Low"}
            </span>
            <span>
              {name === "tone"
                ? "Severe"
                : name === "archaic_english"
                  ? "Ancient"
                  : "High"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
function ModelField({
  model,
  setModel,
}: {
  model: string;
  setModel: (model: string) => void;
}) {
  const { config } = useContext(Context);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (force: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        models: string[];
      }>("/settings/ai/models", "POST", {
        refresh: force,
      });
      setModels(result.models);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (
      config.settings.provider !== "copilot" &&
      (!config.settings.demo ||
        config.credentials.api_key ||
        config.settings.provider === "compatible")
    )
      void refresh(false);
  }, [config, refresh]);
  return (
    <div className="field">
      <Label htmlFor="review-model">Model for this review</Label>
      <div className="input-action">
        <Input
          id="review-model"
          list="review-models"
          maxLength={200}
          value={model}
          placeholder={
            config.settings.model ||
            (config.settings.provider === "copilot" ? "auto" : "Saved default")
          }
          onChange={(e) => setModel(e.target.value)}
        />
        <IconButton
          type="button"
          label="Refresh available models"
          disabled={busy || config.settings.provider === "copilot"}
          onClick={() => void refresh(true)}
        >
          <RefreshCw className={busy ? "spin" : ""} size={16} />
        </IconButton>
      </div>
      <datalist id="review-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {error && (
        <small className="warning-text" role="status">
          {error}
        </small>
      )}
    </div>
  );
}
function ReviewPage({ sandbox = false }: { sandbox?: boolean }) {
  const { id } = useParams();
  const { config } = useContext(Context);
  const { data, setData, error, reload } = useLoad<Detail>(
    sandbox ? "/sandbox" : `/prs/${id}`,
  );
  const [options, setOptions] = useState<Options>(config.settings.defaults);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [selected, select] = useState<string>();
  const [controlsOpen, setControlsOpen] = useState(
    () => !window.matchMedia("(max-width: 760px)").matches,
  );
  useEffect(() => {
    select(undefined);
    setNotice("");
    setActionError("");
  }, [id]);
  const review =
    data?.reviews.find((r) => r.id === selected) ?? data?.reviews[0];
  async function generate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await api<Review>(
        sandbox ? "/sandbox/review" : `/prs/${id}/review`,
        "POST",
        {
          options,
          model,
        },
      );
      setData((previous) =>
        previous
          ? {
              ...previous,
              reviews: [result, ...previous.reviews].slice(0, 10),
            }
          : previous,
      );
      select(result.id);
      setNotice(
        sandbox
          ? "Sandbox review saved locally."
          : "Review generated. Comments are drafts until approved.",
      );
    } catch (e) {
      setActionError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function updateReview(result: Review) {
    setData((previous) =>
      previous
        ? {
            ...previous,
            reviews: previous.reviews.map((r) =>
              r.id === result.id ? result : r,
            ),
          }
        : previous,
    );
  }
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
  const stale = review && !sameRevision(review.changes, data.changes);
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
            <span>{stamp(data.pr.created)}</span>
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
                      {index === 0 ? "Latest" : "Previous"} / {stamp(r.created)}{" "}
                      / {r.model || "auto"}
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
        <aside className="review-controls">
          <Collapsible
            className="controls-disclosure"
            open={controlsOpen}
            onOpenChange={setControlsOpen}
          >
            <CollapsibleTrigger className="disclosure-trigger">
              <div>
                <span className="eyebrow">Parameters of judgement</span>
                <h2>Review configuration</h2>
              </div>
              <ChevronDown size={18} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <form onSubmit={generate}>
                <ModelField model={model} setModel={setModel} />
                <Sliders
                  options={options}
                  setOptions={setOptions}
                  disabled={busy}
                />
                <Button
                  className="full"
                  type="submit"
                  disabled={busy}
                  variant="default"
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Search size={17} />
                  )}
                  {busy ? "Reviewing..." : "Seek judgement"}
                </Button>
                <div className="provider-caption">
                  {sandbox
                    ? `${config.settings.provider} / local results only`
                    : config.settings.demo
                      ? "Demo fixture"
                      : config.settings.provider}
                </div>
              </form>
            </CollapsibleContent>
          </Collapsible>
        </aside>
      </div>
    </main>
  );
}
function sameRevision(before: Changes, after: Changes) {
  return (
    before.iteration === after.iteration &&
    before.source_commit === after.source_commit &&
    before.target_commit === after.target_commit &&
    before.base_commit === after.base_commit
  );
}
function showDiff(finding: ReviewFinding) {
  const details = Array.from(
    document.querySelectorAll<HTMLDivElement>(".file-diff"),
  ).find((d) => d.dataset.path === finding.finding.file);
  if (!details) return;
  if (details.dataset.state !== "open")
    details
      .querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
      ?.click();
  const row = Array.from(
    details.querySelectorAll<HTMLTableRowElement>("tr"),
  ).find(
    (r) =>
      r.dataset[finding.finding.side === "right" ? "new" : "old"] ===
      String(finding.finding.line_start),
  );
  (row ?? details).scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "center",
  });
  row?.classList.add("highlight");
  window.setTimeout(() => row?.classList.remove("highlight"), 2200);
}
function DiffView({ changes, review }: { changes: Changes; review?: Review }) {
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
                onClick={() => {
                  const element = document.getElementById(`file-${i}`);
                  if (element?.dataset.state !== "open")
                    element
                      ?.querySelector<HTMLButtonElement>(
                        '[data-slot="collapsible-trigger"]',
                      )
                      ?.click();
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
function FileDiff({
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
                  <React.Fragment key={i}>
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
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
function ReviewResult({
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
        {(Object.keys(labels) as (keyof Options)[]).map((key) => (
          <span key={key}>
            {labels[key]} <b>{review.options[key]}</b>
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
function FindingEditor({
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
  async function save(decision: string) {
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
      setError(message(e));
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
function PublishPage() {
  const { id, reviewId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const only = search.get("finding_id");
  const { data, error, reload } = useLoad<Preview>(
    `/prs/${id}/reviews/${reviewId}/publish${only ? `?finding_id=${encodeURIComponent(only)}` : ""}`,
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState("");
  async function publish() {
    if (!data) return;
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
      setError(message(e));
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
function SettingsPage() {
  const { config, update } = useContext(Context);
  const [values, setValues] = useState(config.settings);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const field = (name: keyof typeof values, value: unknown) =>
    setValues((previous) => ({
      ...previous,
      [name]: value,
    }));
  const body = () => ({
    ...values,
    ...secrets,
    ...Object.fromEntries(
      Object.entries(clear).map(([name, checked]) => [
        `clear_${name}`,
        checked,
      ]),
    ),
  });
  async function check(force: boolean) {
    setChecking(true);
    setModelNotice("");
    try {
      const result = await api<{
        models: string[];
        message: string;
      }>("/settings/ai/models", "POST", {
        ...body(),
        refresh: force,
      });
      setModels(result.models);
      setModelNotice(result.message);
    } catch (e) {
      setModels([]);
      setModelNotice(message(e));
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    if (
      config.settings.provider !== "copilot" &&
      (config.credentials.api_key || config.settings.provider === "compatible")
    )
      void check(false);
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Configuration>("/settings", "PUT", body());
      update(result);
      setValues(result.settings);
      setSecrets({});
      setClear({});
      setNotice("Settings saved.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const managed = (name: string) => Boolean(config.environment_fields[name]);
  function input(
    name: "organization" | "project" | "repository" | "api_base" | "model",
    label: string,
    placeholder = "",
  ) {
    return (
      <div className="field">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          value={values[name]}
          type={name === "api_base" ? "url" : "text"}
          maxLength={name === "model" ? 200 : undefined}
          list={name === "model" ? "available-models" : undefined}
          disabled={managed(name)}
          placeholder={placeholder}
          onChange={(e) => field(name, e.target.value)}
        />
        {managed(name) && <small>{config.environment_fields[name]}</small>}
      </div>
    );
  }
  function credential(name: string, label: string) {
    return (
      <div className="field">
        <Label htmlFor={name}>{label}</Label>
        <Input
          id={name}
          type="password"
          autoComplete="new-password"
          value={secrets[name] ?? ""}
          disabled={managed(name)}
          placeholder={
            config.credentials[name]
              ? "Configured - leave blank to keep"
              : "Not configured"
          }
          onChange={(e) =>
            setSecrets((previous) => ({
              ...previous,
              [name]: e.target.value,
            }))
          }
        />
        <CheckedField
          checked={clear[name] ?? false}
          disabled={managed(name)}
          onCheckedChange={(value) =>
            setClear((previous) => ({
              ...previous,
              [name]: value,
            }))
          }
          compact
        >
          Clear saved credential
        </CheckedField>
        {managed(name) && <small>{config.environment_fields[name]}</small>}
      </div>
    );
  }
  return (
    <main className="page settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Configuration</span>
          <h1>
            Settings<span className="gold">.</span>
          </h1>
        </div>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{notice}</Notice>
      <form onSubmit={save}>
        <section className="settings-section">
          <div>
            <span className="eyebrow">01 / Connection</span>
            <h2>Azure DevOps</h2>
          </div>
          <div className="settings-fields">
            <CheckedField
              checked={values.demo}
              disabled={managed("demo")}
              onCheckedChange={(value) => field("demo", value)}
              toggle
            >
              Use the local demo workspace
            </CheckedField>
            {input("organization", "Organization name", "my-organization")}
            {input("project", "Project")}
            {input("repository", "Repository name or ID")}
            {credential("azure_pat", "Personal access token")}
          </div>
        </section>
        <section className="settings-section">
          <div>
            <span className="eyebrow">02 / Intelligence</span>
            <h2>AI provider</h2>
          </div>
          <div className="settings-fields">
            <div className="field">
              <Label htmlFor="provider">Provider</Label>
              <OptionSelect
                id="provider"
                value={values.provider}
                disabled={managed("provider")}
                onValueChange={(value) => {
                  field("provider", value);
                  setModels([]);
                  setModelNotice("");
                }}
              >
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="compatible">
                  OpenAI-compatible / local
                </SelectItem>
                <SelectItem value="copilot">GitHub Copilot SDK</SelectItem>
              </OptionSelect>
            </div>
            {input(
              "model",
              "Model ID",
              values.provider === "copilot" ? "auto" : "Provider model ID",
            )}
            <datalist id="available-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            {input(
              "api_base",
              "Compatible API base URL",
              "http://localhost:11434/v1",
            )}
            <div className="field">
              <Label htmlFor="structured-mode">Structured output mode</Label>
              <OptionSelect
                id="structured-mode"
                value={values.structured_mode}
                onValueChange={(value) => field("structured_mode", value)}
              >
                <SelectItem value="schema">JSON Schema</SelectItem>
                <SelectItem value="json">JSON object</SelectItem>
                <SelectItem value="prompt">Prompt only</SelectItem>
              </OptionSelect>
            </div>
            {credential("api_key", "AI API key")}
            {credential("copilot_token", "Copilot GitHub token")}
            <Button
              type="button"
              disabled={checking || values.provider === "copilot"}
              onClick={() => void check(true)}
              variant="outline"
            >
              <RefreshCw size={16} className={checking ? "spin" : ""} />
              Check connection &amp; refresh models
            </Button>
            {modelNotice && (
              <p className="muted" role="status">
                {modelNotice}
              </p>
            )}
          </div>
        </section>
        <section className="settings-section">
          <div>
            <span className="eyebrow">03 / Judgement</span>
            <h2>Review defaults</h2>
          </div>
          <div className="settings-fields">
            <Sliders
              options={values.defaults}
              setOptions={(options) => field("defaults", options)}
            />
            <CheckedField
              checked={values.profanity}
              onCheckedChange={(value) => field("profanity", value)}
              toggle
            >
              Allow profanity at aggressive tones
            </CheckedField>
          </div>
        </section>
        <section className="settings-section">
          <div>
            <span className="eyebrow">04 / Context</span>
            <h2>Repository instructions</h2>
          </div>
          <div className="settings-fields">
            <Label className="sr-only" htmlFor="instructions">
              Repository review instructions
            </Label>
            <Textarea
              id="instructions"
              rows={8}
              maxLength={20000}
              value={values.repository_instructions}
              onChange={(e) => field("repository_instructions", e.target.value)}
            />
          </div>
        </section>
        <div className="settings-footer">
          <span className="muted">Credentials are stored locally.</span>
          <Button disabled={busy} type="submit" variant="default">
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            Save settings
          </Button>
        </div>
        {Object.keys(config.environment_fields).length > 0 && (
          <Collapsible className="environment">
            <CollapsibleTrigger className="disclosure-trigger">
              Environment overrides
              <ChevronDown size={16} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {Object.entries(config.environment_fields).map(
                ([field, variable]) => (
                  <p key={field}>
                    <code>{variable}</code> / {field}
                  </p>
                ),
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </form>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <TooltipProvider delayDuration={300}>
    <App />
  </TooltipProvider>,
);
