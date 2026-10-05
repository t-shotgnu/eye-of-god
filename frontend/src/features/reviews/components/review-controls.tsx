import { useState, type FormEvent } from "react";
import { ChevronDown, LoaderCircle, Search } from "lucide-react";
import { useConfiguration } from "@/app/configuration-context";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Options } from "@/types";
import { ModelField } from "./model-field";
import { ReviewOptions } from "./review-options";

interface ReviewControlsProps {
  options: Options;
  setOptions: (options: Options) => void;
  model: string;
  setModel: (model: string) => void;
  busy: boolean;
  sandbox: boolean;
  onSubmit: (event: FormEvent) => void;
}

export function ReviewControls({
  options,
  setOptions,
  model,
  setModel,
  busy,
  sandbox,
  onSubmit,
}: ReviewControlsProps) {
  const { config } = useConfiguration();
  const [open, setOpen] = useState(
    () => !window.matchMedia("(max-width: 760px)").matches,
  );
  return (
    <aside className="review-controls">
      <Collapsible
        className="controls-disclosure"
        open={open}
        onOpenChange={setOpen}
      >
        <CollapsibleTrigger className="disclosure-trigger">
          <div>
            <span className="eyebrow">Parameters of judgement</span>
            <h2>Review configuration</h2>
          </div>
          <ChevronDown size={18} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <form onSubmit={onSubmit}>
            <ModelField model={model} setModel={setModel} disabled={busy} />
            <ReviewOptions
              options={options}
              setOptions={setOptions}
              disabled={busy}
            />
            <Button
              className="full"
              type="submit"
              disabled={busy}
              variant="default"
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Search size={17} />
              )}
              {busy ? "Reviewing..." : "Seek judgement"}
            </Button>
            <div className="provider-caption">
              {sandbox
                ? `${config.settings.provider} / local results only`
                : config.settings.demo
                  ? "Demo fixture"
                  : config.settings.provider}
            </div>
          </form>
        </CollapsibleContent>
      </Collapsible>
    </aside>
  );
}
