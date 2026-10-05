import { useState, type FormEvent } from "react";
import { useConfiguration } from "@/app/configuration-context";
import { useApiResource } from "@/hooks/use-api-resource";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Detail, Options, Review } from "@/types";
import { sameRevision } from "./revision";

export function useReview(path: string, sandbox: boolean) {
  const { config } = useConfiguration();
  const resource = useApiResource<Detail>(path);
  const [options, setOptions] = useState<Options>(config.settings.defaults);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [selected, select] = useState<string>();
  const review =
    resource.data?.reviews.find((item) => item.id === selected) ??
    resource.data?.reviews[0];
  const stale = Boolean(
    review &&
    resource.data &&
    !sameRevision(review.changes, resource.data.changes),
  );

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      const result = await api<Review>(`${path}/review`, "POST", {
        options,
        model,
      });
      resource.setData((previous) =>
        previous
          ? {
              ...previous,
              reviews: [result, ...previous.reviews].slice(0, 10),
            }
          : previous,
      );
      select(result.id);
      setNotice(
        sandbox
          ? "Sandbox review saved locally."
          : "Review generated. Comments are drafts until approved.",
      );
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function updateReview(result: Review) {
    resource.setData((previous) =>
      previous
        ? {
            ...previous,
            reviews: previous.reviews.map((item) =>
              item.id === result.id ? result : item,
            ),
          }
        : previous,
    );
  }

  return {
    ...resource,
    options,
    setOptions,
    model,
    setModel,
    busy,
    notice,
    actionError,
    review,
    stale,
    select,
    generate,
    updateReview,
  };
}
