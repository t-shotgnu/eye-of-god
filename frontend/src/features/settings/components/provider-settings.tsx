import { RefreshCw } from "lucide-react";
import { OptionSelect } from "@/components/option-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SelectItem } from "@/components/ui/select";
import type { SettingsForm } from "../use-settings-form";
import type { ConnectionForm } from "./connection-settings";
import { SettingsField, CredentialField } from "./settings-field";

type ProviderForm = ConnectionForm &
  Pick<SettingsForm, "models" | "modelNotice" | "checking" | "check">;

export function ProviderSettings({ form }: { form: ProviderForm }) {
  const {
    config,
    values,
    secrets,
    clear,
    field,
    credential,
    clearCredential,
    models,
    modelNotice,
    checking,
    check,
  } = form;
  const managed = (name: string) => Boolean(config.environment_fields[name]);
  return (
    <section className="settings-section">
      <div>
        <span className="eyebrow">02 / Intelligence</span>
        <h2>AI provider</h2>
      </div>
      <div className="settings-fields">
        <div className="field">
          <Label htmlFor="provider">Provider</Label>
          <OptionSelect
            id="provider"
            value={values.provider}
            disabled={managed("provider")}
            onValueChange={(value) => {
              field("provider", value);
            }}
          >
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="compatible">
              OpenAI-compatible / local
            </SelectItem>
            <SelectItem value="copilot">GitHub Copilot SDK</SelectItem>
          </OptionSelect>
        </div>
        <SettingsField
          name="model"
          label="Model ID"
          placeholder={
            values.provider === "copilot" ? "auto" : "Provider model ID"
          }
          value={values.model}
          onChange={(value) => field("model", value)}
        />
        <datalist id="available-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <SettingsField
          name="api_base"
          label="Compatible API base URL"
          placeholder="http://localhost:11434/v1"
          value={values.api_base}
          onChange={(value) => field("api_base", value)}
        />
        <div className="field">
          <Label htmlFor="structured-mode">Structured output mode</Label>
          <OptionSelect
            id="structured-mode"
            value={values.structured_mode}
            onValueChange={(value) => field("structured_mode", value)}
          >
            <SelectItem value="schema">JSON Schema</SelectItem>
            <SelectItem value="json">JSON object</SelectItem>
            <SelectItem value="prompt">Prompt only</SelectItem>
          </OptionSelect>
        </div>
        <CredentialField
          name="api_key"
          label="AI API key"
          value={secrets.api_key ?? ""}
          clear={clear.api_key ?? false}
          onChange={(value) => credential("api_key", value)}
          onClearChange={(value) => clearCredential("api_key", value)}
        />
        <CredentialField
          name="copilot_token"
          label="Copilot GitHub token"
          value={secrets.copilot_token ?? ""}
          clear={clear.copilot_token ?? false}
          onChange={(value) => credential("copilot_token", value)}
          onClearChange={(value) => clearCredential("copilot_token", value)}
        />
        <Button
          type="button"
          disabled={checking || values.provider === "copilot"}
          onClick={() => void check()}
          variant="outline"
        >
          <RefreshCw size={16} className={checking ? "spin" : ""} />
          Check connection &amp; refresh models
        </Button>
        {modelNotice && (
          <p className="muted" role="status">
            {modelNotice}
          </p>
        )}
      </div>
    </section>
  );
}
