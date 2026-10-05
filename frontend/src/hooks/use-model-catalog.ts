import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface ModelCatalog {
  models: string[];
  message?: string;
}

export function useModelCatalog(
  initialRequest: Record<string, unknown> | null,
) {
  const [initial] = useState(initialRequest);
  const [models, setModels] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    request.current?.abort();
    setModels([]);
    setNotice("");
    setBusy(false);
  }, []);

  const refresh = useCallback(async (body: Record<string, unknown>) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setNotice("");
    try {
      const result = await api<ModelCatalog>(
        "/settings/ai/models",
        "POST",
        body,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setModels(result.models);
        setNotice(result.message ?? "");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setModels([]);
        setNotice(errorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initial) void refresh(initial);
    return () => request.current?.abort();
  }, [initial, refresh]);

  return { models, notice, busy, refresh, reset };
}
