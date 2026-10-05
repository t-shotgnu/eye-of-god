import { RefreshCw } from "lucide-react";
import { useConfiguration } from "@/app/configuration-context";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useModelCatalog } from "@/hooks/use-model-catalog";

export function ModelField({
  model,
  setModel,
  disabled = false,
}: {
  model: string;
  setModel: (model: string) => void;
  disabled?: boolean;
}) {
  const { config } = useConfiguration();
  const { models, notice, busy, refresh } = useModelCatalog(
    config.settings.provider !== "copilot" &&
      (!config.settings.demo ||
        config.credentials.api_key ||
        config.settings.provider === "compatible")
      ? { refresh: false }
      : null,
  );
  return (
    <div className="field">
      <Label htmlFor="review-model">Model for this review</Label>
      <div className="input-action">
        <Input
          id="review-model"
          list="review-models"
          maxLength={200}
          value={model}
          disabled={disabled}
          placeholder={
            config.settings.model ||
            (config.settings.provider === "copilot" ? "auto" : "Saved default")
          }
          onChange={(e) => setModel(e.target.value)}
        />
        <IconButton
          type="button"
          label="Refresh available models"
          disabled={disabled || busy || config.settings.provider === "copilot"}
          onClick={() => void refresh({ refresh: true })}
        >
          <RefreshCw className={busy ? "spin" : ""} size={16} />
        </IconButton>
      </div>
      <datalist id="review-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {notice && (
        <small className="warning-text" role="status">
          {notice}
        </small>
      )}
    </div>
  );
}
