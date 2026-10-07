import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { PostDetail } from "../../shared/api";
import { Comments } from "../components/Comments";
import { Markdown } from "../components/Markdown";
import { PostHtmlFrame } from "../components/PostHtmlFrame";
import { PostRoundLink } from "../components/PostRoundLink";
import { parseUrl, safeHref } from "../lib/urls";
import { useToast } from "../components/toast";
import {
  Alert,
  AuthorName,
  btn,
  ConfirmDialog,
  ErrorState,
  HiddenBadge,
  meta,
  MetaList,
  pageTitle,
  Skeleton,
  Time,
} from "../components/ui";
import { ApiError, errorMessage } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useSession } from "../lib/session";
import { NotFoundPage } from "./NotFoundPage";

export function PostDetailPage() {
  const { id = "" } = useParams();
  const post = useQuery({ queryKey: queryKeys.post(id), queryFn: () => api.post(id) });

  if (post.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="불러오는 중" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-4/5" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (post.isError) {
    if (post.error instanceof ApiError && post.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="글을 불러오지 못했습니다." error={post.error} onRetry={() => void post.refetch()} />;
  }
  return <PostView post={post.data} />;
}

function PostView({ post }: { post: PostDetail }) {
  const me = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isAuthor = post.author.id === me.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();

  const invalidateLists = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.posts }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
    ]);

  const del = useMutation({
    mutationFn: () => api.deletePost(post.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.post(post.id) });
      await invalidateLists();
      await navigate("/posts", { replace: true });
      toast("글을 삭제했습니다");
    },
  });

  const hide = useMutation({
    mutationFn: (hidden: boolean) => api.setPostHidden(post.id, hidden),
    onSuccess: async (_, hidden) => {
      await invalidateLists();
      toast(hidden ? "글을 숨겼습니다" : "글 숨김을 해제했습니다");
    },
  });

  const edited = post.updatedAt > post.createdAt;

  return (
    // data-wide: with an embedded HTML file the app shell widens the column (960px) like round pages.
    <article data-wide={post.html ? true : undefined} className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${meta}`}>
          {post.hidden && <HiddenBadge />}
          <MetaList
            items={[
              <Link key="c" to={`/posts?category=${encodeURIComponent(post.category.id)}`} className="hover:text-text hover:underline">
                {post.category.name}
                {post.category.archived ? " (보관됨)" : ""}
              </Link>,
              <AuthorName key="a" author={post.author} />,
              <Time key="t" ms={post.createdAt} />,
              edited && (
                <span key="e">
                  수정됨 <Time ms={post.updatedAt} />
                </span>
              ),
            ]}
          />
        </p>
        <h1 className={`${pageTitle} break-words`}>{post.title}</h1>
        <PostRoundLink post={post} isAuthor={isAuthor} />
        {post.hidden && <Alert kind="info">운영자가 숨긴 글입니다. 운영자와 작성자 본인에게만 보입니다.</Alert>}
      </header>

      {post.html && <PostHtmlFrame postId={post.id} title={post.title} meta={post.html} />}

      <div className="max-w-prose">
        <Markdown source={post.body} />
      </div>

      {(post.tags.length > 0 || post.links.length > 0) && (
        <div className="flex flex-col gap-5 border-t border-border pt-6">
          {post.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="태그">
              {post.tags.map((t) => (
                <li key={t}>
                  <Link
                    to={`/posts?tag=${encodeURIComponent(t)}`}
                    className="inline-flex h-7 items-center rounded bg-accent-subtle px-2 text-[13px] font-medium text-accent-subtle-text hover:underline"
                  >
                    #{t}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {post.links.length > 0 && (
            <section aria-labelledby="links">
              <h2 id="links" className="mb-2 text-base font-bold">
                참고 링크
              </h2>
              <ul className="flex flex-col gap-1">
                {post.links.map((l, i) => {
                  const href = safeHref(l.url);
                  return (
                    <li key={i} className="text-sm break-all">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={btn.link}>
                          {l.label || l.url}
                        </a>
                      ) : (
                        <span>{l.label || l.url}</span>
                      )}
                      {l.label && href && <span className="ml-2 text-xs text-muted">{parseUrl(href)?.host}</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {(isAuthor || me.isAdmin) && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {isAuthor && (
              <>
                <Link to={`/posts/${post.id}/edit`} className={btn.secondary}>
                  수정
                </Link>
                <button type="button" className={btn.danger} onClick={() => setConfirmDelete(true)}>
                  삭제
                </button>
              </>
            )}
            {me.isAdmin && (
              <button
                type="button"
                className={btn.secondary}
                disabled={hide.isPending}
                onClick={() => hide.mutate(!post.hidden)}
              >
                {post.hidden ? "숨김 해제" : "숨기기"}
              </button>
            )}
          </div>
          {hide.isError && <Alert>{errorMessage(hide.error)}</Alert>}
        </div>
      )}

      <Comments comments={post.comments} target={{ kind: "post", id: post.id }} />

      <ConfirmDialog
        open={confirmDelete}
        title="글을 삭제할까요?"
        confirmLabel="영구 삭제"
        danger
        pending={del.isPending}
        error={del.isError ? <Alert>{errorMessage(del.error)}</Alert> : undefined}
        onConfirm={() => del.mutate()}
        onCancel={() => {
          setConfirmDelete(false);
          del.reset();
        }}
      >
        <p>삭제한 글은 되돌릴 수 없습니다. 이 글에 달린 댓글도 함께 삭제됩니다.</p>
      </ConfirmDialog>
    </article>
  );
}
