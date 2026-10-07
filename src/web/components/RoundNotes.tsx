// Shared meeting notes of a round (PRD F-09; TSD 8.2 conflict flow, D-11).
// Edits autosave to localStorage per member/round and survive a conflict.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Round, RoundDetail } from "../../shared/api";
import { LIMITS } from "../../shared/constants";
import { ApiError, errorMessage } from "../lib/api";
import { clearKeyedDraft, loadKeyedDraft, saveKeyedDraft } from "../lib/drafts";
import { api, queryKeys } from "../lib/endpoints";
import { formatFull, formatRelative } from "../lib/format";
import { useSession } from "../lib/session";
import { ConflictCompare, FormBar, MarkdownField } from "./forms";
import { Markdown } from "./Markdown";
import { useToast } from "./toast";
import { Alert, AuthorName, btn, sectionTitle, Time, useNow } from "./ui";

export interface NotesValues {
  notesDiscussion: string;
  notesOpenQuestions: string;
  notesNextActions: string;
}

export const NOTES_FIELDS: { key: keyof NotesValues; label: string; hint: string }[] = [
  { key: "notesDiscussion", label: "핵심 논의", hint: "모임에서 나눈 주요 내용" },
  { key: "notesOpenQuestions", label: "남은 질문", hint: "다음 회차에서 다시 볼 질문" },
  { key: "notesNextActions", label: "다음 행동", hint: "다음 모임까지 할 일" },
];

export const NOTES_DRAFT_KIND = "notes";
const AUTOSAVE_MS = 400;

const notesOf = (r: Round): NotesValues => ({
  notesDiscussion: r.notesDiscussion ?? "",
  notesOpenQuestions: r.notesOpenQuestions ?? "",
  notesNextActions: r.notesNextActions ?? "",
});

const isEmptyNotes = (v: NotesValues) => !v.notesDiscussion.trim() && !v.notesOpenQuestions.trim() && !v.notesNextActions.trim();

export function RoundNotes({ round }: { round: RoundDetail }) {
  const me = useSession();
  const canWrite = round.permissions.canWriteNotes;
  const saved = notesOf(round);
  // A draft left from an earlier visit reopens the editor.
  const [editing, setEditing] = useState(() => canWrite && loadKeyedDraft(me.id, NOTES_DRAFT_KIND, round.id) !== null);

  return (
    <section aria-labelledby="notes" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="notes" className={sectionTitle}>
          모임 기록
        </h2>
        {!editing && round.notesUpdatedAt && round.notesUpdatedBy && (
          <span className="text-[13px] text-muted">
            <AuthorName author={round.notesUpdatedBy} /> · <Time ms={round.notesUpdatedAt} />
          </span>
        )}
        {!editing && !round.notesUpdatedAt && <span className="text-[13px] text-muted">아직 작성되지 않음</span>}
      </div>

      {editing ? (
        <NotesEditor round={round} onClose={() => setEditing(false)} />
      ) : isEmptyNotes(saved) ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-5 text-sm text-muted">
          <p>
            {canWrite
              ? "모임이 끝나면 핵심 논의, 남은 질문, 다음 행동을 남겨 주세요. 스터디 멤버 누구나 쓸 수 있어요."
              : "아직 모임 기록이 없습니다."}
          </p>
          {canWrite && (
            <button type="button" className={btn.secondary} onClick={() => setEditing(true)}>
              기록 작성
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {NOTES_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1.5">
              <h3 className="text-sm font-bold text-muted">{f.label}</h3>
              {saved[f.key].trim() ? <Markdown source={saved[f.key]} /> : <p className="text-sm text-muted">—</p>}
            </div>
          ))}
          {canWrite && (
            <div>
              <button type="button" className={btn.secondary} onClick={() => setEditing(true)}>
                기록 편집
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function NotesEditor({ round, onClose }: { round: RoundDetail; onClose: () => void }) {
  const me = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow(15_000);
  const [initial] = useState(() => {
    const draft = loadKeyedDraft<NotesValues>(me.id, NOTES_DRAFT_KIND, round.id);
    return draft
      ? { values: { ...notesOf(round), ...draft.values }, baseVersion: draft.baseVersion, restoredAt: draft.savedAt }
      : { values: notesOf(round), baseVersion: round.notesVersion, restoredAt: null as number | null };
  });
  const [values, setValues] = useState<NotesValues>(initial.values);
  // TSD 8.2 step 1: the version editing started from; after a conflict, the latest one.
  const [baseVersion, setBaseVersion] = useState(initial.baseVersion);
  const [conflict, setConflict] = useState<Round | null>(null);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(initial.restoredAt);
  const [draftFailed, setDraftFailed] = useState(false);
  const submitted = useRef(false);
  const top = useRef<HTMLDivElement>(null);

  const set = (k: keyof NotesValues, v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      if (submitted.current) return;
      const savedAt = Date.now();
      const ok = saveKeyedDraft(me.id, NOTES_DRAFT_KIND, round.id, { savedAt, baseVersion, values });
      setDraftFailed(!ok);
      if (ok) setLastSavedAt(savedAt);
    }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [dirty, values, baseVersion, me.id, round.id]);

  const save = useMutation({
    mutationFn: () => api.patchRoundNotes(round.id, { notesVersion: baseVersion, ...values }),
    onSuccess: async (updated) => {
      submitted.current = true;
      clearKeyedDraft(me.id, NOTES_DRAFT_KIND, round.id);
      queryClient.setQueryData<RoundDetail>(queryKeys.round(round.id), (prev) => (prev ? { ...prev, ...updated } : prev));
      await queryClient.invalidateQueries({ queryKey: queryKeys.round(round.id) });
      onClose();
      toast("모임 기록을 저장했습니다");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "VERSION_CONFLICT" && isRound(err.latest)) {
        const latest = err.latest;
        setConflict(latest);
        setBaseVersion(latest.notesVersion);
        // Keep the draft pointing at the version I have now seen.
        saveKeyedDraft(me.id, NOTES_DRAFT_KIND, round.id, { savedAt: Date.now(), baseVersion: latest.notesVersion, values });
      }
      top.current?.focus();
    },
  });

  const cancel = () => {
    clearKeyedDraft(me.id, NOTES_DRAFT_KIND, round.id);
    onClose();
  };

  const field = (f: (typeof NOTES_FIELDS)[number]) => (
    <MarkdownField
      label={f.label}
      optional
      value={values[f.key]}
      onChange={(v) => set(f.key, v)}
      maxLength={LIMITS.markdownMax}
      minHeight="min-h-32"
      placeholder={f.hint}
    />
  );

  const status = draftFailed
    ? "임시저장 안 됨 · 브라우저 저장소를 쓸 수 없습니다"
    : lastSavedAt !== null
      ? `임시저장됨 · ${now - lastSavedAt < 60_000 ? "방금" : formatRelative(lastSavedAt, now)}`
      : "";

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <div ref={top} tabIndex={-1} className="flex flex-col gap-3 outline-none empty:hidden">
        {initial.restoredAt !== null && !conflict && (
          <Alert kind="info">{formatFull(initial.restoredAt)}에 임시저장된 기록을 불러왔습니다.</Alert>
        )}
        {save.isError && !conflict && <Alert>저장하지 못했습니다: {errorMessage(save.error)}</Alert>}
      </div>

      {conflict ? (
        <ConflictCompare
          updatedBy={
            conflict.notesUpdatedBy && conflict.notesUpdatedAt ? (
              <span>
                (<AuthorName author={conflict.notesUpdatedBy} /> · <Time ms={conflict.notesUpdatedAt} />)
              </span>
            ) : undefined
          }
          fields={NOTES_FIELDS.map((f) => {
            const latest = conflict[f.key] ?? "";
            return {
              key: f.key,
              label: f.label,
              latest,
              markdown: true,
              same: latest === values[f.key],
              mine: field(f),
              onUseLatest: () => set(f.key, latest),
            };
          })}
        />
      ) : (
        NOTES_FIELDS.map((f) => <div key={f.key}>{field(f)}</div>)
      )}

      <FormBar status={status}>
        <button type="button" className={btn.secondary} onClick={cancel} disabled={save.isPending}>
          취소
        </button>
        <button type="submit" className={btn.primary} disabled={save.isPending}>
          {save.isPending ? "저장 중…" : conflict ? "합쳐서 저장" : "기록 저장"}
        </button>
      </FormBar>
    </form>
  );
}

function isRound(v: unknown): v is Round {
  return typeof v === "object" && v !== null && typeof (v as Round).notesVersion === "number";
}
