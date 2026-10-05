import { useConfiguration } from "@/app/configuration-context";
import { CheckedField } from "@/components/checked-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SettingsFieldProps {
  name: "organization" | "project" | "repository" | "api_base" | "model";
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SettingsField({
  name,
  label,
  value,
  onChange,
  placeholder = "",
}: SettingsFieldProps) {
  const { config } = useConfiguration();
  const managedBy = config.environment_fields[name];
  return (
    <div className="field">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        value={value}
        type={name === "api_base" ? "url" : "text"}
        maxLength={name === "model" ? 200 : undefined}
        list={name === "model" ? "available-models" : undefined}
        disabled={Boolean(managedBy)}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {managedBy && <small>{managedBy}</small>}
    </div>
  );
}

interface CredentialFieldProps {
  name: string;
  label: string;
  value: string;
  clear: boolean;
  onChange: (value: string) => void;
  onClearChange: (checked: boolean) => void;
}

export function CredentialField({
  name,
  label,
  value,
  clear,
  onChange,
  onClearChange,
}: CredentialFieldProps) {
  const { config } = useConfiguration();
  const managedBy = config.environment_fields[name];
  return (
    <div className="field">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        type="password"
        autoComplete="new-password"
        value={value}
        disabled={Boolean(managedBy)}
        placeholder={
          config.credentials[name]
            ? "Configured - leave blank to keep"
            : "Not configured"
        }
        onChange={(event) => onChange(event.target.value)}
      />
      <CheckedField
        checked={clear}
        disabled={Boolean(managedBy)}
        onCheckedChange={onClearChange}
        compact
      >
        Clear saved credential
      </CheckedField>
      {managedBy && <small>{managedBy}</small>}
    </div>
  );
}
