import { useEffect, useState } from "react";
import { AppShell } from "../layout/AppShell";
import { RedirectIfAuthenticated, RequireAuth } from "./guards";
import { CallbackPage } from "../../features/auth/CallbackPage";
import { ErrorPage } from "../../features/auth/ErrorPage";
import { LoginPage } from "../../features/auth/LoginPage";
import { NotFoundPage } from "../../features/auth/NotFoundPage";
import { ProfilePage } from "../../features/profile/ProfilePage";
import { MyReturnsPage } from "../../features/returns/MyReturnsPage";
import { NewReturnPage } from "../../features/returns/NewReturnPage";
import { ReturnDetailPage } from "../../features/returns/ReturnDetailPage";
import { OpsQueuePage } from "../../features/ops/OpsQueuePage";
import { OpsReviewPage } from "../../features/ops/OpsReviewPage";
import { InsightsPage } from "../../features/insights/InsightsPage";

const protectedRoutes = {
  "/": ProfilePage,
  "/error": ErrorPage,
  "/returns": MyReturnsPage,
  "/returns/new": NewReturnPage,
  "/ops": OpsQueuePage,
  "/ops/review": OpsReviewPage,
  "/insights": InsightsPage
};

// "/returns" and "/ops/review" both resolve on pathname alone; each page
// reads its own "id" off location.search (see currentReturnId/
// currentReviewId in the respective page components) rather than receiving
// it as a prop -- the router has no path params.
function resolveProtectedPage(path: string, search: string) {
  if (path === "/returns" && new URLSearchParams(search).get("id")) {
    return ReturnDetailPage;
  }
  return protectedRoutes[path as keyof typeof protectedRoutes];
}

export function AppRouter() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function navigate(nextPath: string) {
    const [nextPathname = "/", queryString = ""] = nextPath.split("?");
    window.history.pushState({}, "", nextPath);
    setPath(nextPathname);
    setSearch(queryString ? `?${queryString}` : "");
  }

  if (path === "/login/callback") {
    return <CallbackPage onNavigate={navigate} />;
  }

  if (path === "/login") {
    const returnTo = new URLSearchParams(search).get("returnTo") || undefined;
    return (
      <RedirectIfAuthenticated onNavigate={navigate}>
        <LoginPage returnTo={returnTo} />
      </RedirectIfAuthenticated>
    );
  }

  const Page = resolveProtectedPage(path, search);
  if (!Page) {
    return <NotFoundPage onNavigate={navigate} />;
  }

  return (
    <RequireAuth currentPath={path} onNavigate={navigate}>
      <AppShell activePath={path} onNavigate={navigate}>
        <Page />
      </AppShell>
    </RequireAuth>
  );
}
