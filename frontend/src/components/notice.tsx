import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  if (!children) return null;
  return (
    <Alert
      className="notice"
      variant={error ? "destructive" : "warning"}
      role={error ? "alert" : "status"}
    >
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
