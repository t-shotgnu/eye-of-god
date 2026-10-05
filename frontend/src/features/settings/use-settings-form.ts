import { useState, type FormEvent } from "react";
import { useConfiguration } from "@/app/configuration-context";
import { useModelCatalog } from "@/hooks/use-model-catalog";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Configuration, Settings } from "@/types";

export function useSettingsForm() {
  const { config, update } = useConfiguration();
  const [values, setValues] = useState(config.settings);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const catalog = useModelCatalog(
    config.settings.provider !== "copilot" &&
      (config.credentials.api_key || config.settings.provider === "compatible")
      ? { ...config.settings, refresh: false }
      : null,
  );

  function field<K extends keyof Settings>(name: K, value: Settings[K]) {
    setValues((previous) => ({ ...previous, [name]: value }));
    if (["provider", "api_base"].includes(name)) catalog.reset();
    setNotice("");
  }

  function credential(name: string, value: string) {
    setSecrets((previous) => ({ ...previous, [name]: value }));
    catalog.reset();
    setNotice("");
  }

  function clearCredential(name: string, checked: boolean) {
    setClear((previous) => ({ ...previous, [name]: checked }));
    catalog.reset();
    setNotice("");
  }

  const body = () => ({
    ...values,
    ...secrets,
    ...Object.fromEntries(
      Object.entries(clear).map(([name, checked]) => [
        `clear_${name}`,
        checked,
      ]),
    ),
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<Configuration>("/settings", "PUT", body());
      update(result);
      setValues(result.settings);
      setSecrets({});
      setClear({});
      catalog.reset();
      setNotice("Settings saved.");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return {
    config,
    values,
    secrets,
    clear,
    busy,
    error,
    notice,
    field,
    credential,
    clearCredential,
    save,
    models: catalog.models,
    modelNotice: catalog.notice,
    checking: catalog.busy,
    check: () => catalog.refresh({ ...body(), refresh: true }),
  };
}

export type SettingsForm = ReturnType<typeof useSettingsForm>;
