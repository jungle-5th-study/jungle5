// Study list (docs/ui.md 5, UD-15): my studies → studies I can join → ended ones.
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Link } from "react-router";
import type { StudyListItem } from "../../shared/api";
import { Markdown } from "../components/Markdown";
import { RefreshRolesButton, RefreshRolesError, useRefreshRoles } from "../components/RefreshRolesButton";
import { ChevronDownIcon, PlusIcon } from "../components/icons";
import { btn, EmptyState, ErrorState, pageTitle, sectionTitle, SkeletonList, useNow } from "../components/ui";
import { api, queryKeys } from "../lib/endpoints";
import { formatMeeting, kstWeekdayTime } from "../lib/kst";
import { useSession } from "../lib/session";

/** "목 21:00" within the coming week, otherwise "10월 20일 (화) 21:00". */
export function shortMeeting(ms: number, now: number): string {
  return ms - now < 6 * 24 * 60 * 60_000 ? kstWeekdayTime(ms) : formatMeeting(ms, now);
}

export function groupStudies(items: StudyListItem[]) {
  return {
    mine: items.filter((s) => s.status === "active" && s.isMember),
    joinable: items.filter((s) => s.status === "active" && !s.isMember),
    ended: items.filter((s) => s.status === "ended"),
  };
}

function studyMeta(s: StudyListItem): string {
  const parts = [`멤버 ${s.memberCount}`];
  if (s.latestRound) parts.push(`${s.latestRound.seq}회차 ${s.latestRound.status === "active" ? "진행 중" : "종료"}`);
  else parts.push("아직 회차 없음");
  if (s.cadence) parts.push(s.cadence);
  return parts.join(" · ");
}

function HiddenStudyBadge() {
  return <span className="ml-2 rounded border border-border px-1.5 py-0.5 align-[2px] text-xs font-medium text-muted">숨김</span>;
}

export function StudiesPage() {
  const me = useSession();
  const now = useNow();
  const refresh = useRefreshRoles();
  const studies = useQuery({ queryKey: queryKeys.studyList, queryFn: api.studies });
  const [showEnded, setShowEnded] = useState(false);
  const endedId = useId();

  const groups = studies.data ? groupStudies(studies.data) : null;

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className={pageTitle}>스터디</h1>
          <div className="flex flex-wrap gap-2">
            <RefreshRolesButton refresh={refresh} />
            {me.isAdmin && (
              <Link to="/studies/new" className={btn.primary}>
                <PlusIcon />
                스터디 만들기
              </Link>
            )}
          </div>
        </div>
        <RefreshRolesError refresh={refresh} />
      </div>

      {studies.isPending ? (
        <SkeletonList rows={3} />
      ) : studies.isError ? (
        <ErrorState what="스터디 목록을 불러오지 못했습니다." error={studies.error} onRetry={() => void studies.refetch()} />
      ) : studies.data.length === 0 ? (
        <EmptyState
          action={
            me.isAdmin ? (
              <Link to="/studies/new" className={btn.link}>
                첫 스터디를 만들어 보세요
              </Link>
            ) : undefined
          }
        >
          아직 스터디가 없습니다.
        </EmptyState>
      ) : (
        groups && (
          <>
            <section aria-labelledby="my-studies" className="flex flex-col">
              <h2 id="my-studies" className={`${sectionTitle} mb-2`}>
                내 스터디
              </h2>
              {groups.mine.length === 0 ? (
                <p className="border-t border-border py-4 text-sm text-muted">
                  참여 중인 스터디가 없습니다. Discord에서 스터디 역할을 받은 뒤 &ldquo;Discord 역할 새로고침&rdquo;을 누르세요.
                </p>
              ) : (
                <ul className="border-t border-border">
                  {groups.mine.map((s) => (
                    <li key={s.id}>
                      <MyStudyRow study={s} now={now} />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {groups.joinable.length > 0 && (
              <section aria-labelledby="joinable-studies" className="flex flex-col">
                <h2 id="joinable-studies" className={`${sectionTitle} mb-2`}>
                  참여할 수 있는 스터디
                </h2>
                <ul className="border-t border-border">
                  {groups.joinable.map((s) => (
                    <li key={s.id}>
                      <JoinableStudyRow study={s} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {groups.ended.length > 0 && (
              <section aria-label="종료된 스터디" className="flex flex-col gap-2">
                <button
                  type="button"
                  className={`${btn.link} inline-flex items-center gap-1 self-start`}
                  aria-expanded={showEnded}
                  aria-controls={endedId}
                  onClick={() => setShowEnded((v) => !v)}
                >
                  {showEnded ? "종료된 스터디 접기" : `종료된 스터디 ${groups.ended.length}개 보기`}
                  <span className={showEnded ? "rotate-180" : ""}>
                    <ChevronDownIcon />
                  </span>
                </button>
                {showEnded && (
                  <ul id={endedId} className="border-t border-border">
                    {groups.ended.map((s) => (
                      <li key={s.id} className="border-b border-border py-4">
                        <Link to={`/studies/${s.id}`} className="font-semibold text-text hover:underline">
                          {s.name}
                        </Link>
                        {s.hidden && <HiddenStudyBadge />}
                        <p className="text-[13px] text-muted">
                          종료 · {studyMeta(s)}
                          {s.isMember ? " · 참여했던 스터디" : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )
      )}
    </div>
  );
}

function MyStudyRow({ study: s, now }: { study: StudyListItem; now: number }) {
  return (
    <Link
      to={`/studies/${s.id}`}
      className="group flex items-center gap-4 border-b border-border py-[18px] text-text"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[17px] font-semibold group-hover:underline">
          {s.name}
          {s.hidden && <HiddenStudyBadge />}
        </span>
        <span className="line-clamp-2 text-sm text-muted">{s.goal}</span>
        <span className="text-[13px] text-muted">{studyMeta(s)}</span>
      </div>
      <div className="flex shrink-0 flex-col items-end text-right">
        <span className="text-xs text-muted">다음 모임</span>
        <span className="text-[15px] font-bold">{s.nextMeeting?.meetingAt ? shortMeeting(s.nextMeeting.meetingAt, now) : "미정"}</span>
      </div>
    </Link>
  );
}

function JoinableStudyRow({ study: s }: { study: StudyListItem }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col border-b border-border py-[18px]">
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span>
            <Link to={`/studies/${s.id}`} className="text-[17px] font-semibold text-text hover:underline">
              {s.name}
            </Link>
            {s.hidden && <HiddenStudyBadge />}
          </span>
          <span className="line-clamp-2 text-sm text-muted">{s.goal}</span>
          <span className="text-[13px] text-muted">{studyMeta(s)}</span>
        </div>
        <button
          type="button"
          className={`${btn.secondary} shrink-0`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
        >
          참여 방법
          <span className={open ? "rotate-180" : ""}>
            <ChevronDownIcon />
          </span>
        </button>
      </div>
      {open && <JoinGuide id={panelId} studyId={s.id} />}
    </div>
  );
}

/** The join guide lives on the study detail; fetched when the panel opens. */
function JoinGuide({ id, studyId }: { id: string; studyId: string }) {
  const study = useQuery({ queryKey: queryKeys.study(studyId), queryFn: () => api.study(studyId) });
  return (
    <div id={id} role="region" aria-label="참여 방법" className="mt-3 flex flex-col gap-2 rounded-lg bg-surface p-4 text-sm">
      {study.isPending ? (
        <p className="text-muted">불러오는 중…</p>
      ) : study.isError ? (
        <ErrorState what="참여 안내를 불러오지 못했습니다." error={study.error} onRetry={() => void study.refetch()} />
      ) : study.data.joinGuide?.trim() ? (
        <Markdown source={study.data.joinGuide} />
      ) : (
        <p className="text-muted">참여 안내가 아직 없습니다. 운영진에게 문의하세요.</p>
      )}
      <p className="text-[13px] text-muted">
        역할을 받은 뒤 &ldquo;Discord 역할 새로고침&rdquo;을 누르면 바로 내 스터디에 들어옵니다.
      </p>
    </div>
  );
}
