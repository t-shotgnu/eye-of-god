import type { Changes } from "@/types";

export function sameRevision(before: Changes, after: Changes) {
  return (
    before.iteration === after.iteration &&
    before.source_commit === after.source_commit &&
    before.target_commit === after.target_commit &&
    before.base_commit === after.base_commit
  );
}
