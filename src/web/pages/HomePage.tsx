import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { PostRow } from "../components/PostRow";
import { btn, EmptyState, ErrorState, pageTitle, sectionTitle, SkeletonList, useNow } from "../components/ui";
import { api, queryKeys } from "../lib/endpoints";
import { formatWeekRange } from "../lib/format";
import { kstTime, kstWeekdayLong, kstWeekdayTime } from "../lib/kst";
import { useSession } from "../lib/session";
import type { NextMeeting } from "../../shared/api";

const RECENT_COUNT = 5;

/** Home (UD-08): "이번 주" — this week's meetings, then recent knowledge. */
export function HomePage() {
  const me = useSession();
  const now = useNow();
  const home = useQuery({ queryKey: queryKeys.home, queryFn: api.home });
  const hasStudies = me.studies.some((s) => s.status === "active");

  const meetings = (
    <section aria-labelledby="meetings" className="flex flex-col">
      <h2 id="meetings" className="sr-only">
        이번 주 모임
      </h2>
      {home.isPending ? (
        <SkeletonList rows={2} excerpt={false} />
      ) : home.isError ? null : home.data.nextMeetings.length === 0 ? (
        <EmptyState
          action={
            <Link to="/studies" className={btn.link}>
              {hasStudies ? "내 스터디 보기" : "스터디 둘러보기"}
            </Link>
          }
        >
          {hasStudies ? "이번 주 예정된 모임이 없습니다." : "참여 중인 스터디가 없습니다. 스터디 모임은 여기에 표시됩니다."}
        </EmptyState>
      ) : (
        <ul className="border-t border-border">
          {home.data.nextMeetings.map((m) => (
            <li key={m.roundId}>
              <MeetingRow meeting={m} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const recent = (
    <section aria-labelledby="recent-posts" className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="recent-posts" className={sectionTitle}>
          최근 지식
        </h2>
        <Link to="/posts" className={btn.link}>
          전체 보기
        </Link>
      </div>
      {home.isPending ? (
        <SkeletonList rows={3} excerpt={false} />
      ) : home.isError ? (
        <ErrorState what="최근 지식을 불러오지 못했습니다." error={home.error} onRetry={() => void home.refetch()} />
      ) : home.data.recentPosts.length === 0 ? (
        <EmptyState
          action={
            <Link to="/posts/new" className={btn.link}>
              첫 글을 써 보세요
            </Link>
          }
        >
          아직 공유된 글이 없습니다.
        </EmptyState>
      ) : (
        <div className="border-t border-border">
          {home.data.recentPosts.slice(0, RECENT_COUNT).map((p) => (
            <PostRow key={p.id} post={p} showExcerpt={false} compact />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className={pageTitle}>이번 주</h1>
          <span className="text-sm text-muted">{formatWeekRange(now)}</span>
        </div>
        {/* No studies: recent knowledge first (UD-08). */}
        {hasStudies ? meetings : recent}
      </div>
      {hasStudies ? recent : meetings}
    </div>
  );
}

/** A meeting row (Main mockup): weekday + time on the left; study · round · place, title, linked posts. */
function MeetingRow({ meeting: m }: { meeting: NextMeeting }) {
  const where = [m.studyName, `${m.seq}회차`, m.location].filter(Boolean).join(" · ");
  return (
    <Link to={`/rounds/${m.roundId}`} className="group flex gap-6 border-b border-border py-[18px] text-text">
      <div className="hidden w-24 shrink-0 flex-col sm:flex">
        <span className="text-[13px] text-muted">{kstWeekdayLong(m.meetingAt)}</span>
        <span className="text-xl font-bold tabular-nums">{kstTime(m.meetingAt)}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] break-words text-muted">
          <span className="sm:hidden">{kstWeekdayTime(m.meetingAt)} · </span>
          {where}
          {m.roundStatus === "ended" ? " · 종료" : ""}
        </span>
        <span className="text-[17px] font-semibold break-words group-hover:underline">{m.title}</span>
        <span className="text-sm text-muted">연결된 글 {m.linkedPostCount}</span>
      </div>
    </Link>
  );
}
