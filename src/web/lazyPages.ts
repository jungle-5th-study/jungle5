// Writing and admin screens load on first use (keeps the entry chunk small);
// the editor is warmed in the background shortly after the app starts.
import { lazy } from "react";

const loadEditor = () => import("./pages/PostEditorPage");

export const PostEditorPage = lazy(() => loadEditor().then((m) => ({ default: m.PostEditorPage })));
export const AdminCategoriesPage = lazy(() =>
  import("./pages/AdminCategoriesPage").then((m) => ({ default: m.AdminCategoriesPage })),
);

export function preloadEditor(): void {
  void loadEditor().catch(() => undefined);
}

export const StudyFormPage = lazy(() => import("./pages/StudyFormPage").then((m) => ({ default: m.StudyFormPage })));
export const RoundFormPage = lazy(() => import("./pages/RoundFormPage").then((m) => ({ default: m.RoundFormPage })));
