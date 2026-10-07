// Form building blocks for the study/round screens (docs/ui.md 6, 7).
import { useId, useState, type ReactNode } from "react";
import { Markdown } from "./Markdown";
import { Alert, btn, input } from "./ui";

export const labelCls = "mb-1 block text-[13px] font-semibold text-muted";
export const errorCls = "mt-1 text-sm text-danger";

export interface ControlProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}

/** Label + control + hint + inline error (7: input errors under the field). */
export function FormField({
  label,
  required,
  optional,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  hint?: ReactNode;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
        {optional && <span className="ml-1 font-normal">(선택)</span>}
      </label>
      {children({ id, "aria-invalid": Boolean(error), "aria-describedby": describedBy, "aria-required": required })}
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className={errorCls}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Markdown textarea with 작성 / 미리보기 tabs (same pattern as the post editor body). */
export function MarkdownField({
  label,
  value,
  onChange,
  error,
  required,
  optional,
  maxLength,
  placeholder,
  minHeight = "min-h-40",
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  required?: boolean;
  optional?: boolean;
  maxLength: number;
  placeholder?: string;
  minHeight?: "min-h-24" | "min-h-32" | "min-h-40" | "min-h-60";
  hint?: ReactNode;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const id = useId();
  const tabs = [
    { key: "write" as const, label: "작성" },
    { key: "preview" as const, label: "미리보기" },
  ];
  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-2 border-b border-border">
        <span id={`${id}-label`} className="pb-2 text-[13px] font-semibold text-muted">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
          {optional && <span className="ml-1 font-normal">(선택)</span>}
          <span className="ml-1 font-normal">· Markdown</span>
        </span>
        <div role="tablist" aria-label={`${label} 편집 방식`} className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${id}-panel`}
              className={`-mb-px h-9 border-b-2 px-3 text-sm ${
                tab === t.key ? "border-accent font-semibold text-text" : "border-transparent text-muted hover:text-text"
              }`}
              onClick={() => setTab(t.key)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") setTab(tab === "write" ? "preview" : "write");
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
        {tab === "write" ? (
          <textarea
            id={id}
            aria-labelledby={`${id}-label`}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${input} ${minHeight} leading-relaxed`}
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-required={required}
          />
        ) : (
          <div className={`${minHeight} rounded-lg border border-border p-4`}>
            {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted">미리볼 내용이 없습니다.</p>}
          </div>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className={errorCls}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface ConflictField {
  key: string;
  label: string;
  /** The latest saved value (read-only). */
  latest: string | null;
  /** Show the latest value rendered as Markdown. */
  markdown?: boolean;
  /** My editable input for this field. */
  mine: ReactNode;
  /** Same value on both sides: shown once, collapsed. */
  same?: boolean;
  onUseLatest?: () => void;
}

/**
 * Version conflict (TSD 8.2, docs/ui.md 7): the latest version on the left
 * (read-only), my input on the right (editable, never discarded). Saving again
 * uses the latest version.
 */
export function ConflictCompare({
  fields,
  updatedBy,
  onDiscardMine,
}: {
  fields: ConflictField[];
  updatedBy?: ReactNode;
  onDiscardMine?: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Alert>
        <strong>다른 멤버가 먼저 저장했습니다.</strong> {updatedBy}
        <br />
        왼쪽 최신본을 확인하고 오른쪽 내 입력에 합친 뒤 다시 저장하세요. 내 입력은 지워지지 않습니다.
        {onDiscardMine && (
          <>
            {" "}
            <button type="button" className={btn.link} onClick={onDiscardMine}>
              내 입력 버리고 최신본으로
            </button>
          </>
        )}
      </Alert>
      {fields.map((f) => (
        <section key={f.key} aria-label={f.label} className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-bold">{f.label}</h3>
            {f.same ? (
              <span className="text-xs text-muted">변경 없음</span>
            ) : (
              f.onUseLatest && (
                <button type="button" className={btn.link} onClick={f.onUseLatest}>
                  최신본 내용으로 바꾸기
                </button>
              )
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="min-w-0 rounded-lg border border-border bg-surface p-3" data-testid={`latest-${f.key}`}>
              <p className="mb-2 text-xs font-semibold text-muted">최신본 (읽기 전용)</p>
              {f.latest?.trim() ? (
                f.markdown ? (
                  <Markdown source={f.latest} />
                ) : (
                  <p className="text-sm break-words whitespace-pre-wrap">{f.latest}</p>
                )
              ) : (
                <p className="text-sm text-muted">(비어 있음)</p>
              )}
            </div>
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold text-muted">내 입력</p>
              {f.mine}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

/** Sticky bottom action bar shared by the forms (like the post editor). */
export function FormBar({ status, children }: { status?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-bg px-4 py-3 lg:-mx-8 lg:px-8">
      <p className="mr-auto text-[13px] text-muted" aria-live="polite">
        {status}
      </p>
      {children}
    </div>
  );
}
