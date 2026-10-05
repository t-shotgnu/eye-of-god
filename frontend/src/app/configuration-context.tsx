import { createContext, useContext } from "react";
import type { Configuration } from "@/types";

interface ConfigurationContextValue {
  config: Configuration;
  update: (config: Configuration) => void;
}

export const ConfigurationContext =
  createContext<ConfigurationContextValue | null>(null);

export function useConfiguration() {
  const context = useContext(ConfigurationContext);
  if (!context) {
    throw new Error(
      "useConfiguration must be used within the configuration provider.",
    );
  }
  return context;
}
