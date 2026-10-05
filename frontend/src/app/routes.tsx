import {
  Link,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { DashboardPage } from "@/features/pull-requests/dashboard-page";
import { ReviewPage } from "@/features/reviews/review-page";
import { PublishPage } from "@/features/reviews/publish-page";
import { SettingsPage } from "@/features/settings/settings-page";

// Each PR owns its controls, selected review, notices, and pending requests.
function ReviewRoute() {
  const { id } = useParams();
  return <ReviewPage key={id} />;
}

function PublishRoute() {
  const { id, reviewId } = useParams();
  const [search] = useSearchParams();
  return (
    <PublishPage key={`${id}/${reviewId}/${search.get("finding_id") ?? ""}`} />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/prs/:id" element={<ReviewRoute />} />
      <Route path="/sandbox" element={<ReviewPage key="sandbox" sandbox />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route
        path="/prs/:id/reviews/:reviewId/publish"
        element={<PublishRoute />}
      />
      <Route
        path="*"
        element={
          <main className="page">
            <h1>Page not found</h1>
            <Link to="/">Pull requests</Link>
          </main>
        }
      />
    </Routes>
  );
}
