// Post create / edit (PRD F-02, F-03, F-10; TSD 8.1).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import type { Category, CategoryWithCount, LinkableRound, PostDetail, PostHtmlMeta } from "../../shared/api";
import type { FieldErrors } from "../../shared/errors";
import { LIMITS } from "../../shared/constants";
import { nameKey, uuidv7 } from "../../shared/ids";
import { postCreateSchema, type PostCreateInput } from "../../shared/schemas";
import { Markdown } from "../components/Markdown";
import { useToast } from "../components/toast";
import { Alert, btn, ErrorState, input, SkeletonList, useNow } from "../components/ui";
import { ApiError, errorMessage, fieldError } from "../lib/api";
import { clearDraft, latestNewPostDraft, loadDraft, saveDraft } from "../lib/drafts";
import { api, queryKeys } from "../lib/endpoints";
import { formatFull, formatRelative } from "../lib/format";
import { formatBytes, HTML_MAX_LABEL, readHtmlFile, suggestedTitle, type HtmlFile } from "../lib/htmlFile";
import { useSession } from "../lib/session";
import { NotFoundPage } from "./NotFoundPage";

export interface PostFormValues {
  title: string;
  body: string;
  categoryId: string;
  tags: string[];
  links: { url: string; label: string }[];
  /** Linked round (F-08); "" = none. Only sent on create; changed later on the post page. */
  roundId: string;
  /**
   * Name of the HTML file chosen when the draft was saved. The file itself is
   * never put in localStorage (up to 10MB), so a restored draft asks for it again.
   */
  htmlFilename: string;
}

export const emptyPostValues = (): PostFormValues => ({
  title: "",
  body: "",
  categoryId: "",
  tags: [],
  links: [],
  roundId: "",
  htmlFilename: "",
});

function valuesFromPost(p: PostDetail): PostFormValues {
  return {
    title: p.title,
    body: p.body,
    categoryId: p.category.id,
    tags: p.tags,
    links: p.links.map((l) => ({ url: l.url, label: l.label })),
    roundId: p.round?.id ?? p.roundId ?? "",
    htmlFilename: "",
  };
}

/** Request body. Only known fields, so older local drafts (with D-22 kind fields) are harmless. */
function toPayload(id: string, v: PostFormValues): PostCreateInput {
  return {
    id,
    title: v.title,
    body: v.body,
    categoryId: v.categoryId,
    tags: v.tags,
    links: v.links.filter((l) => l.url.trim() || l.label.trim()).map((l) => ({ url: l.url.trim(), label: l.label })),
    ...(v.roundId ? { roundId: v.roundId } : {}),
  };
}

/** Client-side check with the shared schemas (UX only; the server is authoritative). */
function validate(payload: PostCreateInput): FieldErrors {
  const fields: FieldErrors = {};
  const add = (issues: { path: PropertyKey[]; message: string }[]) => {
    for (const issue of issues) {
      const key = issue.path.map(String).join(".");
      (fields[key] ??= []).push(issue.message);
    }
  };
  if (!payload.categoryId) fields.categoryId = ["카테고리를 선택하세요"];
  const base = postCreateSchema.safeParse(payload);
  if (!base.success) add(base.error.issues.filter((i) => !(i.path[0] === "categoryId" && fields.categoryId)));
  return fields;
}

export function PostEditorPage({ mode }: { mode: "new" | "edit" }) {
  const { id } = useParams();
  if (mode === "new") return <NewPost />;
  return <EditPost key={id} postId={id ?? ""} />;
}

function NewPost() {
  const me = useSession();
  // "+ 이 회차에 글 쓰기" opens /posts/new?roundId=… (F-08).
  const [params] = useSearchParams();
  const roundParam = params.get("roundId") ?? "";
  // TSD 8.1: the create id is generated when the screen opens, or taken over
  // from the latest unsent draft so that reopening restores it.
  const [initial, setInitial] = useState(() => {
    const draft = latestNewPostDraft<PostFormValues>(me.id);
    return draft
      ? {
          postId: draft.postId,
          values: { ...emptyPostValues(), ...draft.values, ...(roundParam ? { roundId: roundParam } : {}) },
          restoredAt: draft.savedAt,
        }
      : { postId: uuidv7(), values: { ...emptyPostValues(), roundId: roundParam }, restoredAt: null as number | null };
  });
  return (
    <PostForm
      key={initial.postId}
      mode="new"
      postId={initial.postId}
      initialValues={initial.values}
      restoredAt={initial.restoredAt}
      onDiscardDraft={() => {
        clearDraft(me.id, initial.postId);
        setInitial({ postId: uuidv7(), values: { ...emptyPostValues(), roundId: roundParam }, restoredAt: null });
      }}
    />
  );
}

function EditPost({ postId }: { postId: string }) {
  const me = useSession();
  const post = useQuery({ queryKey: queryKeys.post(postId), queryFn: () => api.post(postId) });

  if (post.isPending) return <SkeletonList rows={3} />;
  if (post.isError) {
    if (post.error instanceof ApiError && post.error.status === 404) return <NotFoundPage />;
    return <ErrorState error={post.error} onRetry={() => void post.refetch()} />;
  }
  if (post.data.author.id !== me.id) return <Alert>작성자만 글을 수정할 수 있습니다.</Alert>;
  return <EditPostForm post={post.data} />;
}

/** Decides once (on open) whether a newer local edit draft replaces the stored post. */
function EditPostForm({ post }: { post: PostDetail }) {
  const me = useSession();
  const [initial, setInitial] = useState(() => {
    const draft = loadDraft<PostFormValues>(me.id, post.id);
    return draft?.mode === "edit" && draft.savedAt > post.updatedAt
      ? { values: { ...valuesFromPost(post), ...draft.values }, restoredAt: draft.savedAt }
      : { values: valuesFromPost(post), restoredAt: null };
  });
  return (
    <PostForm
      key={initial.restoredAt ?? "server"}
      mode="edit"
      postId={post.id}
      original={post}
      initialValues={initial.values}
      restoredAt={initial.restoredAt}
      onDiscardDraft={() => {
        clearDraft(me.id, post.id);
        setInitial({ values: valuesFromPost(post), restoredAt: null });
      }}
    />
  );
}

const AUTOSAVE_MS = 400;

export function PostForm({
  mode,
  postId,
  original,
  initialValues,
  restoredAt,
  onDiscardDraft,
}: {
  mode: "new" | "edit";
  postId: string;
  original?: PostDetail;
  initialValues: PostFormValues;
  restoredAt: number | null;
  onDiscardDraft: () => void;
}) {
  const me = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState(initialValues);
  const [dirty, setDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [draftSaveFailed, setDraftSaveFailed] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(restoredAt);
  const now = useNow(15_000);
  // Attached HTML (D-30): kept in memory only, never in the draft.
  const [htmlFile, setHtmlFile] = useState<HtmlFile | null>(null);
  const [removeHtml, setRemoveHtml] = useState(false);
  const [introFilled, setIntroFilled] = useState(false);
  const submitted = useRef(false);
  const errorSummary = useRef<HTMLDivElement>(null);

  const set = <K extends keyof PostFormValues>(key: K, value: PostFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setDirty(true);
  };

  // Autosave to localStorage while typing (TSD 8.1 step 1).
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      if (submitted.current) return;
      const savedAt = Date.now();
      const ok = saveDraft(me.id, { mode, postId, savedAt, values });
      setDraftSaveFailed(!ok);
      if (ok) setLastSavedAt(savedAt);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, values, me.id, mode, postId]);

  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: api.categories });

  // A new post whose create went through but whose file upload failed: the
  // next save edits that post instead of replaying the create (which would
  // ignore changes made since).
  const created = useRef<PostDetail | null>(null);

  const save = useMutation({
    mutationFn: async (payload: PostCreateInput) => {
      let detail: PostDetail;
      try {
        if (mode === "new" && !created.current) {
          detail = await api.createPost(payload);
          created.current = detail;
        } else {
          const { id: _id, ...patch } = payload;
          detail = await api.updatePost(postId, patch);
        }
      } catch (err) {
        throw new SaveStepError("post", err);
      }
      // TD-25: the file is its own raw request, sent only after the text is saved.
      try {
        if (htmlFile) detail = await api.putPostHtml(postId, { filename: htmlFile.filename, bytes: htmlFile.bytes });
        else if (removeHtml && original?.html) {
          await api.deletePostHtml(postId);
          detail = { ...detail, html: null };
        }
      } catch (err) {
        throw new SaveStepError(htmlFile ? "html-put" : "html-delete", err, detail);
      }
      return detail;
    },
    onSuccess: async (detail) => {
      submitted.current = true;
      clearDraft(me.id, postId);
      queryClient.setQueryData(queryKeys.post(detail.id), detail);
      // A replaced file gets a fresh signed URL (the old one may be cached for 5 minutes).
      queryClient.removeQueries({ queryKey: queryKeys.postHtmlUrl(detail.id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: [...queryKeys.posts, "list"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        // Linked posts on round pages.
        queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
      ]);
      await navigate(`/posts/${detail.id}`, { replace: true });
      toast(mode === "new" ? "글을 등록했습니다" : "글을 저장했습니다");
    },
    onError: async (err) => {
      // Input stays as typed (and in the local draft); never shown as success.
      const cause = err instanceof SaveStepError ? err.cause : err;
      setFieldErrors(cause instanceof ApiError ? cause.fields : {});
      errorSummary.current?.focus();
      if (err instanceof SaveStepError && err.saved) {
        // The text part was saved: show that state elsewhere, keep the form (and the file) here.
        queryClient.setQueryData(queryKeys.post(err.saved.id), err.saved);
        await queryClient.invalidateQueries({ queryKey: [...queryKeys.posts, "list"] });
      }
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    // A prefilled round that is not linkable (ended, not my study) is dropped, as the field shows.
    const linkable = queryClient.getQueryData<LinkableRound[]>(queryKeys.linkableRounds);
    const roundOk = !values.roundId || !linkable || linkable.some((r) => r.id === values.roundId);
    const payload = toPayload(postId, roundOk ? values : { ...values, roundId: "" });
    const errors = validate(payload);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      save.reset();
      requestAnimationFrame(() => errorSummary.current?.focus());
      return;
    }
    save.mutate(payload);
  };

  const err = (path: string) => fieldError(fieldErrors, path);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const rootError = err("");
  const stepError = save.error instanceof SaveStepError ? save.error : null;
  const saveCause = stepError ? stepError.cause : save.error;

  const pickHtml = (file: HtmlFile) => {
    setHtmlFile(file);
    setRemoveHtml(false);
    set("htmlFilename", file.filename);
    if (!values.title.trim()) set("title", suggestedTitle(file));
    // The body is still required by the API (postCreateSchema): put a short intro the author can change.
    if (!values.body.trim()) {
      set("body", HTML_INTRO);
      setIntroFilled(true);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6" aria-describedby="editor-status">
      <h1 className="sr-only">{mode === "new" ? "글쓰기" : "글 수정"}</h1>

      {restoredAt !== null && (
        <Alert kind="info">
          {formatFull(restoredAt)}에 임시저장된 내용을 불러왔습니다.{" "}
          <button type="button" className={btn.link} onClick={onDiscardDraft}>
            {mode === "new" ? "버리고 새로 쓰기" : "버리고 저장된 글 불러오기"}
          </button>
        </Alert>
      )}

      <div ref={errorSummary} tabIndex={-1} className="outline-none empty:hidden" id="editor-status">
        {save.isError && stepError?.step.startsWith("html") && (
          <Alert>
            글 내용은 저장했지만 HTML 파일을 {stepError.step === "html-put" ? "올리지" : "지우지"} 못했습니다:{" "}
            {errorMessage(saveCause)} 파일은 그대로 두었으니 다시 저장해 주세요.
          </Alert>
        )}
        {save.isError && !stepError?.step.startsWith("html") && !hasFieldErrors && (
          <Alert>저장하지 못했습니다: {errorMessage(saveCause)}</Alert>
        )}
        {hasFieldErrors && (
          <Alert>
            입력값을 확인하세요.
            {rootError && <> {rootError}</>}
          </Alert>
        )}
      </div>

      <Field label="제목" required error={err("title")} srOnlyLabel>
        {(p) => (
          <input
            {...p}
            className="block w-full border-0 border-b-2 border-transparent bg-transparent px-0 py-1 text-[22px] leading-tight font-bold tracking-[-0.02em] text-text outline-none placeholder:font-bold focus:border-accent aria-[invalid=true]:border-danger lg:text-[26px]"
            placeholder="제목을 입력하세요"
            value={values.title}
            maxLength={LIMITS.postTitleMax}
            onChange={(e) => set("title", e.target.value)}
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-4 border-y border-border py-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,12rem)_minmax(0,13rem)_minmax(0,1fr)]">
        <CategoryField
          categories={categories.data}
          categoriesError={categories.isError ? categories.error : null}
          original={original}
          value={values.categoryId}
          onChange={(id) => set("categoryId", id)}
          error={err("categoryId")}
        />
        <RoundField
          mode={mode}
          value={values.roundId}
          original={original}
          onChange={(id) => set("roundId", id)}
          error={err("roundId")}
        />
        <div className="sm:col-span-2 lg:col-span-1">
          <TagsField value={values.tags} onChange={(tags) => set("tags", tags)} error={err("tags") ?? firstPrefixed(fieldErrors, "tags.")} />
        </div>
      </div>

      <HtmlField
        file={htmlFile}
        existing={removeHtml ? null : (original?.html ?? null)}
        removed={removeHtml && Boolean(original?.html)}
        draftFilename={htmlFile ? "" : values.htmlFilename}
        error={firstPrefixed(fieldErrors, "html") ?? err("filename")}
        onPick={pickHtml}
        onRemove={() => {
          setHtmlFile(null);
          set("htmlFilename", "");
          if (original?.html) setRemoveHtml(true);
        }}
        onUndoRemove={() => setRemoveHtml(false)}
      />

      <BodyField
        value={values.body}
        onChange={(b) => {
          set("body", b);
          setIntroFilled(false);
        }}
        error={err("body")}
        hint={introFilled ? "본문은 꼭 있어야 해서 짧은 소개를 넣어 두었습니다. 자유롭게 바꾸세요." : undefined}
      />

      <LinksField value={values.links} onChange={(links) => set("links", links)} errors={fieldErrors} />

      <p className="text-xs text-muted">
        작성 중인 내용은 이 브라우저에만 임시저장되며 로그아웃하면 지워집니다. 공용 PC에서는 사용 후 꼭 로그아웃하세요.
      </p>

      <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-2 border-t border-border bg-bg px-4 py-3 lg:-mx-8 lg:px-8">
        <p className="mr-auto text-[13px] text-muted" aria-live="polite">
          {draftSaveFailed
            ? "임시저장 안 됨 · 브라우저 저장소를 쓸 수 없습니다"
            : lastSavedAt !== null
              ? `임시저장됨 · ${savedAgo(lastSavedAt, now)}`
              : ""}
        </p>
        <button type="button" className={btn.secondary} onClick={() => void navigate(-1)} disabled={save.isPending}>
          취소
        </button>
        <button type="submit" className={btn.primary} disabled={save.isPending}>
          {save.isPending ? "저장 중…" : mode === "new" ? "등록" : "저장"}
        </button>
      </div>
    </form>
  );
}

/** "방금", "3분 전", … for the draft status. */
function savedAgo(ms: number, now: number): string {
  return now - ms < 60_000 ? "방금" : formatRelative(ms, now);
}

const HTML_INTRO = "HTML 파일로 정리한 내용입니다.";

/** Which step of an edit save failed; `saved` is set once the text part went through. */
class SaveStepError extends Error {
  constructor(
    readonly step: "post" | "html-put" | "html-delete",
    override readonly cause: unknown,
    readonly saved?: PostDetail,
  ) {
    super(step);
    this.name = "SaveStepError";
  }
}

/** "HTML 파일" (D-30): pick or drop one .html/.htm file; read as strict UTF-8 in the browser. */
function HtmlField({
  file,
  existing,
  removed,
  draftFilename,
  error,
  onPick,
  onRemove,
  onUndoRemove,
}: {
  file: HtmlFile | null;
  existing: PostHtmlMeta | null;
  removed: boolean;
  draftFilename: string;
  error?: string;
  onPick: (file: HtmlFile) => void;
  onRemove: () => void;
  onUndoRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const read = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    setReadError(null);
    const result = await readHtmlFile(f);
    setReading(false);
    if (result.ok) onPick(result.file);
    else setReadError(result.error);
  };

  const attached = file ?? existing;
  const choose = () => inputRef.current?.click();

  return (
    <section aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <h2 id={`${id}-label`} className="text-base font-bold text-text">
        HTML 파일 <span className="text-sm font-normal text-muted">(선택, {HTML_MAX_LABEL} 이하 · UTF-8)</span>
      </h2>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept=".html,.htm,text/html"
        className="sr-only"
        aria-label="HTML 파일 선택"
        tabIndex={-1}
        onChange={(e) => {
          void read(e.target.files?.[0]);
          e.target.value = ""; // choosing the same file again still fires change
        }}
      />
      {attached ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span className="rounded bg-accent-subtle px-1.5 py-0.5 text-xs font-semibold text-accent-subtle-text">HTML</span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium" data-testid="html-attached">
            {attached.filename}
          </span>
          <span className="text-xs text-muted">
            {formatBytes(attached.size)}
            {file && existing === null && !removed ? " · 저장하면 올라갑니다" : file ? " · 저장하면 바뀝니다" : ""}
          </span>
          <button type="button" className={btn.ghost} onClick={choose} disabled={reading}>
            교체
          </button>
          <button type="button" className={btn.ghost} onClick={onRemove} disabled={reading}>
            제거
          </button>
        </div>
      ) : (
        <div
          className={`flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-6 text-center text-sm ${
            dragging ? "border-accent bg-accent-subtle" : "border-border"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void read(e.dataTransfer.files[0]);
          }}
          data-testid="html-dropzone"
        >
          <p className="text-muted">HTML 파일을 여기에 끌어다 놓거나</p>
          <button type="button" className={btn.secondary} onClick={choose} disabled={reading}>
            {reading ? "읽는 중…" : "파일 선택"}
          </button>
          <p className="text-xs text-muted">글 화면 위쪽에 그대로 보입니다. 스크립트도 실행되지만 사이트와 분리된 곳에서 열립니다.</p>
        </div>
      )}
      {removed && (
        <p className="text-sm text-muted">
          저장하면 HTML 파일이 삭제됩니다.{" "}
          <button type="button" className={btn.link} onClick={onUndoRemove}>
            되돌리기
          </button>
        </p>
      )}
      {draftFilename && !attached && (
        <Alert kind="info">
          임시저장에는 HTML 파일이 들어 있지 않습니다. &ldquo;{draftFilename}&rdquo;을(를) 다시 선택해 주세요.
        </Alert>
      )}
      {(readError ?? error) && (
        <p role="alert" className="text-sm text-danger">
          {readError ?? error}
        </p>
      )}
    </section>
  );
}

function firstPrefixed(fields: FieldErrors, prefix: string): string | undefined {
  for (const [k, v] of Object.entries(fields)) if (k.startsWith(prefix) && v[0]) return v[0];
  return undefined;
}

const labelCls = "mb-1 block text-[13px] font-semibold text-muted";
const errorCls = "mt-1 text-sm text-danger";

interface ControlProps {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}

function Field({
  label,
  required,
  error,
  hint,
  srOnlyLabel = false,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  srOnlyLabel?: boolean;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className={srOnlyLabel ? "sr-only" : labelCls}>
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
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

function CategoryField({
  categories,
  categoriesError,
  original,
  value,
  onChange,
  error,
}: {
  categories: CategoryWithCount[] | undefined;
  categoriesError: unknown;
  original?: PostDetail;
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const newNameId = useId();

  // Archived categories are not selectable, except the one an edited post already uses.
  const options = (categories ?? []).filter((c) => !c.archived || c.id === original?.category.id);
  const existingMatch = name.trim() ? categories?.find((c) => nameKey(c.name) === nameKey(name)) : undefined;

  const pick = (c: Category) => {
    if (c.archived && c.id !== original?.category.id) {
      setNotice(`같은 이름의 카테고리 "${c.name}"가 이미 있지만 보관되어 선택할 수 없습니다.`);
      return;
    }
    onChange(c.id);
    setNotice(`이미 있는 카테고리 "${c.name}"를 선택했습니다.`);
    setAdding(false);
    setName("");
  };

  const create = useMutation({
    mutationFn: () => api.createCategory(name),
    onSuccess: (cat) => {
      // Same order as the server (UD-14): post count desc, then name; a new one has 0 posts.
      queryClient.setQueryData<CategoryWithCount[]>(queryKeys.categories, (list) =>
        [...(list ?? []).filter((c) => c.id !== cat.id), { ...cat, postCount: 0 }].sort(
          (a, b) => b.postCount - a.postCount || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        ),
      );
      onChange(cat.id);
      setNotice(`카테고리 "${cat.name}"를 추가했습니다.`);
      setAdding(false);
      setName("");
    },
    onError: (err) => {
      // D-17: duplicate (case/space-insensitive) → use the existing one.
      if (err instanceof ApiError && err.code === "DUPLICATE" && isCategory(err.existing)) {
        const existing = err.existing;
        queryClient.setQueryData<CategoryWithCount[]>(queryKeys.categories, (list) =>
          list?.some((c) => c.id === existing.id) ? list : [...(list ?? []), { ...existing, postCount: 0 }],
        );
        pick(existing);
      }
    },
  });

  const createError =
    create.error instanceof ApiError && create.error.code !== "DUPLICATE"
      ? (fieldError(create.error.fields, "name") ?? create.error.message)
      : null;

  return (
    <div className="space-y-2">
      <Field label="카테고리" required error={error}>
        {(p) => (
          <select
            {...p}
            className={input}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setNotice(null);
            }}
          >
            <option value="">{categories ? "카테고리를 선택하세요" : "불러오는 중…"}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.archived ? " (보관됨)" : ""}
              </option>
            ))}
          </select>
        )}
      </Field>
      {categoriesError !== null && <Alert>카테고리 목록을 불러오지 못했습니다: {errorMessage(categoriesError)}</Alert>}
      {notice && (
        <p role="status" className="text-[13px] text-muted">
          {notice}
        </p>
      )}
      {!adding ? (
        <button type="button" className={btn.link} onClick={() => setAdding(true)}>
          + 새 카테고리
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <label htmlFor={newNameId} className="block text-sm font-medium">
            새 카테고리 이름
          </label>
          <div className="flex gap-2">
            <input
              id={newNameId}
              className={input}
              value={name}
              maxLength={LIMITS.categoryNameMax}
              onChange={(e) => {
                setName(e.target.value);
                create.reset();
              }}
              onKeyDown={(e) => {
                // Enter adds the category instead of submitting the post.
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (existingMatch) pick(existingMatch);
                  else if (name.trim() && !create.isPending) create.mutate();
                }
              }}
            />
            <button
              type="button"
              className={btn.secondary}
              disabled={!name.trim() || create.isPending}
              onClick={() => (existingMatch ? pick(existingMatch) : create.mutate())}
            >
              {create.isPending ? "추가 중…" : existingMatch ? "선택" : "추가"}
            </button>
            <button
              type="button"
              className={btn.ghost}
              onClick={() => {
                setAdding(false);
                setName("");
                create.reset();
              }}
            >
              닫기
            </button>
          </div>
          {existingMatch && (
            <p className="text-xs text-muted">
              이미 있는 카테고리입니다: &ldquo;{existingMatch.name}&rdquo;{existingMatch.archived ? " (보관됨)" : ""}
            </p>
          )}
          {createError && (
            <p role="alert" className="text-sm text-danger">
              {createError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function isCategory(v: unknown): v is Category {
  return typeof v === "object" && v !== null && typeof (v as Category).id === "string" && typeof (v as Category).name === "string";
}

/** "회차 연결" (F-08): active rounds of my active studies. On edit it is changed from the post page. */
export function RoundField({
  mode,
  value,
  original,
  onChange,
  error,
}: {
  mode: "new" | "edit";
  value: string;
  original?: PostDetail;
  onChange: (id: string) => void;
  error?: string;
}) {
  const rounds = useQuery({ queryKey: queryKeys.linkableRounds, queryFn: api.linkableRounds, enabled: mode === "new" });
  const id = useId();
  if (mode === "edit") {
    return (
      <div>
        <span className={labelCls}>회차 연결</span>
        <p className="flex min-h-11 items-center text-sm text-muted lg:min-h-10">
          {original?.round ? `${original.round.studyName} ${original.round.seq}회차` : "연결 안 함"}
        </p>
        <p className="text-xs text-muted">글 화면에서 바꿀 수 있습니다.</p>
      </div>
    );
  }
  const items = rounds.data ?? [];
  const unknown = value !== "" && rounds.isSuccess && !items.some((r) => r.id === value);
  const studies = [...new Set(items.map((r) => r.studyName))];
  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        회차 연결 <span className="font-normal">(선택)</span>
      </label>
      <select
        id={id}
        className={input}
        value={unknown ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error) || unknown}
      >
        <option value="">{rounds.isPending ? "불러오는 중…" : "연결 안 함"}</option>
        {studies.map((name) => (
          <optgroup key={name} label={name}>
            {items
              .filter((r) => r.studyName === name)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.seq}회차 · {r.title}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
      {rounds.isError && <p className="mt-1 text-sm text-danger">회차 목록을 불러오지 못했습니다.</p>}
      {unknown && <p className="mt-1 text-sm text-danger">이 회차에는 글을 연결할 수 없습니다 (종료되었거나 멤버가 아닌 스터디).</p>}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  );
}

function TagsField({ value, onChange, error }: { value: string[]; onChange: (tags: string[]) => void; error?: string }) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const id = useId();

  const commit = (raw: string) => {
    const parts = raw
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const tag of parts) {
      if (tag.length > LIMITS.tagNameMax) {
        setHint(`태그는 ${LIMITS.tagNameMax}자 이하로 입력하세요`);
        continue;
      }
      if (next.some((t) => nameKey(t) === nameKey(tag))) continue;
      if (next.length >= LIMITS.tagsMax) {
        setHint(`태그는 최대 ${LIMITS.tagsMax}개입니다`);
        break;
      }
      next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
    setText("");
  };

  return (
    <div>
      <label htmlFor={id} className={labelCls}>
        태그 <span className="font-normal">(선택, 최대 {LIMITS.tagsMax}개)</span>
      </label>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface p-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent lg:min-h-10">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-accent-subtle py-0.5 pr-1 pl-2 text-[13px] font-medium text-accent-subtle-text">
            #{t}
            <button
              type="button"
              className="rounded px-1 hover:bg-bg"
              aria-label={`태그 ${t} 삭제`}
              onClick={() => onChange(value.filter((x) => x !== t))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          className="min-w-32 flex-1 border-0 px-1 py-1 text-base outline-none sm:text-sm"
          placeholder={value.length >= LIMITS.tagsMax ? "" : "입력 후 Enter 또는 쉼표"}
          value={text}
          disabled={value.length >= LIMITS.tagsMax}
          onChange={(e) => {
            setHint(null);
            if (e.target.value.includes(",")) commit(e.target.value);
            else setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && text === "" && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => commit(text)}
          aria-invalid={Boolean(error)}
        />
      </div>
      {(error ?? hint) && <p className={errorCls}>{error ?? hint}</p>}
    </div>
  );
}

function LinksField({
  value,
  onChange,
  errors,
}: {
  value: { url: string; label: string }[];
  onChange: (links: { url: string; label: string }[]) => void;
  errors: FieldErrors;
}) {
  const baseId = useId();
  const update = (i: number, patch: Partial<{ url: string; label: string }>) =>
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const listError = fieldError(errors, "links");
  return (
    <fieldset>
      <legend className="mb-1 text-base font-bold text-text">
        참고 링크
        <span className="text-sm font-normal text-muted"> (선택)</span>
      </legend>
      <p className="mb-2 text-xs text-muted">http 또는 https 주소, 최대 {LIMITS.linksMax}개</p>
      <ul className="space-y-2">
        {value.map((l, i) => {
          const urlError = fieldError(errors, `links.${i}.url`);
          const labelError = fieldError(errors, `links.${i}.label`);
          return (
            <li key={i} className="space-y-1">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor={`${baseId}-url-${i}`}>
                  링크 {i + 1} 주소
                </label>
                <input
                  id={`${baseId}-url-${i}`}
                  type="url"
                  inputMode="url"
                  className={`${input} sm:flex-[2]`}
                  placeholder="https://"
                  value={l.url}
                  maxLength={LIMITS.linkUrlMax}
                  aria-invalid={Boolean(urlError)}
                  onChange={(e) => update(i, { url: e.target.value })}
                />
                <label className="sr-only" htmlFor={`${baseId}-label-${i}`}>
                  링크 {i + 1} 설명
                </label>
                <input
                  id={`${baseId}-label-${i}`}
                  className={`${input} sm:flex-1`}
                  placeholder="설명 (선택)"
                  value={l.label}
                  maxLength={LIMITS.linkLabelMax}
                  onChange={(e) => update(i, { label: e.target.value })}
                />
                <button
                  type="button"
                  className={btn.ghost}
                  aria-label={`링크 ${i + 1} 삭제`}
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  삭제
                </button>
              </div>
              {(urlError ?? labelError) && <p className="text-sm text-danger">{urlError ?? labelError}</p>}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className={`${btn.ghost} mt-2 -ml-3`}
        disabled={value.length >= LIMITS.linksMax}
        onClick={() => onChange([...value, { url: "", label: "" }])}
      >
        + 링크 추가
      </button>
      {listError && <p className={errorCls}>{listError}</p>}
    </fieldset>
  );
}

function BodyField({
  value,
  onChange,
  error,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
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
        <span id={`${id}-label`} className="text-[13px] font-semibold text-muted">
          본문 <span className="text-danger">*</span>
          <span className="ml-1 font-normal">(Markdown)</span>
        </span>
        <div role="tablist" aria-label="본문 편집 방식" className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`${id}-panel`}
              className={`-mb-px h-10 border-b-2 px-3 text-sm ${tab === t.key ? "border-accent font-semibold text-text" : "border-transparent text-muted hover:text-text"}`}
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
            className={`${input} min-h-80 leading-relaxed`}
            value={value}
            maxLength={LIMITS.postBodyMax}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-required
          />
        ) : (
          <div className="min-h-80 rounded-lg border border-border p-4">
            {value.trim() ? <Markdown source={value} /> : <p className="text-sm text-muted">미리볼 내용이 없습니다.</p>}
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between gap-2">
        <p className={error ? "text-sm text-danger" : "text-xs text-muted"}>{error ?? hint}</p>
        <span className="shrink-0 text-xs text-muted">
          {value.length.toLocaleString()} / {LIMITS.postBodyMax.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
