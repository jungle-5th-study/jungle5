import { describe, expect, it } from "vitest";
import type { CategoryWithCount } from "../../shared/api";
import { buildCategoryTabs } from "./categoryTabs";

let n = 0;
const cat = (name: string, postCount: number, archived = false): CategoryWithCount => ({
  id: `c-${name}-${n++}`,
  name,
  postCount,
  archived,
  createdAt: 1,
});

// API order: post count desc, then name asc (UD-14).
const list = [
  cat("프론트엔드", 23),
  cat("백엔드", 18),
  cat("AI", 12),
  cat("인프라", 9),
  cat("데이터베이스", 7),
  cat("옛 카테고리", 6, true),
  cat("알고리즘", 5),
  cat("네트워크", 4),
  cat("운영체제", 4),
  cat("보안", 1),
];
const names = (tabs: { name: string }[]) => tabs.map((t) => t.name);

describe("buildCategoryTabs (UD-14)", () => {
  it('puts "전체" first with the total, then the top 6 by count, archived excluded', () => {
    const { tabs, more } = buildCategoryTabs(list, null, 89);
    expect(tabs[0]).toEqual({ id: null, name: "전체", count: 89 });
    expect(names(tabs.slice(1))).toEqual(["프론트엔드", "백엔드", "AI", "인프라", "데이터베이스", "알고리즘"]);
    expect(tabs.slice(1).map((t) => t.count)).toEqual([23, 18, 12, 9, 7, 5]);
    expect(names(more)).toEqual(["네트워크", "운영체제", "보안"]);
    expect(names([...tabs, ...more])).not.toContain("옛 카테고리");
  });

  it("sums post counts for 전체 when no total is given", () => {
    expect(buildCategoryTabs(list, null).tabs[0]!.count).toBe(89);
  });

  it("orders ties by name and re-sorts unsorted input", () => {
    const shuffled = [cat("나", 2), cat("가", 2), cat("다", 9)];
    expect(names(buildCategoryTabs(shuffled, null).tabs.slice(1))).toEqual(["다", "가", "나"]);
  });

  it("keeps the order when a top-6 category is selected", () => {
    const sel = list[2]!; // AI
    const { tabs, more } = buildCategoryTabs(list, sel.id);
    expect(names(tabs.slice(1))).toEqual(["프론트엔드", "백엔드", "AI", "인프라", "데이터베이스", "알고리즘"]);
    expect(more).toHaveLength(3);
  });

  it("swaps a selected category outside the top 6 into slot 6", () => {
    const sel = list[8]!; // 운영체제
    const { tabs, more } = buildCategoryTabs(list, sel.id);
    expect(tabs).toHaveLength(7);
    expect(names(tabs.slice(1))).toEqual(["프론트엔드", "백엔드", "AI", "인프라", "데이터베이스", "운영체제"]);
    // The displaced 6th goes back to the "more" list in count order.
    expect(names(more)).toEqual(["알고리즘", "네트워크", "보안"]);
  });

  it("shows a selected archived category in slot 6 without listing it elsewhere", () => {
    const sel = list[5]!; // 옛 카테고리 (archived)
    const { tabs, more } = buildCategoryTabs(list, sel.id);
    expect(tabs[6]!.name).toBe("옛 카테고리");
    expect(names(more)).toEqual(["알고리즘", "네트워크", "운영체제", "보안"]);
  });

  it("handles fewer than 6 categories and no categories", () => {
    expect(names(buildCategoryTabs(list.slice(0, 2), null).tabs)).toEqual(["전체", "프론트엔드", "백엔드"]);
    expect(buildCategoryTabs([], null)).toEqual({ tabs: [{ id: null, name: "전체", count: 0 }], more: [] });
  });

  it("ignores an unknown selected id", () => {
    const { tabs, more } = buildCategoryTabs(list, "nope");
    expect(tabs).toHaveLength(7);
    expect(more).toHaveLength(3);
  });
});
