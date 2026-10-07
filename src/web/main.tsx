import "./lib/theme-init";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { setUnauthorizedHandler } from "./lib/api";
import { queryKeys } from "./lib/endpoints";
import { createQueryClient } from "./lib/queryClient";
import { createAppRouter } from "./router";

const queryClient = createQueryClient();
const router = createAppRouter();

// 401 anywhere → back to the login screen (TSD 7: UNAUTHENTICATED / NOT_GUILD_MEMBER).
setUnauthorizedHandler((code) => {
  if (router.state.location.pathname === "/login") return;
  // A first visit (never signed in on this page) is not an error: show the plain login screen.
  const hadSession = queryClient.getQueryData(queryKeys.me) !== undefined;
  const reason = code === "NOT_GUILD_MEMBER" ? "not_member" : hadSession ? "session" : null;
  const to = reason ? `/login?error=${reason}` : "/login";
  void router.navigate(to, { replace: true }).then(() => queryClient.clear());
});

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
