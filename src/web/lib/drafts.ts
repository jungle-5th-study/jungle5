// Browser-only drafts (PRD F-10, TSD 8.1). Every localStorage access is
// wrapped: storage can be disabled, full, or throw on access (private mode).
import { draftKeyPrefix } from "../../shared/constants";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const postDraftKey = (memberId: string, postId: string) => `${draftKeyPrefix(memberId)}post:${postId}`;

export interface StoredDraft<T> {
  v: 1;
  /** "new": the post id is the client-generated create id; "edit": an existing post. */
  mode: "new" | "edit";
  postId: string;
  savedAt: number;
  values: T;
}

/** Returns false when the draft could not be stored (quota, disabled storage). */
export function saveDraft<T>(memberId: string, draft: Omit<StoredDraft<T>, "v">): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(postDraftKey(memberId, draft.postId), JSON.stringify({ v: 1, ...draft }));
    return true;
  } catch {
    return false;
  }
}

function parseDraft<T>(raw: string | null): StoredDraft<T> | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<StoredDraft<T>> | null;
    if (!d || d.v !== 1 || (d.mode !== "new" && d.mode !== "edit") || typeof d.postId !== "string") return null;
    if (typeof d.savedAt !== "number" || typeof d.values !== "object" || d.values === null) return null;
    return d as StoredDraft<T>;
  } catch {
    return null;
  }
}

export function loadDraft<T>(memberId: string, postId: string): StoredDraft<T> | null {
  try {
    return parseDraft<T>(storage()?.getItem(postDraftKey(memberId, postId)) ?? null);
  } catch {
    return null;
  }
}

/** The most recently saved draft of a not-yet-created post, if any. */
export function latestNewPostDraft<T>(memberId: string): StoredDraft<T> | null {
  try {
    const s = storage();
    if (!s) return null;
    const prefix = `${draftKeyPrefix(memberId)}post:`;
    let latest: StoredDraft<T> | null = null;
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(prefix)) continue;
      const d = parseDraft<T>(s.getItem(key));
      if (d?.mode === "new" && (!latest || d.savedAt > latest.savedAt)) latest = d;
    }
    return latest;
  } catch {
    return null;
  }
}

export function clearDraft(memberId: string, postId: string): void {
  try {
    storage()?.removeItem(postDraftKey(memberId, postId));
  } catch {
    // ignore
  }
}

/** Logout / withdrawal: remove every `jungle5:draft:{memberId}:` key (TSD 8.1 step 4). */
export function clearAllDrafts(memberId: string): void {
  try {
    const s = storage();
    if (!s) return;
    const prefix = draftKeyPrefix(memberId);
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) s.removeItem(key);
  } catch {
    // ignore
  }
}

// ---- generic keyed drafts (round notes, …) --------------------------------

export interface KeyedDraft<T> {
  v: 1;
  savedAt: number;
  /** The server version the draft was based on (TD-14). */
  baseVersion: number;
  values: T;
}

/** `jungle5:draft:{memberId}:{kind}:{id}`, so logout clears it with the post drafts. */
export const keyedDraftKey = (memberId: string, kind: string, id: string) => `${draftKeyPrefix(memberId)}${kind}:${id}`;

export function saveKeyedDraft<T>(memberId: string, kind: string, id: string, draft: Omit<KeyedDraft<T>, "v">): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(keyedDraftKey(memberId, kind, id), JSON.stringify({ v: 1, ...draft }));
    return true;
  } catch {
    return false;
  }
}

export function loadKeyedDraft<T>(memberId: string, kind: string, id: string): KeyedDraft<T> | null {
  try {
    const raw = storage()?.getItem(keyedDraftKey(memberId, kind, id));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<KeyedDraft<T>> | null;
    if (!d || d.v !== 1 || typeof d.savedAt !== "number" || typeof d.baseVersion !== "number") return null;
    if (typeof d.values !== "object" || d.values === null) return null;
    return d as KeyedDraft<T>;
  } catch {
    return null;
  }
}

export function clearKeyedDraft(memberId: string, kind: string, id: string): void {
  try {
    storage()?.removeItem(keyedDraftKey(memberId, kind, id));
  } catch {
    // ignore
  }
}
