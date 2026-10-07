// Study create (admin) / edit (members + admin) — PRD F-05, TSD 7.1, TD-14.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import type { StudyDetail } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import type { FieldErrors } from "../../shared/errors";
import { uuidv7 } from "../../shared/ids";
import { studyCreateSchema, studyPatchSchema } from "../../shared/schemas";
import { ConflictCompare, FormBar, FormField, MarkdownField, type ConflictField } from "../components/forms";
import { useToast } from "../components/toast";
import { Alert, btn, ErrorState, input, pageTitle, SkeletonList } from "../components/ui";
import { ApiError, errorMessage, fieldError } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { useSession } from "../lib/session";
import { NotFoundPage } from "./NotFoundPage";
import { roleTakenMessage } from "./StudyDetailPage";

export interface StudyFormValues {
  name: string;
  goal: string;
  cadence: string;
  description: string;
  materials: string;
  joinGuide: string;
}

type TextKey = keyof StudyFormValues;

const empty: StudyFormValues = { name: "", goal: "", cadence: "", description: "", materials: "", joinGuide: "" };

const fromStudy = (s: StudyDetail): StudyFormValues => ({
  name: s.name,
  goal: s.goal,
  cadence: s.cadence ?? "",
  description: s.description ?? "",
  materials: s.materials ?? "",
  joinGuide: s.joinGuide ?? "",
});

const FIELD_LABELS: Record<TextKey, string> = {
  name: "이름",
  goal: "목표",
  cadence: "모임 주기",
  description: "소개",
  materials: "공통 자료",
  joinGuide: "참여 안내",
};
const MARKDOWN_KEYS = new Set<TextKey>(["description", "materials", "joinGuide"]);

function issuesToFields(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const fields: FieldErrors = {};
  for (const i of issues) (fields[i.path.map(String).join(".")] ??= []).push(i.message);
  return fields;
}

export function StudyFormPage({ mode }: { mode: "new" | "edit" }) {
  const me = useSession();
  const { id = "" } = useParams();
  if (mode === "new") {
    if (!me.isAdmin) return <Alert>운영자만 스터디를 만들 수 있습니다.</Alert>;
    return <StudyForm mode="new" />;
  }
  return <EditStudy key={id} studyId={id} />;
}

function EditStudy({ studyId }: { studyId: string }) {
  const study = useQuery({ queryKey: queryKeys.study(studyId), queryFn: () => api.study(studyId) });
  if (study.isPending) return <SkeletonList rows={3} />;
  if (study.isError) {
    if (study.error instanceof ApiError && study.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="스터디를 불러오지 못했습니다." error={study.error} onRetry={() => void study.refetch()} />;
  }
  if (!study.data.permissions.canEdit) return <Alert>이 스터디 멤버와 운영자만 정보를 편집할 수 있습니다.</Alert>;
  return <StudyForm mode="edit" original={study.data} />;
}

function StudyForm({ mode, original }: { mode: "new" | "edit"; original?: StudyDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<StudyFormValues>(original ? fromStudy(original) : empty);
  const [roleId, setRoleId] = useState("");
  const [createId] = useState(() => uuidv7());
  // TD-14: the version the edit is based on; replaced by the latest one after a conflict.
  const [base, setBase] = useState<StudyDetail | undefined>(original);
  const [conflict, setConflict] = useState<StudyDetail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const summary = useRef<HTMLDivElement>(null);

  const set = (key: TextKey, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  const done = async (detail: StudyDetail) => {
    queryClient.setQueryData(queryKeys.study(detail.id), detail);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.studies }),
      queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    ]);
    await navigate(`/studies/${detail.id}`, { replace: true });
    toast(mode === "new" ? "스터디를 만들었습니다" : "스터디 정보를 저장했습니다");
  };

  const save = useMutation({
    mutationFn: (payload: { kind: "create"; body: Parameters<typeof api.createStudy>[0] } | { kind: "patch"; body: Parameters<typeof api.patchStudy>[1] }) =>
      payload.kind === "create" ? api.createStudy(payload.body) : api.patchStudy(original!.id, payload.body),
    onSuccess: done,
    onError: (err) => {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT" && isStudy(err.latest)) {
        setConflict(err.latest);
        setBase(err.latest);
        setFieldErrors({});
      } else {
        setFieldErrors(err instanceof ApiError ? err.fields : {});
      }
      summary.current?.focus();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const text = {
      name: values.name,
      goal: values.goal,
      cadence: values.cadence,
      description: values.description,
      materials: values.materials,
      joinGuide: values.joinGuide,
    };
    if (mode === "new") {
      const body = { id: createId, discordRoleId: roleId, ...text };
      const parsed = studyCreateSchema.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(issuesToFields(parsed.error.issues));
        save.reset();
        requestAnimationFrame(() => summary.current?.focus());
        return;
      }
      setFieldErrors({});
      save.mutate({ kind: "create", body });
    } else {
      const body = { version: base!.version, ...text };
      const parsed = studyPatchSchema.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(issuesToFields(parsed.error.issues));
        save.reset();
        requestAnimationFrame(() => summary.current?.focus());
        return;
      }
      setFieldErrors({});
      save.mutate({ kind: "patch", body });
    }
  };

  const err = (k: string) => fieldError(fieldErrors, k);
  const dup = roleTakenMessage(save.error);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  const showConflict = conflict !== null;

  const control = (key: TextKey) => {
    if (MARKDOWN_KEYS.has(key)) {
      return (
        <MarkdownField
          label={FIELD_LABELS[key]}
          optional
          value={values[key]}
          onChange={(v) => set(key, v)}
          maxLength={LIMITS.markdownMax}
          error={err(key)}
          minHeight="min-h-32"
          hint={key === "joinGuide" ? "멤버가 아닌 사람에게 보입니다. 예: 역할을 받는 Discord 채널 링크" : undefined}
        />
      );
    }
    return (
      <FormField
        label={FIELD_LABELS[key]}
        required={key === "name" || key === "goal"}
        optional={key === "cadence"}
        error={err(key)}
        hint={key === "cadence" ? "예: 매주 목 21시" : undefined}
      >
        {(p) =>
          key === "goal" ? (
            <textarea
              {...p}
              className={`${input} min-h-20`}
              value={values.goal}
              maxLength={LIMITS.studyGoalMax}
              onChange={(e) => set("goal", e.target.value)}
            />
          ) : (
            <input
              {...p}
              className={input}
              value={values[key]}
              maxLength={key === "name" ? LIMITS.studyNameMax : LIMITS.studyCadenceMax}
              onChange={(e) => set(key, e.target.value)}
            />
          )
        }
      </FormField>
    );
  };

  const keys: TextKey[] = ["name", "goal", "cadence", "description", "materials", "joinGuide"];
  const conflictFields: ConflictField[] = conflict
    ? keys.map((k) => {
        const latest = fromStudy(conflict)[k];
        return {
          key: k,
          label: FIELD_LABELS[k],
          latest,
          markdown: MARKDOWN_KEYS.has(k),
          same: latest === values[k],
          mine: control(k),
          onUseLatest: () => set(k, latest),
        };
      })
    : [];

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <h1 className={pageTitle}>{mode === "new" ? "스터디 만들기" : "스터디 정보 편집"}</h1>

      <div ref={summary} tabIndex={-1} className="outline-none empty:hidden">
        {dup && <Alert>{dup}</Alert>}
        {save.isError && !dup && !showConflict && !hasFieldErrors && (
          <Alert>저장하지 못했습니다: {errorMessage(save.error)}</Alert>
        )}
        {hasFieldErrors && <Alert>입력값을 확인하세요.</Alert>}
      </div>

      {showConflict ? (
        <ConflictCompare
          fields={conflictFields}
          onDiscardMine={() => {
            setValues(fromStudy(conflict));
            setConflict(null);
          }}
        />
      ) : (
        <>
          {keys.slice(0, 3).map((k) => (
            <div key={k}>{control(k)}</div>
          ))}
          {mode === "new" && (
            <FormField
              label="Discord 역할 ID"
              required
              error={err("discordRoleId") ?? dup ?? undefined}
              hint="이 역할을 가진 사람이 스터디 멤버가 됩니다. Discord 개발자 모드 → 역할 우클릭 → ID 복사"
            >
              {(p) => (
                <input
                  {...p}
                  className={`${input} font-mono`}
                  inputMode="numeric"
                  placeholder="예: 1551814006254211143"
                  value={roleId}
                  onChange={(e) => setRoleId(e.target.value)}
                />
              )}
            </FormField>
          )}
          {keys.slice(3).map((k) => (
            <div key={k}>{control(k)}</div>
          ))}
        </>
      )}

      <FormBar status={showConflict ? "최신본 기준으로 다시 저장합니다" : undefined}>
        <button type="button" className={btn.secondary} onClick={() => void navigate(-1)} disabled={save.isPending}>
          취소
        </button>
        <button type="submit" className={btn.primary} disabled={save.isPending}>
          {save.isPending ? "저장 중…" : mode === "new" ? "만들기" : showConflict ? "합쳐서 저장" : "저장"}
        </button>
      </FormBar>
    </form>
  );
}

function isStudy(v: unknown): v is StudyDetail {
  return typeof v === "object" && v !== null && typeof (v as StudyDetail).version === "number" && typeof (v as StudyDetail).name === "string";
}
