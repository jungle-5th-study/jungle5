// Study page (docs/ui.md 5): name·goal (join guide for non-members) → next
// meeting → rounds → shared materials → members; admin actions under "관리".
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link, useParams } from "react-router";
import type { RoundRef, StudyDetail } from "../../shared/api";
import { Markdown } from "../components/Markdown";
import { RefreshRolesButton, RefreshRolesError, useRefreshRoles } from "../components/RefreshRolesButton";
import { PlusIcon } from "../components/icons";
import { useToast } from "../components/toast";
import {
  Alert,
  AuthorName,
  Avatar,
  btn,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  input,
  meta,
  pageTitle,
  sectionTitle,
  Skeleton,
  useNow,
} from "../components/ui";
import { ApiError, errorMessage } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { formatKstDate, formatMeeting } from "../lib/kst";
import { NotFoundPage } from "./NotFoundPage";

export const statusLabel = (s: "active" | "ended") => (s === "active" ? "진행 중" : "종료");

/** DUPLICATE on a Discord role: name the study that already uses it. */
export function roleTakenMessage(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== "DUPLICATE") return null;
  const ex = err.existing as { name?: unknown } | undefined;
  return typeof ex?.name === "string"
    ? `이 Discord 역할은 이미 "${ex.name}" 스터디에 연결되어 있습니다.`
    : "이 Discord 역할은 이미 다른 스터디에 연결되어 있습니다.";
}

export function StudyDetailPage() {
  const { id = "" } = useParams();
  const study = useQuery({ queryKey: queryKeys.study(id), queryFn: () => api.study(id) });
  if (study.isPending) {
    return (
      <div role="status" aria-busy="true" aria-label="불러오는 중" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }
  if (study.isError) {
    if (study.error instanceof ApiError && study.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="스터디를 불러오지 못했습니다." error={study.error} onRetry={() => void study.refetch()} />;
  }
  return <StudyView study={study.data} />;
}

function StudyView({ study }: { study: StudyDetail }) {
  const now = useNow();
  const refresh = useRefreshRoles();
  const next = study.rounds
    .filter((r): r is RoundRef & { meetingAt: number } => r.meetingAt !== null && r.meetingAt >= now)
    .sort((a, b) => a.meetingAt - b.meetingAt)[0];
  const rounds = [...study.rounds].reverse();
  const ended = study.status === "ended";

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <p className={meta}>
          <Link to="/studies" className="hover:text-text hover:underline">
            스터디
          </Link>{" "}
          · {statusLabel(study.status)} · 멤버 {study.members.length}
          {study.cadence ? ` · ${study.cadence}` : ""}
        </p>
        <h1 className={`${pageTitle} break-words`}>
          {study.name}
          {study.hidden && (
            <span className="ml-2 rounded border border-border px-1.5 py-0.5 align-middle text-xs font-medium text-muted">
              숨김
            </span>
          )}
        </h1>
        <p className="text-[15px] break-words whitespace-pre-wrap">{study.goal}</p>
        {study.permissions.canEdit && (
          <div>
            <Link to={`/studies/${study.id}/edit`} className={btn.secondary}>
              스터디 정보 편집
            </Link>
          </div>
        )}
        {ended && <Alert kind="info">종료된 스터디입니다. 회차와 기록은 읽기 전용으로 남아 있습니다.</Alert>}
      </header>

      {!study.isMember && (
        <section aria-labelledby="join" className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
          <h2 id="join" className="text-base font-bold">
            참여 방법
          </h2>
          {study.joinGuide?.trim() ? (
            <Markdown source={study.joinGuide} />
          ) : (
            <p className="text-sm text-muted">참여 안내가 아직 없습니다. 운영진에게 문의하세요.</p>
          )}
          <p className="text-[13px] text-muted">
            Discord에서 역할을 받은 뒤 아래 버튼을 누르면 바로 멤버로 반영됩니다. 멤버가 아니면 읽기만 할 수 있습니다.
          </p>
          <div>
            <RefreshRolesButton refresh={refresh} />
          </div>
          <RefreshRolesError refresh={refresh} />
        </section>
      )}

      <section aria-labelledby="next-meeting" className="flex flex-col gap-2">
        <h2 id="next-meeting" className={sectionTitle}>
          다음 모임
        </h2>
        {next ? (
          <Link
            to={`/rounds/${next.id}`}
            className="group flex gap-6 border-y border-border py-[18px] text-text"
          >
            <span className="w-28 shrink-0 text-[15px] font-bold">{formatMeeting(next.meetingAt, now)}</span>
            <span className="min-w-0">
              <span className="block text-[13px] text-muted">{next.seq}회차</span>
              <span className="block text-[17px] font-semibold group-hover:underline">{next.title}</span>
            </span>
          </Link>
        ) : (
          <p className="text-sm text-muted">예정된 모임이 없습니다.</p>
        )}
      </section>

      <section aria-labelledby="rounds" className="flex flex-col">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="rounds" className={sectionTitle}>
            회차 <span className="text-sm font-normal text-muted">{study.rounds.length}</span>
          </h2>
          {study.permissions.canCreateRound && (
            <Link to={`/studies/${study.id}/rounds/new`} className={btn.secondary}>
              <PlusIcon />새 회차
            </Link>
          )}
        </div>
        {rounds.length === 0 ? (
          <EmptyState>
            아직 회차가 없습니다.
            {study.permissions.canCreateRound ? " 첫 회차를 만들어 보세요." : ""}
          </EmptyState>
        ) : (
          <ul className="border-t border-border">
            {rounds.map((r) => (
              <li key={r.id} className="group relative flex items-center gap-4 border-b border-border py-3.5">
                <span className="w-14 shrink-0 text-sm font-semibold text-muted tabular-nums">{r.seq}회차</span>
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/rounds/${r.id}`}
                    className="font-semibold break-words text-text group-hover:underline after:absolute after:inset-0"
                  >
                    {r.title}
                  </Link>
                  <span className="block text-[13px] text-muted">
                    {r.meetingAt ? formatKstDate(r.meetingAt, now) : "일정 미정"}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                    r.status === "active" ? "bg-accent-subtle text-accent-subtle-text" : "border border-border text-muted"
                  }`}
                >
                  {statusLabel(r.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {study.description?.trim() && (
        <section aria-labelledby="about" className="flex flex-col gap-3">
          <h2 id="about" className={sectionTitle}>
            소개
          </h2>
          <Markdown source={study.description} />
        </section>
      )}

      <section aria-labelledby="materials" className="flex flex-col gap-3">
        <h2 id="materials" className={sectionTitle}>
          공통 자료
        </h2>
        {study.materials?.trim() ? (
          <Markdown source={study.materials} />
        ) : (
          <p className="text-sm text-muted">등록된 공통 자료가 없습니다.</p>
        )}
      </section>

      <section aria-labelledby="members" className="flex flex-col gap-3">
        <h2 id="members" className={sectionTitle}>
          멤버 <span className="text-sm font-normal text-muted">{study.members.length}</span>
        </h2>
        <p className="text-[13px] text-muted">Discord 역할을 가진 멤버입니다.</p>
        {study.members.length === 0 ? (
          <p className="text-sm text-muted">아직 멤버가 없습니다.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-5 gap-y-3">
            {study.members.map((m) => (
              <li key={m.id} className={`flex items-center gap-2 text-sm ${m.withdrawn ? "text-muted" : "text-text"}`}>
                <Avatar name={m.displayName} url={m.avatarUrl} withdrawn={m.withdrawn} size="sm" />
                <AuthorName author={m} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {study.permissions.canManage && <AdminActions study={study} />}
    </div>
  );
}

type AdminAction = "end" | "reopen" | "hide" | "unhide" | "role";

function AdminActions({ study }: { study: StudyDetail }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [action, setAction] = useState<AdminAction | null>(null);
  const [roleId, setRoleId] = useState(study.discordRoleId);
  const [roleError, setRoleError] = useState<string | null>(null);
  const roleInputId = useId();

  const run = useMutation({
    mutationFn: async (a: AdminAction) => {
      if (a === "role") return api.setStudyRole(study.id, roleId.trim());
      return api.setStudyStatus(study.id, a);
    },
    onSuccess: async (_, a) => {
      setAction(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.studies }),
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
      toast(
        {
          end: "스터디를 종료했습니다",
          reopen: "스터디를 재개했습니다",
          hide: "스터디를 숨겼습니다",
          unhide: "스터디 숨김을 해제했습니다",
          role: "Discord 역할을 바꿨습니다",
        }[a],
      );
    },
  });

  const open = (a: AdminAction) => {
    run.reset();
    setRoleError(null);
    setRoleId(study.discordRoleId);
    setAction(a);
  };

  const confirm = () => {
    if (!action) return;
    if (action === "role") {
      // Same rule as discordRoleIdSchema (kept zod out of the entry chunk; the server validates too).
      const trimmed = roleId.trim();
      if (!/^\d{17,20}$/.test(trimmed)) {
        setRoleError("Discord 역할 ID(17~20자리 숫자)를 입력하세요");
        return;
      }
      if (trimmed === study.discordRoleId) {
        setAction(null);
        return;
      }
    }
    run.mutate(action);
  };

  const dialog: Record<AdminAction, { title: string; label: string; danger: boolean; body: string }> = {
    end: {
      title: "스터디를 종료할까요?",
      label: "종료",
      danger: true,
      body: "종료하면 회차 생성·편집과 글 연결이 막힙니다. 지난 글과 회차는 그대로 남고, 언제든 재개할 수 있습니다.",
    },
    reopen: { title: "스터디를 재개할까요?", label: "재개", danger: false, body: "멤버가 다시 회차를 만들고 편집할 수 있습니다." },
    hide: {
      title: "스터디를 숨길까요?",
      label: "숨기기",
      danger: true,
      body: "운영자 외에는 스터디와 회차가 보이지 않습니다. 연결된 글은 지식 목록에 그대로 남습니다.",
    },
    unhide: { title: "스터디 숨김을 해제할까요?", label: "숨김 해제", danger: false, body: "모든 멤버에게 다시 보입니다." },
    role: {
      title: "Discord 역할 바꾸기",
      label: "역할 바꾸기",
      danger: false,
      body: "멤버는 새 역할을 가진 사람으로 바로 다시 계산됩니다.",
    },
  };
  const d = action ? dialog[action] : null;
  const runError = run.isError ? (roleTakenMessage(run.error) ?? errorMessage(run.error)) : null;

  return (
    <section aria-labelledby="manage" className="flex flex-col gap-3 rounded-lg border border-border p-5">
      <h2 id="manage" className="text-base font-bold">
        관리 <span className="text-xs font-normal text-muted">운영자</span>
      </h2>
      <p className="text-[13px] text-muted">
        현재 Discord 역할 ID: <code className="font-mono">{study.discordRoleId}</code>
      </p>
      <div className="flex flex-wrap gap-2">
        {study.status === "active" ? (
          <button type="button" className={btn.danger} onClick={() => open("end")}>
            스터디 종료
          </button>
        ) : (
          <button type="button" className={btn.secondary} onClick={() => open("reopen")}>
            스터디 재개
          </button>
        )}
        <button type="button" className={btn.secondary} onClick={() => open(study.hidden ? "unhide" : "hide")}>
          {study.hidden ? "숨김 해제" : "숨기기"}
        </button>
        <button type="button" className={btn.secondary} onClick={() => open("role")}>
          Discord 역할 변경
        </button>
      </div>
      <ConfirmDialog
        open={d !== null}
        title={d?.title ?? ""}
        confirmLabel={d?.label ?? ""}
        danger={d?.danger}
        pending={run.isPending}
        error={runError ? <Alert>{runError}</Alert> : undefined}
        onConfirm={confirm}
        onCancel={() => setAction(null)}
      >
        <p>{d?.body}</p>
        {action === "role" && (
          <div className="pt-2">
            <label htmlFor={roleInputId} className="mb-1 block text-[13px] font-semibold text-muted">
              새 Discord 역할 ID
            </label>
            <input
              id={roleInputId}
              className={input}
              inputMode="numeric"
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
                setRoleError(null);
              }}
              aria-invalid={Boolean(roleError)}
            />
            <p className="mt-1 text-xs text-muted">Discord 개발자 모드 → 서버 설정의 역할 우클릭 → ID 복사</p>
            {roleError && <p className="mt-1 text-sm text-danger">{roleError}</p>}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
