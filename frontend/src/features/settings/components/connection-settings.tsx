import { CheckedField } from "@/components/checked-field";
import type { SettingsForm } from "../use-settings-form";
import { SettingsField, CredentialField } from "./settings-field";

export type ConnectionForm = Pick<
  SettingsForm,
  | "config"
  | "values"
  | "secrets"
  | "clear"
  | "field"
  | "credential"
  | "clearCredential"
>;

export function ConnectionSettings({ form }: { form: ConnectionForm }) {
  const { config, values, secrets, clear, field, credential, clearCredential } =
    form;
  const managed = (name: string) => Boolean(config.environment_fields[name]);
  return (
    <section className="settings-section">
      <div>
        <span className="eyebrow">01 / Connection</span>
        <h2>Azure DevOps</h2>
      </div>
      <div className="settings-fields">
        <CheckedField
          checked={values.demo}
          disabled={managed("demo")}
          onCheckedChange={(value) => field("demo", value)}
          toggle
        >
          Use the local demo workspace
        </CheckedField>
        <SettingsField
          name="organization"
          label="Organization name"
          placeholder="my-organization"
          value={values.organization}
          onChange={(value) => field("organization", value)}
        />
        <SettingsField
          name="project"
          label="Project"
          value={values.project}
          onChange={(value) => field("project", value)}
        />
        <SettingsField
          name="repository"
          label="Repository name or ID"
          value={values.repository}
          onChange={(value) => field("repository", value)}
        />
        <CredentialField
          name="azure_pat"
          label="Personal access token"
          value={secrets.azure_pat ?? ""}
          clear={clear.azure_pat ?? false}
          onChange={(value) => credential("azure_pat", value)}
          onClearChange={(value) => clearCredential("azure_pat", value)}
        />
      </div>
    </section>
  );
}
