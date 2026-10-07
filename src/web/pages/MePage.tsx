import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import { RefreshRolesButton, RefreshRolesError, useRefreshRoles } from "../components/RefreshRolesButton";
import { useState } from "react";
import { ThemeSetting } from "../components/ThemeToggle";
import { Alert, Avatar, btn, ConfirmDialog, pageTitle, sectionTitle } from "../components/ui";
import { errorMessage } from "../lib/api";
import { api } from "../lib/endpoints";
import { WITHDRAWN_NAME } from "../lib/format";
import { useSession } from "../lib/session";
import { useLeave, useLogout } from "../lib/useLeave";

export function MePage() {
  const me = useSession();
  const leave = useLeave(me.id);
  const logout = useLogout(me.id);

  const refresh = useRefreshRoles();

  const [acknowledged, setAcknowledged] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const withdraw = useMutation({ mutationFn: api.withdraw, onSuccess: () => leave("withdrawn") });

  const activeStudies = me.studies.filter((s) => s.status === "active");

  return (
    <div className="flex flex-col gap-10">
      <h1 className={pageTitle}>내 정보</h1>

      <section aria-labelledby="profile" className="flex flex-col gap-4">
        <h2 id="profile" className="sr-only">
          프로필
        </h2>
        <div className="flex items-center gap-4">
          <Avatar name={me.displayName} url={me.avatarUrl} size="lg" />
          <div>
            <p className="text-lg font-bold">{me.displayName ?? "(이름 없음)"}</p>
            <p className="text-sm text-muted">{me.isAdmin ? "운영자" : "커뮤니티 멤버"}</p>
          </div>
        </div>
        <p className="text-[13px] text-muted">
          이름과 아바타는 Discord 서버 프로필에서 가져오며 하루 한 번 자동으로 갱신됩니다.
        </p>
      </section>

      <section aria-labelledby="studies" className="flex flex-col gap-3 border-t border-border pt-8">
        <h2 id="studies" className={sectionTitle}>
          내 스터디
        </h2>
        {activeStudies.length === 0 ? (
          <p className="text-sm text-muted">참여 중인 스터디가 없습니다.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {activeStudies.map((s) => (
              <li key={s.id}>
                <Link
                  to={`/studies/${s.id}`}
                  className="inline-flex h-8 items-center gap-2 rounded bg-accent-subtle px-2.5 text-sm font-medium text-accent-subtle-text hover:underline"
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-accent" />
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[13px] text-muted">
          스터디 참여는 Discord 서버의 역할로 정해집니다. 역할을 받았는데 보이지 않으면 새로고침하세요.
        </p>
        <div>
          <RefreshRolesButton refresh={refresh} />
        </div>
        <RefreshRolesError refresh={refresh} />
      </section>

      <section aria-labelledby="theme" className="flex flex-col gap-3 border-t border-border pt-8">
        <h2 id="theme" className={sectionTitle}>
          테마
        </h2>
        <ThemeSetting />
        <p className="text-[13px] text-muted">이 브라우저에만 저장됩니다.</p>
      </section>

      <section aria-labelledby="session" className="flex flex-col gap-3 border-t border-border pt-8">
        <h2 id="session" className={sectionTitle}>
          로그아웃
        </h2>
        <p className="text-[13px] text-muted">로그아웃하면 이 브라우저에 임시저장된 글도 함께 지워집니다.</p>
        <div>
          <button type="button" className={btn.secondary} disabled={logout.isPending} onClick={() => logout.mutate()}>
            {logout.isPending ? "로그아웃 중…" : "로그아웃"}
          </button>
        </div>
        {logout.isError && <Alert>로그아웃하지 못했습니다: {errorMessage(logout.error)}</Alert>}
      </section>

      <section aria-labelledby="withdraw" className="flex flex-col gap-3 rounded-lg border border-danger p-5">
        <h2 id="withdraw" className="text-lg font-bold text-danger">
          탈퇴
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-text">
          <li>
            탈퇴하면 닉네임·아바타와 Discord 계정 연결이 지워지고, 남긴 글·댓글은 그대로 남아 &ldquo;{WITHDRAWN_NAME}&rdquo;로
            표시됩니다.
          </li>
          <li>
            <strong>글이나 댓글을 지우려면 탈퇴 전에 직접 삭제하세요.</strong> 탈퇴 후에는 지울 수 없습니다.
          </li>
          <li>같은 Discord 계정으로 다시 로그인하면 새 프로필이 만들어지며, 이전 글과 연결되지 않습니다.</li>
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          위 내용을 확인했습니다.
        </label>
        <div>
          <button
            type="button"
            className={btn.danger}
            disabled={!acknowledged}
            onClick={() => {
              withdraw.reset();
              setConfirming(true);
            }}
          >
            탈퇴하기
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirming}
        title="정말 탈퇴할까요?"
        confirmLabel="탈퇴"
        danger
        pending={withdraw.isPending}
        error={withdraw.isError ? <Alert>탈퇴하지 못했습니다: {errorMessage(withdraw.error)}</Alert> : undefined}
        onConfirm={() => withdraw.mutate()}
        onCancel={() => setConfirming(false)}
      >
        <p>탈퇴는 되돌릴 수 없습니다. 남긴 글과 댓글은 &ldquo;{WITHDRAWN_NAME}&rdquo;로 표시됩니다.</p>
      </ConfirmDialog>
    </div>
  );
}
