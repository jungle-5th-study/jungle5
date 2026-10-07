import { createBrowserRouter, type RouteObject } from "react-router";
import { AppShell } from "./components/AppShell";
import { AdminCategoriesPage, PostEditorPage, RoundFormPage, StudyFormPage } from "./lazyPages";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { MePage } from "./pages/MePage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PostDetailPage } from "./pages/PostDetailPage";
import { PostListPage } from "./pages/PostListPage";
import { RoundDetailPage } from "./pages/RoundDetailPage";
import { StudiesPage } from "./pages/StudiesPage";
import { StudyDetailPage } from "./pages/StudyDetailPage";


export const routes: RouteObject[] = [
  { path: "/login", element: <LoginPage /> },
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "posts", element: <PostListPage /> },
      { path: "posts/new", element: <PostEditorPage key="new" mode="new" /> },
      { path: "posts/:id", element: <PostDetailPage /> },
      { path: "posts/:id/edit", element: <PostEditorPage key="edit" mode="edit" /> },
      { path: "studies", element: <StudiesPage /> },
      { path: "studies/new", element: <StudyFormPage key="new" mode="new" /> },
      { path: "studies/:id", element: <StudyDetailPage /> },
      { path: "studies/:id/edit", element: <StudyFormPage key="edit" mode="edit" /> },
      { path: "studies/:id/rounds/new", element: <RoundFormPage key="new" mode="new" /> },
      { path: "rounds/:id", element: <RoundDetailPage /> },
      { path: "rounds/:id/edit", element: <RoundFormPage key="edit" mode="edit" /> },
      { path: "me", element: <MePage /> },
      { path: "admin/categories", element: <AdminCategoriesPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(routes);
