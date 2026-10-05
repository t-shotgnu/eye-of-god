import { ChevronDown, LoaderCircle, Save } from "lucide-react";
import { CheckedField } from "@/components/checked-field";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ReviewOptions } from "@/features/reviews/components/review-options";
import { useSettingsForm } from "./use-settings-form";
import { ConnectionSettings } from "./components/connection-settings";
import { ProviderSettings } from "./components/provider-settings";

export function SettingsPage() {
  const form = useSettingsForm();
  const { config, values, busy, error, notice, field, save } = form;
  return (
    <main className="page settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Configuration</span>
          <h1>
            Settings<span className="gold">.</span>
          </h1>
        </div>
      </div>
      <Notice error>{error}</Notice>
      <Notice>{notice}</Notice>
      <form onSubmit={save}>
        <fieldset disabled={busy} className="min-w-0 border-0 p-0 m-0">
          <ConnectionSettings form={form} />
          <ProviderSettings form={form} />
          <section className="settings-section">
            <div>
              <span className="eyebrow">03 / Judgement</span>
              <h2>Review defaults</h2>
            </div>
            <div className="settings-fields">
              <ReviewOptions
                options={values.defaults}
                setOptions={(options) => field("defaults", options)}
              />
              <CheckedField
                checked={values.profanity}
                onCheckedChange={(value) => field("profanity", value)}
                toggle
              >
                Allow profanity at aggressive tones
              </CheckedField>
            </div>
          </section>
          <section className="settings-section">
            <div>
              <span className="eyebrow">04 / Context</span>
              <h2>Repository instructions</h2>
            </div>
            <div className="settings-fields">
              <Label className="sr-only" htmlFor="instructions">
                Repository review instructions
              </Label>
              <Textarea
                id="instructions"
                rows={8}
                maxLength={20000}
                value={values.repository_instructions}
                onChange={(e) =>
                  field("repository_instructions", e.target.value)
                }
              />
            </div>
          </section>
          <div className="settings-footer">
            <span className="muted">Credentials are stored locally.</span>
            <Button disabled={busy} type="submit" variant="default">
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Save size={16} />
              )}
              Save settings
            </Button>
          </div>
          {Object.keys(config.environment_fields).length > 0 && (
            <Collapsible className="environment">
              <CollapsibleTrigger className="disclosure-trigger">
                Environment overrides
                <ChevronDown size={16} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                {Object.entries(config.environment_fields).map(
                  ([field, variable]) => (
                    <p key={field}>
                      <code>{variable}</code> / {field}
                    </p>
                  ),
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </fieldset>
      </form>
    </main>
  );
}
