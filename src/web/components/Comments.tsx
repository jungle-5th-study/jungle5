// Comments on posts and rounds (PRD F-04, F-09; D-05: single level, no notifications).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import type { Comment } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import { uuidv7 } from "../../shared/ids";
import { errorMessage, fieldError, ApiError } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useSession } from "../lib/session";
import { useToast } from "./toast";
import { Alert, AuthorName, Avatar, btn, ConfirmDialog, HiddenBadge, input, Time } from "./ui";

export interface CommentTarget {
  kind: "post" | "round";
  id: string;
}

function useInvalidateTarget(target: CommentTarget) {
  const queryClient = useQueryClient();
  return () =>
    target.kind === "post"
      ? Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.post(target.id) }),
          // Comment counts on list rows.
          queryClient.invalidateQueries({ queryKey: [...queryKeys.posts, "list"] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        ])
      : queryClient.invalidateQueries({ queryKey: queryKeys.round(target.id) });
}

export function Comments({
  comments,
  target,
  canComment = true,
}: {
  comments: Comment[];
  target: CommentTarget;
  canComment?: boolean;
}) {
  return (
    <section aria-labelledby="comments" className="flex flex-col gap-4 border-t border-border pt-8">
      <h2 id="comments" className="text-lg font-bold">
        댓글 {comments.length}
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-muted">아직 댓글이 없습니다.</p>
      ) : (
        <ul className="border-t border-border">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} target={target} />
          ))}
        </ul>
      )}
      {canComment ? (
        <CommentForm target={target} />
      ) : (
        <p className="text-sm text-muted">이 스터디 멤버만 댓글을 쓸 수 있습니다.</p>
      )}
    </section>
  );
}

function CommentForm({ target }: { target: CommentTarget }) {
  const invalidate = useInvalidateTarget(target);
  const textareaId = useId();
  const [body, setBody] = useState("");
  // TD-13: one client id per comment, kept across retries so a resend never duplicates.
  const [commentId, setCommentId] = useState(() => uuidv7());
  const toast = useToast();
  const create = useMutation({
    mutationFn: () =>
      target.kind === "post"
        ? api.createComment(target.id, { id: commentId, body })
        : api.createRoundComment(target.id, { id: commentId, body }),
    onSuccess: async () => {
      setBody("");
      setCommentId(uuidv7());
      await invalidate();
      toast("댓글을 등록했습니다");
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || create.isPending) return;
    create.mutate();
  };
  const bodyError = create.error instanceof ApiError ? fieldError(create.error.fields, "body") : undefined;
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <label htmlFor={textareaId} className="sr-only">
        댓글 쓰기
      </label>
      <textarea
        id={textareaId}
        className={`${input} min-h-24`}
        placeholder="댓글을 입력하세요"
        value={body}
        maxLength={LIMITS.commentBodyMax}
        onChange={(e) => setBody(e.target.value)}
        aria-invalid={Boolean(bodyError)}
      />
      {create.isError && <Alert>{bodyError ?? errorMessage(create.error)}</Alert>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {body.length.toLocaleString()} / {LIMITS.commentBodyMax.toLocaleString()}
        </span>
        <button type="submit" className={btn.primary} disabled={create.isPending || !body.trim()}>
          {create.isPending ? "등록 중…" : "댓글 등록"}
        </button>
      </div>
    </form>
  );
}

function CommentItem({ comment, target }: { comment: Comment; target: CommentTarget }) {
  const me = useSession();
  const invalidate = useInvalidateTarget(target);
  const isAuthor = comment.author.id === me.id;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editId = useId();
  const toast = useToast();

  const update = useMutation({
    mutationFn: () => api.updateComment(comment.id, draft),
    onSuccess: async () => {
      setEditing(false);
      await invalidate();
    },
  });
  const del = useMutation({
    mutationFn: () => api.deleteComment(comment.id),
    onSuccess: async () => {
      setConfirmDelete(false);
      await invalidate();
      toast("댓글을 삭제했습니다");
    },
  });
  const hide = useMutation({
    mutationFn: (hidden: boolean) => api.setCommentHidden(comment.id, hidden),
    onSuccess: invalidate,
  });

  return (
    <li className="flex gap-3 border-b border-border py-4">
      <Avatar name={comment.author.displayName} url={comment.author.avatarUrl} withdrawn={comment.author.withdrawn} size="sm" />
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span className="font-semibold text-text">
          <AuthorName author={comment.author} />
        </span>
        <Time ms={comment.createdAt} />
        {comment.updatedAt > comment.createdAt && <span>(수정됨)</span>}
        {comment.hidden && <HiddenBadge />}
      </div>
      {editing ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim() && !update.isPending) update.mutate();
          }}
        >
          <label htmlFor={editId} className="sr-only">
            댓글 수정
          </label>
          <textarea
            id={editId}
            className={`${input} min-h-20`}
            value={draft}
            maxLength={LIMITS.commentBodyMax}
            onChange={(e) => setDraft(e.target.value)}
          />
          {update.isError && <Alert>{errorMessage(update.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className={btn.secondary}
              disabled={update.isPending}
              onClick={() => {
                setEditing(false);
                setDraft(comment.body);
                update.reset();
              }}
            >
              취소
            </button>
            <button type="submit" className={btn.primary} disabled={update.isPending || !draft.trim()}>
              {update.isPending ? "저장 중…" : "저장"}
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-1 text-[15px] break-words whitespace-pre-wrap text-text">{comment.body}</p>
      )}
      {!editing && (isAuthor || me.isAdmin) && (
        <div className="mt-1 -ml-3 flex flex-wrap gap-1">
          {isAuthor && (
            <>
              <button
                type="button"
                className={btn.ghost}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                }}
              >
                수정
              </button>
              <button type="button" className={btn.ghost} onClick={() => setConfirmDelete(true)}>
                삭제
              </button>
            </>
          )}
          {me.isAdmin && (
            <button
              type="button"
              className={btn.ghost}
              disabled={hide.isPending}
              onClick={() => hide.mutate(!comment.hidden)}
            >
              {comment.hidden ? "숨김 해제" : "숨기기"}
            </button>
          )}
        </div>
      )}
      {hide.isError && <Alert>{errorMessage(hide.error)}</Alert>}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="댓글을 삭제할까요?"
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
        <p>삭제한 댓글은 되돌릴 수 없습니다.</p>
      </ConfirmDialog>
    </li>
  );
}
