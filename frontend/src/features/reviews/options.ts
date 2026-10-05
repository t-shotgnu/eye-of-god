import type { Options } from "@/types";

interface ReviewOptionDefinition {
  name: keyof Options;
  label: string;
  min: number;
  low: string;
  high: string;
}

export const reviewOptionDefinitions = [
  {
    name: "thoroughness",
    label: "Thoroughness",
    min: 1,
    low: "Low",
    high: "High",
  },
  { name: "nitpicking", label: "Nitpicking", min: 1, low: "Low", high: "High" },
  {
    name: "conventions",
    label: "Conventions",
    min: 1,
    low: "Low",
    high: "High",
  },
  { name: "tone", label: "Tone", min: 1, low: "Gentle", high: "Severe" },
  {
    name: "archaic_english",
    label: "Archaic English",
    min: 0,
    low: "Modern",
    high: "Ancient",
  },
] satisfies ReviewOptionDefinition[];
