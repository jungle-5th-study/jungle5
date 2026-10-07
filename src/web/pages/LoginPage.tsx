import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ApiError, errorMessage, request } from "../lib/api";
import { Alert, btn, input } from "../components/ui";

/** Reasons set by /auth/callback (`?error=`) and by the SPA's 401 handler. */
const ERROR_MESSAGES: Record<string, string> = {
  not_member: "커뮤니티 Discord 서버 멤버만 이용할 수 있습니다.",
  access_denied: "Discord 로그인이 취소되었습니다.",
  invalid_state: "로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도하세요.",
  invalid_request: "로그인 요청이 올바르지 않습니다. 다시 시도하세요.",
  discord_error: "Discord와 통신하지 못했습니다. 잠시 후 다시 시도하세요.",
  session: "로그인이 필요합니다. 다시 로그인하세요.",
};

const INFO_MESSAGES: Record<string, string> = {
  logged_out: "로그아웃했습니다.",
  withdrawn: "탈퇴가 완료되었습니다. 남긴 글과 댓글은 “탈퇴한 멤버”로 표시됩니다.",
};

export function LoginPage() {
  const [params] = useSearchParams();
  const error = params.get("error");
  const info = params.get("info");
  const errorText = error ? (ERROR_MESSAGES[error] ?? "로그인하지 못했습니다. 다시 시도하세요.") : null;
  const infoText = info ? INFO_MESSAGES[info] : undefined;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-10 text-text">
      <main className="w-full max-w-sm space-y-6 rounded-xl border border-border bg-bg p-6 sm:p-8">
        <div className="text-center">
          <h1 className="text-[32px] font-bold tracking-[-0.02em]">
            정글
            <span aria-hidden className="wordmark-dot" />5
          </h1>
          <p className="mt-1 text-sm text-muted">커뮤니티 멤버 전용 지식 공유 공간</p>
        </div>
        {errorText && <Alert>{errorText}</Alert>}
        {infoText && <Alert kind="success">{infoText}</Alert>}
        <a
          href="/auth/login"
          className={`${btn.primary.replace("text-sm", "text-base")} min-h-12 w-full`}
        >
          Discord로 로그인
        </a>
        <p className="text-center text-xs text-muted">
          커뮤니티 Discord 서버 멤버만 이용할 수 있습니다. 로그인하면 Discord 닉네임과 아바타가 사용됩니다.
        </p>
        {import.meta.env.DEV && <DevTestLogin />}
      </main>
    </div>
  );
}

/**
 * Local development only (never in a production build): POST /auth/test-login,
 * which the Worker registers only when ENV=test (.dev.vars).
 */
function DevTestLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [discordUserId, setDiscordUserId] = useState("1001");
  const [displayName, setDisplayName] = useState("tester");
  const [isAdmin, setIsAdmin] = useState(false);
  const login = useMutation({
    mutationFn: () =>
      request<{ memberId: string }>("/auth/test-login", {
        method: "POST",
        body: { discordUserId, displayName: displayName || undefined, isAdmin },
      }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/", { replace: true });
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate();
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <p className="text-sm font-semibold">테스트 로그인 (개발 모드 전용)</p>
      <label className="block text-sm">
        Discord 사용자 ID
        <input className={input} value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value)} required />
      </label>
      <label className="block text-sm">
        표시 이름
        <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
        운영자로 로그인
      </label>
      {login.isError && (
        <Alert>
          {errorMessage(login.error)}
          {login.error instanceof ApiError && login.error.status === 404 && (
            <> — .dev.vars에 ENV=test가 설정되어 있는지 확인하세요.</>
          )}
        </Alert>
      )}
      <button type="submit" className={`${btn.secondary} w-full`} disabled={login.isPending}>
        {login.isPending ? "로그인 중…" : "테스트 로그인"}
      </button>
    </form>
  );
}
