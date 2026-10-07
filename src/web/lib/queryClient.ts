import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Retry transient failures only; 4xx answers will not change on retry.
        retry: (count, err) => {
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) return false;
          return count < 2;
        },
      },
      // Mutations are never retried automatically; the user retries explicitly
      // (creates are idempotent by client id anyway, TD-13).
      mutations: { retry: false },
    },
  });
}
