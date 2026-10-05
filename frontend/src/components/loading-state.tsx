import { LoaderCircle } from "lucide-react";

export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={18} aria-hidden="true" /> Loading
    </div>
  );
}
