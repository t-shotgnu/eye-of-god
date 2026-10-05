import { BrowserRouter } from "react-router-dom";
import { Failure } from "@/components/failure";
import { Loading } from "@/components/loading-state";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApiResource } from "@/hooks/use-api-resource";
import type { Configuration } from "@/types";
import { ConfigurationContext } from "./configuration-context";
import { AppLayout } from "./app-layout";
import { AppRoutes } from "./routes";

export function App() {
  const { data, setData, error, reload } = useApiResource<{
    configuration: Configuration;
  }>("/session");

  if (!data) {
    return (
      <main className="page">
        {error ? <Failure error={error} retry={reload} /> : <Loading />}
      </main>
    );
  }

  return (
    <ConfigurationContext.Provider
      value={{
        config: data.configuration,
        update: (configuration) => setData({ configuration }),
      }}
    >
      <TooltipProvider delayDuration={300}>
        <BrowserRouter>
          <AppLayout>
            <AppRoutes />
          </AppLayout>
        </BrowserRouter>
      </TooltipProvider>
    </ConfigurationContext.Provider>
  );
}
