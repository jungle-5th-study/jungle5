import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { clearAllDrafts } from "./drafts";
import { api } from "./endpoints";

/** After logout or withdrawal: local drafts and cached data of this member are removed. */
export function useLeave(memberId: string) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return async (info: "logged_out" | "withdrawn") => {
    clearAllDrafts(memberId);
    await navigate(`/login?info=${info}`, { replace: true });
    queryClient.clear();
  };
}

export function useLogout(memberId: string) {
  const leave = useLeave(memberId);
  return useMutation({ mutationFn: api.logout, onSuccess: () => leave("logged_out") });
}
