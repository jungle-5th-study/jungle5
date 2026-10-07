import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { DiscordClient } from "./auth/discord";
import type { ReverifyInput } from "./auth/middleware";
import type * as schema from "./db/schema";
import type { Actor } from "./policies";

export type Db = DrizzleD1Database<typeof schema>;

export interface AppDeps {
  /** Builds the Discord client for a request. Tests inject a stub. */
  discord: (env: Env) => DiscordClient;
  /** Used for the alert webhook. Tests inject a stub. */
  fetch: typeof fetch;
  now: () => number;
}

export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    deps: AppDeps;
    requestId: string;
    actor: Actor;
    /** Facts requireSession loaded, for an explicit re-check (POST /api/me/refresh-roles). */
    reverifyInput: ReverifyInput;
    /** true when requireSession already re-verified with Discord in this request. */
    reverified: boolean;
  };
}
