// Round page (docs/ui.md 5): left = title·goal·scope → linked posts → notes →
// comments; right = info panel (meeting, period, carry-over, last edit, actions).
// Below 1024px the panel comes right after the title.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { RoundDetail } from "../../shared/api";
import { Comments } from "../components/Comments";
import { Markdown } from "../components/Markdown";
import { PostRow } from "../components/PostRow";
import { RoundNotes } from "../components/RoundNotes";
import { PlusIcon } from "../components/icons";
import { useToast } from "../components/toast";
import {
  Alert,
  AuthorName,
  btn,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  meta,
  pageTitle,
  sectionTitle,
  Skeleton,
  Time,
  useNow,
} from "../components/ui";
import { ApiError, errorMessage } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { formatMeeting, formatPeriod } from "../lib/kst";
import { safeHref } from "../lib/urls";
import { NotFoundPage } from "./NotFoundPage";
import { statusLabel } from "./StudyDetailPage";

export function RoundDetailPage() {
  const { id = "" } = useParams();
  const round = useQuery({ queryKey: queryKeys.round(id), queryFn: () => api.round(id) });
  if (round.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="불러오는 중" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (round.isError) {
    if (round.error instanceof ApiError && round.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="회차를 불러오지 못했습니다." error={round.error} onRetry={() => void round.refetch()} />;
  }
  return <RoundView key={round.data.id} round={round.data} />;
}

function RoundView({ round }: { round: RoundDetail }) {
  const ended = round.status === "ended" || round.study.status === "ended";
  return (
    // data-wide: the app shell widens its content column for this two-column page.
    <div data-wide className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[auto_1fr]">
      <header className="flex flex-col gap-2 lg:col-start-1 lg:row-start-1">
        <p className={meta}>
          <Link to={`/studies/${round.study.id}`} className="hover:text-text hover:underline">
            {round.study.name}
          </Link>{" "}
          · {round.seq}회차 · {statusLabel(round.status)}
        </p>
        <h1 className={`${pageTitle} break-words`}>{round.title}</h1>
        <p className="text-[15px] break-words whitespace-pre-wrap text-muted">{round.goal}</p>
        {ended && (
          <div className="mt-2">
            <Alert kind="info">
              {round.study.status === "ended" ? "종료된 스터디의 회차입니다." : "종료된 회차입니다."} 정보와 모임 기록은 읽기
              전용이며, 댓글은 계속 남길 수 있습니다.
            </Alert>
          </div>
        )}
      </header>

      <InfoPanel round={round} />

      <div className="flex min-w-0 flex-col gap-10 lg:col-start-1 lg:row-start-2">
        <section aria-labelledby="scope" className="flex flex-col gap-2">
          <h2 id="scope" className={sectionTitle}>
            학습 범위
          </h2>
          <Markdown source={round.scope} />
        </section>

        {round.materials?.trim() && (
          <section aria-labelledby="round-materials" className="flex flex-col gap-2">
            <h2 id="round-materials" className={sectionTitle}>
              공통 자료
            </h2>
            <Markdown source={round.materials} />
          </section>
        )}

        <section aria-labelledby="linked-posts" className="flex flex-col">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="linked-posts" className={sectionTitle}>
              연결된 글 <span className="text-sm font-normal text-muted">{round.posts.length}</span>
            </h2>
            {round.permissions.canLink && (
              <Link to={`/posts/new?roundId=${encodeURIComponent(round.id)}`} className={btn.link}>
                <span className="inline-flex items-center gap-1">
                  <PlusIcon size={14} />이 회차에 글 쓰기
                </span>
              </Link>
            )}
          </div>
          {round.posts.length === 0 ? (
            <EmptyState>
              아직 연결된 글이 없습니다.
              {round.permissions.canLink ? " 공부한 내용을 글로 남기고 이 회차에 연결해 보세요." : ""}
            </EmptyState>
          ) : (
            <div className="border-t border-border">
              {round.posts.map((p) => (
                <PostRow key={p.id} post={p} showExcerpt={false} compact hideRound />
              ))}
            </div>
          )}
        </section>

        <RoundNotes round={round} />

        <Comments comments={round.comments} target={{ kind: "round", id: round.id }} canComment={round.permissions.canComment} />
      </div>
    </div>
  );
}

function isUrl(s: string): string | null {
  return /^https?:\/\//i.test(s.trim()) ? safeHref(s) : null;
}

function InfoPanel({ round }: { round: RoundDetail }) {
  const now = useNow();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const p = round.permissions;
  const period = formatPeriod(round.periodStart, round.periodEnd, now);
  const locationHref = round.location ? isUrl(round.location) : null;
  const prev = round.previous;
  const carried = prev && (prev.notesOpenQuestions?.trim() || prev.notesNextActions?.trim());

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
      queryClient.invalidateQueries({ queryKey: queryKeys.studies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.linkableRounds }),
    ]);

  const status = useMutation({
    mutationFn: () => api.setRoundStatus(round.id, round.status === "active" ? "end" : "reopen"),
    onSuccess: async (r) => {
      await invalidate();
      toast(r.status === "ended" ? "회차를 종료했습니다" : "회차를 재개했습니다");
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteRound(round.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: queryKeys.round(round.id) });
      await invalidate();
      await navigate(`/studies/${round.study.id}`, { replace: true });
      toast(`${round.seq}회차를 삭제했습니다`);
    },
  });

  const block = "flex flex-col gap-1 border-t border-border pt-4 first:border-t-0 first:pt-0";
  const label = "text-xs font-semibold text-muted";

  return (
    <aside
      aria-label="회차 정보"
      className="flex flex-col gap-4 self-start rounded-xl border border-border bg-surface p-5 text-sm lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1"
    >
      <div className={block}>
        <span className={label}>모임</span>
        <span className="text-[15px] font-semibold">{round.meetingAt !== null ? formatMeeting(round.meetingAt, now) : "일정 미정"}</span>
        {round.location &&
          (locationHref ? (
            <a href={locationHref} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-link hover:underline">
              {round.location}
            </a>
          ) : (
            <span className="break-words">{round.location}</span>
          ))}
      </div>

      <div className={block}>
        <span className={label}>학습 기간</span>
        <span>{period ?? "정해지지 않음"}</span>
      </div>

      {prev && (
        <div className={block}>
          <span className={label}>지난 회차에서 넘어온 것</span>
          {carried ? (
            <>
              {prev.notesOpenQuestions?.trim() && (
                <div>
                  <span className="text-xs text-muted">남은 질문</span>
                  <Markdown source={prev.notesOpenQuestions} />
                </div>
              )}
              {prev.notesNextActions?.trim() && (
                <div>
                  <span className="text-xs text-muted">다음 행동</span>
                  <Markdown source={prev.notesNextActions} />
                </div>
              )}
            </>
          ) : (
            <span className="text-muted">남은 질문·다음 행동이 없습니다.</span>
          )}
          <Link to={`/rounds/${prev.id}`} className={btn.link}>
            {prev.seq}회차 기록 보기
          </Link>
        </div>
      )}

      <div className={`${block} text-xs text-muted`}>
        {round.infoUpdatedBy && round.infoUpdatedAt ? (
          <span>
            정보 수정: <AuthorName author={round.infoUpdatedBy} /> · <Time ms={round.infoUpdatedAt} />
          </span>
        ) : (
          <span>
            만든 사람: <AuthorName author={round.createdBy} /> · <Time ms={round.createdAt} />
          </span>
        )}
        {round.notesUpdatedBy && round.notesUpdatedAt && (
          <span>
            기록 수정: <AuthorName author={round.notesUpdatedBy} /> · <Time ms={round.notesUpdatedAt} />
          </span>
        )}
      </div>

      {(p.canEditInfo || p.canSetStatus || p.canDelete) && (
        <div className={`${block} gap-2`}>
          {p.canEditInfo && (
            <Link to={`/rounds/${round.id}/edit`} className={btn.secondary}>
              회차 정보 편집
            </Link>
          )}
          {p.canSetStatus && (
            <button type="button" className={btn.secondary} disabled={status.isPending} onClick={() => status.mutate()}>
              {status.isPending ? "처리 중…" : round.status === "active" ? "회차 종료" : "회차 재개"}
            </button>
          )}
          {p.canDelete && (
            <button
              type="button"
              className={btn.danger}
              onClick={() => {
                del.reset();
                setConfirmDelete(true);
              }}
            >
              회차 삭제
            </button>
          )}
          {status.isError && <Alert>{errorMessage(status.error)}</Alert>}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`${round.seq}회차를 삭제할까요?`}
        confirmLabel="삭제"
        danger
        pending={del.isPending}
        error={del.isError ? <Alert>{errorMessage(del.error)}</Alert> : undefined}
        onConfirm={() => del.mutate()}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>빈 회차만 삭제할 수 있고, 삭제하면 되돌릴 수 없습니다.</p>
      </ConfirmDialog>
    </aside>
  );
}
