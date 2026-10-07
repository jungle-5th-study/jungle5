import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useId, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { LIMITS } from "../../shared/constants";
import { CategoryTabs } from "../components/CategoryTabs";
import { PostRow } from "../components/PostRow";
import { btn, EmptyState, ErrorState, FilterChip, pageTitle, Skeleton, SkeletonList, Spinner } from "../components/ui";
import { buildCategoryTabs } from "../lib/categoryTabs";
import { api, queryKeys, type PostFilters } from "../lib/endpoints";

/** Knowledge list (docs/ui.md 5): tabs (UD-14) → filter chips → rows → "더 보기". */
export function PostListPage() {
  const [params, setParams] = useSearchParams();
  const filters: PostFilters = {
    q: params.get("q") || undefined,
    category: params.get("category") || undefined,
    tag: params.get("tag") || undefined,
  };

  const hrefWith = (key: string, value: string | undefined | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    return `/posts${qs ? `?${qs}` : ""}`;
  };
  const setParam = (key: string, value: string | undefined) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: api.categories });
  const list = useInfiniteQuery({
    queryKey: queryKeys.postList(filters),
    queryFn: ({ pageParam, signal }) => api.posts(filters, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const selectedCategory = categories.data?.find((c) => c.id === filters.category);
  const tabs = categories.data ? buildCategoryTabs(categories.data, filters.category ?? null) : null;
  const searching = Boolean(filters.q || filters.tag);

  // "프론트엔드 · '훅' 검색 결과 3건"
  const summaryParts: string[] = [];
  if (selectedCategory) summaryParts.push(selectedCategory.name);
  if (filters.tag) summaryParts.push(`#${filters.tag}`);
  let countText: string | null = null;
  if (searching) {
    if (list.isSuccess) countText = `${filters.q ? `'${filters.q}' ` : ""}검색 결과 ${items.length}건${list.hasNextPage ? " 이상" : ""}`;
  } else if (tabs) {
    countText = `글 ${selectedCategory ? selectedCategory.postCount : tabs.tabs[0]!.count}개`;
  }
  if (countText) summaryParts.push(countText);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className={pageTitle}>지식</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {summaryParts.join(" · ")}
        </p>
      </div>

      {categories.isPending ? (
        <div className="flex h-11 items-center gap-4 border-b border-border lg:h-10" aria-hidden>
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ) : categories.isError ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-danger">
          카테고리를 불러오지 못했습니다.
          <button type="button" className={btn.ghost} onClick={() => void categories.refetch()}>
            다시 시도
          </button>
        </p>
      ) : (
        tabs && (
          <CategoryTabs
            model={tabs}
            selectedId={filters.category ?? null}
            hrefFor={(id) => hrefWith("category", id)}
            onSelect={(id) => setParam("category", id)}
          />
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filters.q && (
          <FilterChip label={`'${filters.q}'`} removeLabel={`검색어 ${filters.q} 해제`} onRemove={() => setParam("q", undefined)} />
        )}
        {filters.tag ? (
          <FilterChip label={`#${filters.tag}`} removeLabel={`태그 ${filters.tag} 필터 해제`} onRemove={() => setParam("tag", undefined)} />
        ) : (
          <AddTagFilter onAdd={(tag) => setParam("tag", tag)} />
        )}
      </div>

      <section aria-label="글 목록" aria-busy={list.isFetching}>
        {list.isPending ? (
          <SkeletonList rows={3} />
        ) : list.isError ? (
          <ErrorState what="글 목록을 불러오지 못했습니다." error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          searching || filters.category ? (
            <EmptyState
              action={
                <Link to="/posts" className={btn.link}>
                  조건 없이 전체 보기
                </Link>
              }
            >
              조건에 맞는 글이 없습니다.
            </EmptyState>
          ) : (
            <EmptyState
              action={
                <Link to="/posts/new" className={btn.link}>
                  첫 글을 써 보세요
                </Link>
              }
            >
              아직 공유된 글이 없습니다.
            </EmptyState>
          )
        ) : (
          <div className="border-t border-border">
            {items.map((p) => (
              <PostRow key={p.id} post={p} showCategory={!filters.category} />
            ))}
          </div>
        )}
        {list.hasNextPage && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              className={btn.secondary}
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage ? <Spinner label="불러오는 중" /> : "더 보기"}
            </button>
          </div>
        )}
        {list.isFetchNextPageError && (
          <p role="alert" className="mt-2 text-center text-sm text-danger">
            다음 글을 불러오지 못했습니다. 다시 시도하세요.
          </p>
        )}
      </section>
    </div>
  );
}

/** "+ 태그": opens a small input; Enter applies the tag filter. */
function AddTagFilter({ onAdd }: { onAdd: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-[34px] items-center rounded-lg border border-dashed border-border px-3 text-sm text-muted hover:text-text"
        onClick={() => setOpen(true)}
      >
        + 태그
      </button>
    );
  }

  const close = () => {
    setOpen(false);
    setValue("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const tag = value.trim().replace(/^#/, "").slice(0, LIMITS.tagNameMax);
    if (tag) onAdd(tag);
    close();
  };

  return (
    <form onSubmit={onSubmit} className="inline-flex items-center gap-1">
      <label htmlFor={id} className="sr-only">
        태그로 거르기
      </label>
      <input
        id={id}
        autoFocus
        className="h-[34px] w-40 rounded-lg border border-border bg-surface px-3 text-base text-text sm:text-sm"
        placeholder="태그 입력 후 Enter"
        value={value}
        maxLength={LIMITS.tagNameMax + 1}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        onBlur={() => {
          if (!value.trim()) close();
        }}
      />
    </form>
  );
}
