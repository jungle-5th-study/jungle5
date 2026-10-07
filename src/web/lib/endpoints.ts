// Typed API calls (TSD 7.1) and TanStack Query keys.
import type {
  Category,
  CategoryList,
  Comment,
  Home,
  LinkableRound,
  Me,
  Page,
  PostDetail,
  PostHtmlUrl,
  PostListItem,
  Round,
  RoundDetail,
  StudyDetail,
  StudyList,
} from "../../shared/api";
import type {
  CategoryPatchInput,
  CommentCreateInput,
  PostCreateInput,
  PostHtmlInput,
  PostPatchInput,
  RoundCreateInput,
  RoundInfoPatchInput,
  RoundNotesPatchInput,
  StudyCreateInput,
  StudyPatchInput,
} from "../../shared/schemas";
import { request } from "./api";

export interface PostFilters {
  q?: string;
  category?: string;
  tag?: string;
}

export const queryKeys = {
  me: ["me"] as const,
  home: ["home"] as const,
  categories: ["categories"] as const,
  posts: ["posts"] as const,
  postList: (filters: PostFilters) => ["posts", "list", filters] as const,
  post: (id: string) => ["posts", "detail", id] as const,
  /** Signed URL of a post's HTML (TD-26); not under "posts" so list invalidations do not refetch it. */
  postHtmlUrl: (id: string) => ["post-html-url", id] as const,
  linkableRounds: ["me", "linkable-rounds"] as const,
  studies: ["studies"] as const,
  studyList: ["studies", "list"] as const,
  study: (id: string) => ["studies", "detail", id] as const,
  rounds: ["rounds"] as const,
  round: (id: string) => ["rounds", "detail", id] as const,
};

const enc = encodeURIComponent;

export const api = {
  me: () => request<Me>("/api/me"),
  refreshRoles: () => request<Me>("/api/me/refresh-roles", { method: "POST" }),
  withdraw: () => request<void>("/api/me", { method: "DELETE" }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),

  home: () => request<Home>("/api/home"),

  /** Ordered by post count desc, then name (UD-14). */
  categories: () => request<CategoryList>("/api/categories").then((r) => r.items),
  createCategory: (name: string) => request<Category>("/api/categories", { method: "POST", body: { name } }),
  patchCategory: (id: string, input: CategoryPatchInput) =>
    request<Category>(`/api/categories/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),

  posts: (filters: PostFilters, cursor: string | null, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v as string);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    return request<Page<PostListItem>>(`/api/posts${qs ? `?${qs}` : ""}`, { signal });
  },
  post: (id: string) => request<PostDetail>(`/api/posts/${encodeURIComponent(id)}`),
  createPost: (input: PostCreateInput) => request<PostDetail>("/api/posts", { method: "POST", body: input }),
  updatePost: (id: string, input: PostPatchInput) =>
    request<PostDetail>(`/api/posts/${encodeURIComponent(id)}`, { method: "PATCH", body: input }),
  deletePost: (id: string) => request<void>(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setPostHidden: (id: string, hidden: boolean) =>
    request<void>(`/api/posts/${encodeURIComponent(id)}/${hidden ? "hide" : "unhide"}`, { method: "POST" }),

  createComment: (postId: string, input: CommentCreateInput) =>
    request<Comment>(`/api/posts/${encodeURIComponent(postId)}/comments`, { method: "POST", body: input }),
  updateComment: (id: string, body: string) =>
    request<Comment>(`/api/comments/${encodeURIComponent(id)}`, { method: "PATCH", body: { body } }),
  deleteComment: (id: string) => request<void>(`/api/comments/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setCommentHidden: (id: string, hidden: boolean) =>
    request<void>(`/api/comments/${encodeURIComponent(id)}/${hidden ? "hide" : "unhide"}`, { method: "POST" }),

  // ---- attached HTML (D-30, TD-25, TD-26) ----
  postHtmlUrl: (id: string) => request<PostHtmlUrl>(`/api/posts/${enc(id)}/html-url`),
  putPostHtml: (id: string, input: PostHtmlInput) =>
    request<PostDetail>(`/api/posts/${enc(id)}/html`, { method: "PUT", body: input }),
  deletePostHtml: (id: string) => request<void>(`/api/posts/${enc(id)}/html`, { method: "DELETE" }),

  // ---- studies & rounds (M2) ----
  linkableRounds: () => request<{ items: LinkableRound[] }>("/api/me/linkable-rounds").then((r) => r.items),
  setPostRound: (postId: string, roundId: string | null) =>
    request<PostDetail>(`/api/posts/${enc(postId)}/round`, { method: "PUT", body: { roundId } }),

  studies: () => request<StudyList>("/api/studies").then((r) => r.items),
  study: (id: string) => request<StudyDetail>(`/api/studies/${enc(id)}`),
  createStudy: (input: StudyCreateInput) => request<StudyDetail>("/api/studies", { method: "POST", body: input }),
  patchStudy: (id: string, input: StudyPatchInput) =>
    request<StudyDetail>(`/api/studies/${enc(id)}`, { method: "PATCH", body: input }),
  setStudyRole: (id: string, discordRoleId: string) =>
    request<StudyDetail>(`/api/studies/${enc(id)}/role`, { method: "PUT", body: { discordRoleId } }),
  setStudyStatus: (id: string, action: "end" | "reopen" | "hide" | "unhide") =>
    request<unknown>(`/api/studies/${enc(id)}/${action}`, { method: "POST" }),

  createRound: (studyId: string, input: RoundCreateInput) =>
    request<Round>(`/api/studies/${enc(studyId)}/rounds`, { method: "POST", body: input }),
  round: (id: string) => request<RoundDetail>(`/api/rounds/${enc(id)}`),
  patchRoundInfo: (id: string, input: RoundInfoPatchInput) =>
    request<Round>(`/api/rounds/${enc(id)}/info`, { method: "PATCH", body: input }),
  patchRoundNotes: (id: string, input: RoundNotesPatchInput) =>
    request<Round>(`/api/rounds/${enc(id)}/notes`, { method: "PATCH", body: input }),
  setRoundStatus: (id: string, action: "end" | "reopen") =>
    request<Round>(`/api/rounds/${enc(id)}/${action}`, { method: "POST" }),
  deleteRound: (id: string) => request<void>(`/api/rounds/${enc(id)}`, { method: "DELETE" }),
  createRoundComment: (roundId: string, input: CommentCreateInput) =>
    request<Comment>(`/api/rounds/${enc(roundId)}/comments`, { method: "POST", body: input }),
};
