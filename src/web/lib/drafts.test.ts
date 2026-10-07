import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllDrafts, clearDraft, latestNewPostDraft, loadDraft, postDraftKey, saveDraft } from "./drafts";

const ME = "0190a000-0000-7000-8000-000000000001";
const OTHER = "0190a000-0000-7000-8000-000000000002";

describe("drafts (TSD 8.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the jungle5:draft:{memberId}:post:{id} key", () => {
    expect(postDraftKey(ME, "p1")).toBe(`jungle5:draft:${ME}:post:p1`);
  });

  it("saves, restores and clears a draft", () => {
    expect(saveDraft(ME, { mode: "new", postId: "p1", savedAt: 10, values: { title: "제목" } })).toBe(true);
    expect(localStorage.getItem(`jungle5:draft:${ME}:post:p1`)).not.toBeNull();
    expect(loadDraft<{ title: string }>(ME, "p1")).toMatchObject({ mode: "new", postId: "p1", values: { title: "제목" } });
    clearDraft(ME, "p1");
    expect(loadDraft(ME, "p1")).toBeNull();
  });

  it("finds the latest new-post draft and ignores edit drafts and corrupt values", () => {
    saveDraft(ME, { mode: "new", postId: "old", savedAt: 1, values: {} });
    saveDraft(ME, { mode: "new", postId: "newer", savedAt: 5, values: {} });
    saveDraft(ME, { mode: "edit", postId: "edited", savedAt: 9, values: {} });
    localStorage.setItem(`jungle5:draft:${ME}:post:broken`, "{not json");
    saveDraft(OTHER, { mode: "new", postId: "others", savedAt: 99, values: {} });
    expect(latestNewPostDraft(ME)?.postId).toBe("newer");
  });

  it("logout clears only this member's drafts by prefix", () => {
    saveDraft(ME, { mode: "new", postId: "a", savedAt: 1, values: {} });
    saveDraft(ME, { mode: "edit", postId: "b", savedAt: 1, values: {} });
    saveDraft(OTHER, { mode: "new", postId: "c", savedAt: 1, values: {} });
    localStorage.setItem("unrelated", "keep");
    clearAllDrafts(ME);
    expect(loadDraft(ME, "a")).toBeNull();
    expect(loadDraft(ME, "b")).toBeNull();
    expect(loadDraft(OTHER, "c")).not.toBeNull();
    expect(localStorage.getItem("unrelated")).toBe("keep");
  });

  it("does not crash when storage methods throw (quota, disabled)", () => {
    const boom = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "key").mockImplementation(boom);
    expect(saveDraft(ME, { mode: "new", postId: "x", savedAt: 1, values: {} })).toBe(false);
    expect(loadDraft(ME, "x")).toBeNull();
    expect(latestNewPostDraft(ME)).toBeNull();
    expect(() => clearDraft(ME, "x")).not.toThrow();
    expect(() => clearAllDrafts(ME)).not.toThrow();
  });

  it("does not crash when accessing window.localStorage itself throws", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(saveDraft(ME, { mode: "new", postId: "x", savedAt: 1, values: {} })).toBe(false);
    expect(loadDraft(ME, "x")).toBeNull();
    expect(latestNewPostDraft(ME)).toBeNull();
    expect(() => clearAllDrafts(ME)).not.toThrow();
  });
});
