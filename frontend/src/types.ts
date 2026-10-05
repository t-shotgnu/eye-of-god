export interface Options { thoroughness: number; nitpicking: number; conventions: number; tone: number; archaic_english: number }
export interface Settings {
  demo: boolean; organization: string; project: string; repository: string; provider: string; model: string;
  api_base: string; structured_mode: string; profanity: boolean; repository_instructions: string; defaults: Options;
}
export interface Configuration { settings: Settings; credentials: Record<string, boolean>; environment_fields: Record<string, string> }
export interface Summary { classification: string; size: string; risk: string; description: string }
export interface PullRequest {
  id: number; title: string; description: string; author: string; created: string; updated: string | null;
  source_branch: string; target_branch: string; status: string; source_commit: string; target_commit: string; draft: boolean; url: string;
}
export interface DiffLine { kind: string; text: string; old: number | null; new: number | null }
export interface FileChange { path: string; old_path: string; change_type: string; tracking_id: number; lines: DiffLine[]; additions: number; deletions: number; skipped_reason: string | null }
export interface Changes { pr_id: number; iteration: number; source_commit: string; target_commit: string; base_commit: string; files: FileChange[] }
export interface Finding { file: string; side: string; line_start: number; line_end: number; severity: string; category: string; explanation: string; suggested_change: string | null }
export interface ReviewFinding { id: string; finding: Finding; comment: string; decision: string; publish_state: string; thread_id: number | null }
export interface Review { id: string; scope: string; pr_id: number; created: string; options: Options; provider: string; model: string; changes: Changes; overview: string; findings: ReviewFinding[]; warnings: string[] }
export interface Detail { pr: PullRequest; changes: Changes; reviews: Review[]; sandbox: boolean }
export interface SummaryResult { summary: Summary; partial: boolean; additions: number; deletions: number; updated: string | null }
export interface Preview { review: Review; approved: ReviewFinding[]; digest: string; finding_id: string | null; demo: boolean }
