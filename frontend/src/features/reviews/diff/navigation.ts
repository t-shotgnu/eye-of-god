import type { ReviewFinding } from "@/types";

function revealDiff(details: HTMLElement, finding?: ReviewFinding) {
  if (details.dataset.state !== "open") {
    details
      .querySelector<HTMLButtonElement>('[data-slot="collapsible-trigger"]')
      ?.click();
  }

  // Collapsible content mounts after the trigger updates React state.
  window.requestAnimationFrame(() => {
    const row = finding
      ? Array.from(details.querySelectorAll<HTMLTableRowElement>("tr")).find(
          (element) =>
            element.dataset[
              finding.finding.side === "right" ? "new" : "old"
            ] === String(finding.finding.line_start),
        )
      : undefined;
    (row ?? details).scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: row ? "center" : "start",
    });
    row?.classList.add("highlight");
    window.setTimeout(() => row?.classList.remove("highlight"), 2200);
  });
}

export function showFileDiff(index: number) {
  const details = document.getElementById(`file-${index}`);
  if (details) revealDiff(details);
}

export function showDiff(finding: ReviewFinding) {
  const details = Array.from(
    document.querySelectorAll<HTMLDivElement>(".file-diff"),
  ).find((d) => d.dataset.path === finding.finding.file);
  if (details) revealDiff(details, finding);
}
