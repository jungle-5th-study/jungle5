// A post's linked round (F-08): chip for everyone; the author can change or unlink it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import type { PostDetail } from "../../shared/api";
import { errorMessage } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useToast } from "./toast";
import { Alert, btn, input } from "./ui";

export function PostRoundLink({ post, isAuthor }: { post: PostDetail; isAuthor: boolean }) {
  const [editing, setEditing] = useState(false);
  const round = post.round;
  if (!round && !isAuthor) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {round ? (
          <Link
            to={`/rounds/${round.id}`}
            className="inline-flex min-h-8 items-center gap-1.5 rounded bg-accent-subtle px-2.5 text-[13px] font-medium text-accent-subtle-text hover:underline"
          >
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" />
            {round.studyName} {round.seq}회차 · {round.title}
          </Link>
        ) : (
          <span className="text-[13px] text-muted">연결된 회차 없음</span>
        )}
        {isAuthor && !editing && (
          <button type="button" className={btn.link} onClick={() => setEditing(true)}>
            {round ? "회차 변경" : "회차 연결"}
          </button>
        )}
      </div>
      {editing && <RoundPicker post={post} onDone={() => setEditing(false)} />}
    </div>
  );
}

function RoundPicker({ post, onDone }: { post: PostDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const id = useId();
  const rounds = useQuery({ queryKey: queryKeys.linkableRounds, queryFn: api.linkableRounds });
  const [value, setValue] = useState(post.round?.id ?? "");
  const set = useMutation({
    mutationFn: (roundId: string | null) => api.setPostRound(post.id, roundId),
    onSuccess: async (detail, roundId) => {
      queryClient.setQueryData(queryKeys.post(post.id), detail);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.posts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
      onDone();
      toast(roundId ? "회차를 연결했습니다" : "회차 연결을 해제했습니다");
    },
  });
  const items = rounds.data ?? [];
  // The current round may no longer be linkable (ended); keep it visible as the current choice.
  const current = post.round && !items.some((r) => r.id === post.round!.id) ? post.round : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <label htmlFor={id} className="text-[13px] font-semibold text-muted">
        연결할 회차
      </label>
      <div className="flex flex-wrap gap-2">
        <select id={id} className={`${input} w-auto min-w-0 flex-1`} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">연결 안 함</option>
          {current && (
            <option value={current.id}>
              {current.studyName} {current.seq}회차 · {current.title} (현재)
            </option>
          )}
          {items.map((r) => (
            <option key={r.id} value={r.id}>
              {r.studyName} {r.seq}회차 · {r.title}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btn.primary}
          disabled={set.isPending || value === (post.round?.id ?? "")}
          onClick={() => set.mutate(value || null)}
        >
          {set.isPending ? "저장 중…" : "저장"}
        </button>
        <button type="button" className={btn.ghost} onClick={onDone} disabled={set.isPending}>
          취소
        </button>
      </div>
      {rounds.isSuccess && items.length === 0 && (
        <p className="text-xs text-muted">연결할 수 있는 회차가 없습니다. 내 스터디의 진행 중인 회차만 연결할 수 있습니다.</p>
      )}
      {rounds.isError && <p className="text-sm text-danger">회차 목록을 불러오지 못했습니다.</p>}
      {set.isError && <Alert>{errorMessage(set.error)}</Alert>}
    </div>
  );
}
