import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/notice";

export function Failure({
  error,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  return (
    <div>
      <Notice error>{error}</Notice>
      <Button onClick={retry} variant="outline">
        <RefreshCw size={16} /> Retry
      </Button>
    </div>
  );
}
