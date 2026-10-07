// Round create / info edit (PRD F-06; TSD 7.1, TD-14 infoVersion). Dates are KST.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Round, RoundDetail, StudyDetail } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import type { FieldErrors } from "../../shared/errors";
import { uuidv7 } from "../../shared/ids";
import { roundCreateSchema, roundInfoPatchSchema } from "../../shared/schemas";
import { ConflictCompare, FormBar, FormField, MarkdownField, type ConflictField } from "../components/forms";
import { useToast } from "../components/toast";
import { Alert, btn, ErrorState, input, meta, pageTitle, SkeletonList } from "../components/ui";
import { ApiError, errorMessage, fieldError } from "../lib/api";
import { api, queryKeys } from "../lib/endpoints";
import { epochMsToKst, formatMeeting, formatPeriod, kstToEpochMs } from "../lib/kst";
import { NotFoundPage } from "./NotFoundPage";

export interface RoundFormValues {
  title: string;
  goal: string;
  scope: string;
  periodStart: string;
  periodEnd: string;
  meetingDate: string;
  meetingTime: string;
  location: string;
  materials: string;
}

const empty: RoundFormValues = {
  title: "",
  goal: "",
  scope: "",
  periodStart: "",
  periodEnd: "",
  meetingDate: "",
  meetingTime: "",
  location: "",
  materials: "",
};

export function roundToValues(r: Round): RoundFormValues {
  const meeting = r.meetingAt !== null ? epochMsToKst(r.meetingAt) : { date: "", time: "" };
  return {
    title: r.title,
    goal: r.goal,
    scope: r.scope,
    periodStart: r.periodStart ?? "",
    periodEnd: r.periodEnd ?? "",
    meetingDate: meeting.date,
    meetingTime: meeting.time,
    location: r.location ?? "",
    materials: r.materials ?? "",
  };
}

/** Form values → API fields. A meeting needs both date and time (KST). */
export function valuesToRoundFields(v: RoundFormValues): {
  fields: {
    title: string;
    goal: string;
    scope: string;
    periodStart: string | null;
    periodEnd: string | null;
    meetingAt: number | null;
    location: string | null;
    materials: string | null;
  };
  errors: FieldErrors;
} {
  const errors: FieldErrors = {};
  let meetingAt: number | null = null;
  if (v.meetingDate || v.meetingTime) {
    if (!v.meetingDate || !v.meetingTime) errors.meetingAt = ["모임 날짜와 시각을 모두 입력하세요"];
    else {
      meetingAt = kstToEpochMs(v.meetingDate, v.meetingTime);
      if (meetingAt === null) errors.meetingAt = ["올바른 날짜와 시각이 아닙니다"];
    }
  }
  return {
    fields: {
      title: v.title,
      goal: v.goal,
      scope: v.scope,
      periodStart: v.periodStart || null,
      periodEnd: v.periodEnd || null,
      meetingAt,
      location: v.location.trim() || null,
      materials: v.materials.trim() ? v.materials : null,
    },
    errors,
  };
}

function issuesToFields(issues: { path: PropertyKey[]; message: string }[], into: FieldErrors): FieldErrors {
  for (const i of issues) (into[i.path.map(String).join(".")] ??= []).push(i.message);
  return into;
}

export function RoundFormPage({ mode }: { mode: "new" | "edit" }) {
  const { id = "" } = useParams();
  return mode === "new" ? <NewRound key={id} studyId={id} /> : <EditRound key={id} roundId={id} />;
}

function NewRound({ studyId }: { studyId: string }) {
  const study = useQuery({ queryKey: queryKeys.study(studyId), queryFn: () => api.study(studyId) });
  if (study.isPending) return <SkeletonList rows={3} />;
  if (study.isError) {
    if (study.error instanceof ApiError && study.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="스터디를 불러오지 못했습니다." error={study.error} onRetry={() => void study.refetch()} />;
  }
  if (!study.data.permissions.canCreateRound) {
    return (
      <Alert>
        {study.data.status === "ended"
          ? "종료된 스터디에는 회차를 만들 수 없습니다."
          : "이 스터디 멤버만 회차를 만들 수 있습니다."}
      </Alert>
    );
  }
  return <RoundForm mode="new" study={study.data} />;
}

function EditRound({ roundId }: { roundId: string }) {
  const round = useQuery({ queryKey: queryKeys.round(roundId), queryFn: () => api.round(roundId) });
  if (round.isPending) return <SkeletonList rows={3} />;
  if (round.isError) {
    if (round.error instanceof ApiError && round.error.status === 404) return <NotFoundPage />;
    return <ErrorState what="회차를 불러오지 못했습니다." error={round.error} onRetry={() => void round.refetch()} />;
  }
  if (!round.data.permissions.canEditInfo) {
    return (
      <Alert>
        {round.data.study.status === "ended"
          ? "종료된 스터디의 회차는 편집할 수 없습니다."
          : round.data.status === "ended"
            ? "종료된 회차입니다. 회차를 재개한 뒤 편집하세요."
            : "이 스터디 멤버만 회차 정보를 편집할 수 있습니다."}
      </Alert>
    );
  }
  return <RoundForm mode="edit" round={round.data} />;
}

const LABELS: Record<string, string> = {
  title: "제목",
  goal: "회차 목표",
  scope: "공통 학습 범위",
  period: "학습 기간",
  meetingAt: "모임 일시",
  location: "장소·회의 링크",
  materials: "공통 자료",
};

function RoundForm({ mode, study, round }: { mode: "new" | "edit"; study?: StudyDetail; round?: RoundDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState<RoundFormValues>(round ? roundToValues(round) : empty);
  const [createId] = useState(() => uuidv7());
  const [infoVersion, setInfoVersion] = useState(round?.infoVersion ?? 0);
  const [conflict, setConflict] = useState<Round | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const summary = useRef<HTMLDivElement>(null);

  const studyId = study?.id ?? round!.studyId;
  const studyName = study?.name ?? round!.study.name;
  const set = <K extends keyof RoundFormValues>(k: K, v: RoundFormValues[K]) => setValues((p) => ({ ...p, [k]: v }));

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof valuesToRoundFields>["fields"]) =>
      mode === "new" ? api.createRound(studyId, { id: createId, ...body }) : api.patchRoundInfo(round!.id, { infoVersion, ...body }),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.rounds }),
        queryClient.invalidateQueries({ queryKey: queryKeys.studies }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.linkableRounds }),
      ]);
      await navigate(`/rounds/${saved.id}`, { replace: true });
      toast(mode === "new" ? `${saved.seq}회차를 만들었습니다` : "회차 정보를 저장했습니다");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT" && isRound(err.latest)) {
        setConflict(err.latest);
        setInfoVersion(err.latest.infoVersion);
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
    const { fields, errors } = valuesToRoundFields(values);
    const parsed =
      mode === "new"
        ? roundCreateSchema.safeParse({ id: createId, ...fields })
        : roundInfoPatchSchema.safeParse({ infoVersion: Math.max(infoVersion, 1), ...fields });
    if (!parsed.success) issuesToFields(parsed.error.issues, errors);
    if (mode === "edit" && fields.periodStart && fields.periodEnd && fields.periodEnd < fields.periodStart) {
      errors.periodEnd ??= ["학습 기간의 끝이 시작보다 빠릅니다"];
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      save.reset();
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    setFieldErrors({});
    save.mutate(fields);
  };

  const err = (k: string) => fieldError(fieldErrors, k);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;

  const controls: Record<string, () => ReactNode> = {
    title: () => (
      <FormField label={LABELS.title!} required error={err("title")}>
        {(p) => (
          <input
            {...p}
            className={input}
            value={values.title}
            maxLength={LIMITS.roundTitleMax}
            placeholder="예: 6장 파티셔닝"
            onChange={(e) => set("title", e.target.value)}
          />
        )}
      </FormField>
    ),
    goal: () => (
      <FormField label={LABELS.goal!} required error={err("goal")}>
        {(p) => (
          <textarea
            {...p}
            className={`${input} min-h-20`}
            value={values.goal}
            maxLength={LIMITS.roundGoalMax}
            onChange={(e) => set("goal", e.target.value)}
          />
        )}
      </FormField>
    ),
    scope: () => (
      <MarkdownField
        label={LABELS.scope!}
        required
        value={values.scope}
        onChange={(v) => set("scope", v)}
        maxLength={LIMITS.markdownMax}
        error={err("scope")}
        placeholder="예: 6장 전체, 연습문제 1–3"
      />
    ),
    period: () => (
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-muted">
          {LABELS.period} <span className="font-normal">(선택)</span>
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="period-start">
            학습 시작일
          </label>
          <input
            id="period-start"
            type="date"
            className={`${input} w-auto`}
            value={values.periodStart}
            onChange={(e) => set("periodStart", e.target.value)}
            aria-invalid={Boolean(err("periodStart"))}
          />
          <span aria-hidden className="text-muted">
            –
          </span>
          <label className="sr-only" htmlFor="period-end">
            학습 종료일
          </label>
          <input
            id="period-end"
            type="date"
            className={`${input} w-auto`}
            value={values.periodEnd}
            min={values.periodStart || undefined}
            onChange={(e) => set("periodEnd", e.target.value)}
            aria-invalid={Boolean(err("periodEnd"))}
          />
        </div>
        {(err("periodStart") ?? err("periodEnd")) && (
          <p className="mt-1 text-sm text-danger">{err("periodStart") ?? err("periodEnd")}</p>
        )}
      </fieldset>
    ),
    meetingAt: () => (
      <fieldset>
        <legend className="mb-1 text-[13px] font-semibold text-muted">
          {LABELS.meetingAt} <span className="font-normal">(선택, 한국 시간)</span>
        </legend>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="meeting-date">
            모임 날짜
          </label>
          <input
            id="meeting-date"
            type="date"
            className={`${input} w-auto`}
            value={values.meetingDate}
            onChange={(e) => set("meetingDate", e.target.value)}
            aria-invalid={Boolean(err("meetingAt"))}
          />
          <label className="sr-only" htmlFor="meeting-time">
            모임 시각
          </label>
          <input
            id="meeting-time"
            type="time"
            className={`${input} w-auto`}
            value={values.meetingTime}
            onChange={(e) => set("meetingTime", e.target.value)}
            aria-invalid={Boolean(err("meetingAt"))}
          />
          {(values.meetingDate || values.meetingTime) && (
            <button
              type="button"
              className={btn.ghost}
              onClick={() => setValues((p) => ({ ...p, meetingDate: "", meetingTime: "" }))}
            >
              일시 지우기
            </button>
          )}
        </div>
        {err("meetingAt") && <p className="mt-1 text-sm text-danger">{err("meetingAt")}</p>}
      </fieldset>
    ),
    location: () => (
      <FormField label={LABELS.location!} optional error={err("location")} hint="장소 이름이나 회의 링크(https://…)">
        {(p) => (
          <input
            {...p}
            className={input}
            value={values.location}
            maxLength={LIMITS.roundLocationMax}
            placeholder="예: Discord 음성 채널, 강남역 스터디룸"
            onChange={(e) => set("location", e.target.value)}
          />
        )}
      </FormField>
    ),
    materials: () => (
      <MarkdownField
        label={LABELS.materials!}
        optional
        value={values.materials}
        onChange={(v) => set("materials", v)}
        maxLength={LIMITS.markdownMax}
        error={err("materials")}
        minHeight="min-h-24"
      />
    ),
  };
  const order = ["title", "goal", "scope", "period", "meetingAt", "location", "materials"];

  let conflictFields: ConflictField[] = [];
  if (conflict) {
    const latest = roundToValues(conflict);
    const latestText: Record<string, string> = {
      title: latest.title,
      goal: latest.goal,
      scope: latest.scope,
      period: formatPeriod(conflict.periodStart, conflict.periodEnd) ?? "",
      meetingAt: conflict.meetingAt !== null ? formatMeeting(conflict.meetingAt) : "",
      location: latest.location,
      materials: latest.materials,
    };
    const same: Record<string, boolean> = {
      title: latest.title === values.title,
      goal: latest.goal === values.goal,
      scope: latest.scope === values.scope,
      period: latest.periodStart === values.periodStart && latest.periodEnd === values.periodEnd,
      meetingAt: latest.meetingDate === values.meetingDate && latest.meetingTime === values.meetingTime,
      location: latest.location === values.location,
      materials: latest.materials === values.materials,
    };
    const useLatest: Record<string, () => void> = {
      title: () => set("title", latest.title),
      goal: () => set("goal", latest.goal),
      scope: () => set("scope", latest.scope),
      period: () => setValues((p) => ({ ...p, periodStart: latest.periodStart, periodEnd: latest.periodEnd })),
      meetingAt: () => setValues((p) => ({ ...p, meetingDate: latest.meetingDate, meetingTime: latest.meetingTime })),
      location: () => set("location", latest.location),
      materials: () => set("materials", latest.materials),
    };
    conflictFields = order.map((k) => ({
      key: k,
      label: LABELS[k]!,
      latest: latestText[k] ?? "",
      markdown: k === "scope" || k === "materials",
      same: same[k],
      mine: controls[k]!(),
      onUseLatest: useLatest[k],
    }));
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className={meta}>
          <Link to={`/studies/${studyId}`} className="hover:text-text hover:underline">
            {studyName}
          </Link>
          {round ? ` · ${round.seq}회차` : ""}
        </p>
        <h1 className={pageTitle}>{mode === "new" ? "새 회차" : "회차 정보 편집"}</h1>
        {mode === "new" && <p className="text-sm text-muted">회차 번호는 자동으로 매겨집니다.</p>}
      </div>

      <div ref={summary} tabIndex={-1} className="outline-none empty:hidden">
        {save.isError && !conflict && !hasFieldErrors && <Alert>저장하지 못했습니다: {errorMessage(save.error)}</Alert>}
        {hasFieldErrors && <Alert>입력값을 확인하세요.</Alert>}
      </div>

      {conflict ? (
        <ConflictCompare
          fields={conflictFields}
          onDiscardMine={() => {
            setValues(roundToValues(conflict));
            setConflict(null);
          }}
        />
      ) : (
        order.map((k) => <div key={k}>{controls[k]!()}</div>)
      )}

      <FormBar status={conflict ? "최신본 기준으로 다시 저장합니다" : undefined}>
        <button type="button" className={btn.secondary} onClick={() => void navigate(-1)} disabled={save.isPending}>
          취소
        </button>
        <button type="submit" className={btn.primary} disabled={save.isPending}>
          {save.isPending ? "저장 중…" : mode === "new" ? "회차 만들기" : conflict ? "합쳐서 저장" : "저장"}
        </button>
      </FormBar>
    </form>
  );
}

function isRound(v: unknown): v is Round {
  return typeof v === "object" && v !== null && typeof (v as Round).infoVersion === "number" && typeof (v as Round).seq === "number";
}
