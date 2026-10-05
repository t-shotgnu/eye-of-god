import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

const variants = {
  warning: "warning",
  "must-fix": "destructive",
  suggestion: "info",
  nit: "nit",
} as const;
export function SeverityBadge({
  severity,
  children,
}: {
  severity: string;
  children?: ReactNode;
}) {
  return (
    <Badge variant={variants[severity as keyof typeof variants] ?? "secondary"}>
      {children ?? severity}
    </Badge>
  );
}
