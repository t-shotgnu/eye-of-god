import { useCallback, useEffect, useState, type SetStateAction } from "react";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";

interface Resource<T> {
  path: string;
  attempt: number;
  data?: T;
  error: string;
}

export function useApiResource<T>(path: string) {
  const [attempt, setAttempt] = useState(0);
  const [resource, setResource] = useState<Resource<T>>({
    path,
    attempt,
    error: "",
  });

  useEffect(() => {
    const controller = new AbortController();
    setResource({ path, attempt, error: "" });
    api<T>(path, "GET", undefined, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setResource({ path, attempt, data, error: "" });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResource({ path, attempt, error: errorMessage(error) });
        }
      });
    return () => controller.abort();
  }, [path, attempt]);

  const setData = useCallback(
    (value: SetStateAction<T | undefined>) => {
      setResource((previous) => {
        if (previous.path !== path || previous.attempt !== attempt)
          return previous;
        return {
          ...previous,
          data:
            typeof value === "function"
              ? (value as (data: T | undefined) => T | undefined)(previous.data)
              : value,
        };
      });
    },
    [path, attempt],
  );
  const reload = useCallback(() => setAttempt((previous) => previous + 1), []);

  // Hide the previous resource immediately, before the next effect runs.
  const current = resource.path === path && resource.attempt === attempt;
  return {
    data: current ? resource.data : undefined,
    error: current ? resource.error : "",
    setData,
    reload,
  };
}
