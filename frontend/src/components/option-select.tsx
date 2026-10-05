import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = Pick<
  ComponentProps<typeof Select>,
  "value" | "onValueChange" | "disabled" | "name"
> &
  Pick<
    ComponentProps<typeof SelectTrigger>,
    "id" | "aria-label" | "aria-describedby" | "className"
  > & { children: ReactNode; placeholder?: string };

export function OptionSelect({
  value,
  onValueChange,
  disabled,
  name,
  children,
  placeholder,
  ...props
}: Props) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectTrigger className="w-full min-w-0" {...props}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="max-w-[calc(100vw-2rem)]"
      >
        {children}
      </SelectContent>
    </Select>
  );
}
