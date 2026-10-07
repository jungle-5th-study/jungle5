// "Discord 역할 새로고침" (UD-15, TD-23): on /me and the study list.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorMessage } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useToast } from "./toast";
import { Alert, btn } from "./ui";

/** Message for a failed role refresh (429 RATE_LIMITED, 503 DISCORD_UNAVAILABLE). */
export function refreshRolesErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "RATE_LIMITED") {
      const s = err.retryAfterSeconds;
      return s && s > 0 ? `방금 새로고침했습니다. ${s}초 후에 다시 시도하세요.` : "방금 새로고침했습니다. 잠시 후 다시 시도하세요.";
    }
    if (err.code === "DISCORD_UNAVAILABLE") return "Discord에 연결하지 못했습니다. 잠시 후 다시 시도하세요.";
  }
  return `역할을 새로고침하지 못했습니다: ${errorMessage(err)}`;
}

export function useRefreshRoles() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: api.refreshRoles,
    onSuccess: async (updated) => {
      queryClient.setQueryData(queryKeys.me, updated);
      // Membership changes what studies, rounds and home show.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me }),
        queryClient.invalidateQueries({ queryKey: queryKeys.studies }),
        queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
      toast("Discord 역할을 새로고침했습니다");
    },
  });
}

/** Button; the error (if any) is rendered by the caller via `RefreshRolesError` so layouts stay flexible. */
export function RefreshRolesButton({ refresh }: { refresh: ReturnType<typeof useRefreshRoles> }) {
  return (
    <button type="button" className={btn.secondary} disabled={refresh.isPending} onClick={() => refresh.mutate()}>
      {refresh.isPending ? "새로고침 중…" : "Discord 역할 새로고침"}
    </button>
  );
}

export function RefreshRolesError({ refresh }: { refresh: ReturnType<typeof useRefreshRoles> }) {
  return refresh.isError ? <Alert>{refreshRolesErrorMessage(refresh.error)}</Alert> : null;
}
