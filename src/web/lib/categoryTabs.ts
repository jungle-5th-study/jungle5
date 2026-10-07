// Knowledge-list category tabs (UD-14): "전체 N" fixed first, then the six
// categories with the most posts (count desc, then name — the API order), and
// the rest behind "더 보기". A selected category outside the top six takes the
// sixth slot for as long as it is selected. Archived categories are not tabs.
import type { CategoryWithCount } from "../../shared/api";

export const VISIBLE_CATEGORY_TABS = 6;

export interface CategoryTab {
  /** null = 전체 */
  id: string | null;
  name: string;
  count: number;
}

export interface CategoryTabsModel {
  tabs: CategoryTab[];
  more: CategoryTab[];
}

const byCountThenName = (a: CategoryWithCount, b: CategoryWithCount) =>
  b.postCount - a.postCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function buildCategoryTabs(
  categories: readonly CategoryWithCount[],
  selectedId: string | null | undefined,
  totalPosts?: number,
): CategoryTabsModel {
  const total = totalPosts ?? categories.reduce((n, c) => n + c.postCount, 0);
  const active = categories.filter((c) => !c.archived).sort(byCountThenName);
  const toTab = (c: CategoryWithCount): CategoryTab => ({ id: c.id, name: c.name, count: c.postCount });

  let top = active.slice(0, VISIBLE_CATEGORY_TABS);
  let rest = active.slice(VISIBLE_CATEGORY_TABS);
  // The selected one stays visible even when it is outside the top six (or
  // archived, e.g. reached from an old post's category link).
  const selected = selectedId && !top.some((c) => c.id === selectedId) ? categories.find((c) => c.id === selectedId) : undefined;
  if (selected) {
    rest = rest.filter((c) => c.id !== selected.id);
    if (top.length >= VISIBLE_CATEGORY_TABS) {
      rest = [top[top.length - 1]!, ...rest].sort(byCountThenName);
      top = top.slice(0, -1);
    }
    top = [...top, selected];
  }

  return {
    tabs: [{ id: null, name: "전체", count: total }, ...top.map(toTab)],
    more: rest.map(toTab),
  };
}
