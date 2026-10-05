import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { Options } from "@/types";
import { reviewOptionDefinitions } from "../options";

export function ReviewOptions({
  options,
  setOptions,
  disabled = false,
}: {
  options: Options;
  setOptions: (value: Options) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="sliders">
      {reviewOptionDefinitions.map(({ name, label, min, low, high }) => (
        <div className="slider" key={name}>
          <div className="slider-heading">
            <Label id={`${id}-${name}`}>{label}</Label>
            <output aria-hidden="true">{options[name]}</output>
          </div>
          <Slider
            aria-labelledby={`${id}-${name}`}
            min={min}
            max={10}
            step={1}
            value={[options[name]]}
            disabled={disabled}
            onValueChange={([value]) =>
              setOptions({
                ...options,
                [name]: value,
              })
            }
          />
          <div className="slider-scale">
            <span>{low}</span>
            <span>{high}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
