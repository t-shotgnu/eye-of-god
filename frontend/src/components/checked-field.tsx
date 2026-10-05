import { useId, type ComponentProps, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = Pick<ComponentProps<typeof Checkbox>, "disabled"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  compact?: boolean;
  toggle?: boolean;
};

export function CheckedField({
  children,
  compact = false,
  toggle = false,
  ...props
}: Props) {
  const id = useId();
  return (
    <div className={cn("checked-field", compact && "compact")}>
      {toggle ? (
        <Switch id={id} {...props} />
      ) : (
        <Checkbox
          id={id}
          {...props}
          onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
        />
      )}
      <Label htmlFor={id}>{children}</Label>
    </div>
  );
}
