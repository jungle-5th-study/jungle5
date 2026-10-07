// Category management for admins (PRD F-02, D-17): rename, archive/unarchive.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import type { CategoryWithCount } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import { Alert, btn, EmptyState, ErrorState, input, pageTitle, SkeletonList } from "../components/ui";
import { ApiError, errorMessage, fieldError } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useSession } from "../lib/session";

export function AdminCategoriesPage() {
  const me = useSession();
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: api.categories, enabled: me.isAdmin });

  if (!me.isAdmin) return <Alert>운영자만 이용할 수 있는 화면입니다.</Alert>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className={pageTitle}>카테고리 관리</h1>
        <p className="text-sm text-muted">
          이름을 바꿔도 기존 글의 분류는 유지됩니다. 보관한 카테고리는 기존 글에 남지만 새 글에서 선택할 수 없습니다.
        </p>
      </div>
      {categories.isPending ? (
        <SkeletonList rows={3} excerpt={false} />
      ) : categories.isError ? (
        <ErrorState what="카테고리를 불러오지 못했습니다." error={categories.error} onRetry={() => void categories.refetch()} />
      ) : categories.data.length === 0 ? (
        <EmptyState>카테고리가 없습니다. 글을 쓸 때 새 카테고리를 만들 수 있습니다.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[13px] text-muted">
                <th scope="col" className="py-2 pr-3 font-semibold">
                  이름
                </th>
                <th scope="col" className="w-16 px-3 py-2 text-right font-semibold">
                  글 수
                </th>
                <th scope="col" className="w-20 px-3 py-2 font-semibold">
                  상태
                </th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold">
                  <span className="sr-only">동작</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.data.map((c) => (
                <CategoryRow key={c.id} category={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CategoryRow({ category }: { category: CategoryWithCount }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const inputId = useId();
  const formId = useId();

  const patch = useMutation({
    mutationFn: (input: { name?: string; archived?: boolean }) => api.patchCategory(category.id, input),
    onSuccess: async (updated) => {
      queryClient.setQueryData<CategoryWithCount[]>(queryKeys.categories, (list) =>
        list?.map((c) => (c.id === updated.id ? { ...updated, postCount: c.postCount } : c)),
      );
      setEditing(false);
      // Post lists/details show category names.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
        queryClient.invalidateQueries({ queryKey: queryKeys.posts }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ]);
    },
  });

  const onRename = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || patch.isPending) return;
    if (name.trim() === category.name) {
      setEditing(false);
      return;
    }
    patch.mutate({ name });
  };

  const err = patch.error;
  const message =
    err instanceof ApiError && err.code === "DUPLICATE"
      ? `같은 이름의 카테고리${isNamed(err.existing) ? ` "${err.existing.name}"` : ""}가 이미 있습니다.`
      : err instanceof ApiError
        ? (fieldError(err.fields, "name") ?? err.message)
        : err
          ? errorMessage(err)
          : null;

  return (
    <>
      <tr className={`border-b border-border align-middle ${message ? "border-b-0" : ""}`}>
        <td className="py-2 pr-3">
          {editing ? (
            <form id={formId} onSubmit={onRename}>
              <label htmlFor={inputId} className="sr-only">
                {category.name} 새 이름
              </label>
              <input
                id={inputId}
                className={input}
                value={name}
                maxLength={LIMITS.categoryNameMax}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(message)}
                autoFocus
              />
            </form>
          ) : (
            <span className={`font-medium ${category.archived ? "text-muted" : "text-text"}`}>{category.name}</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-muted tabular-nums">{category.postCount}</td>
        <td className="px-3 py-2">
          {category.archived ? (
            <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted">보관됨</span>
          ) : (
            <span className="text-xs text-muted">사용 중</span>
          )}
        </td>
        <td className="py-2 pl-3">
          <div className="flex justify-end gap-1 whitespace-nowrap">
            {editing ? (
              <>
                <button type="submit" form={formId} className={btn.primary} disabled={patch.isPending || !name.trim()}>
                  {patch.isPending ? "저장 중…" : "저장"}
                </button>
                <button
                  type="button"
                  className={btn.ghost}
                  disabled={patch.isPending}
                  onClick={() => {
                    setEditing(false);
                    setName(category.name);
                    patch.reset();
                  }}
                >
                  취소
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={btn.ghost}
                  aria-label={`${category.name} 이름 변경`}
                  onClick={() => {
                    patch.reset();
                    setName(category.name);
                    setEditing(true);
                  }}
                >
                  이름 변경
                </button>
                <button
                  type="button"
                  className={btn.ghost}
                  aria-label={`${category.name} ${category.archived ? "보관 해제" : "보관"}`}
                  disabled={patch.isPending}
                  onClick={() => patch.mutate({ archived: !category.archived })}
                >
                  {category.archived ? "보관 해제" : "보관"}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {message && (
        <tr className="border-b border-border">
          <td colSpan={4} className="pb-2">
            <Alert>{message}</Alert>
          </td>
        </tr>
      )}
    </>
  );
}

function isNamed(v: unknown): v is { name: string } {
  return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
}
