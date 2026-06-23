import { useMemo, useState } from "react";

import { Icon, Pill } from "@/components/operator-ui";
import { ReactionPositionModal } from "@/components/ReactionPositionModal";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Automation, ReactionVideo, SocialAccount } from "@/lib/types";

import {
  type AutomationDraft,
  type AutomationRow,
  activationBlockers,
  DAY_NAMES,
  draftFromAutomation,
  draftToRow,
  emptyDraft,
  MAX_POSTS_PER_DAY,
  MAX_QUERIES,
} from "./types";
import { normalizeQuery, normalizeTime, PillListInput, ViewCountInput } from "./WizardInputs";

type Props = {
  accounts: SocialAccount[];
  reactions: ReactionVideo[];
  existing: Automation | null;
  initialTheme?: string | null;
  onClose: () => void;
  onSave: (row: AutomationRow, activate: boolean) => Promise<void>;
  onReactionsRefresh?: () => void | Promise<void>;
};

type Step = "tema" | "reaction" | "textos" | "agenda" | "revisao";
const STEPS: Step[] = ["tema", "reaction", "textos", "agenda", "revisao"];
const STEP_LABELS: Record<Step, string> = {
  tema: "Tema",
  reaction: "Reaction",
  textos: "Textos",
  agenda: "Agenda",
  revisao: "Revisão",
};

const FOOTER_STYLE: React.CSSProperties = { padding: "16px 20px 20px" };

export function AutomationWizard({ accounts, reactions, existing, initialTheme, onClose, onSave, onReactionsRefresh }: Props) {
  const [draft, setDraft] = useState<AutomationDraft>(() => {
    if (existing) return draftFromAutomation(existing);
    const base = emptyDraft();
    const theme = initialTheme?.trim();
    return theme ? { ...base, search_queries: [theme] } : base;
  });
  const [step, setStep] = useState<Step>("tema");
  const [saving, setSaving] = useState(false);
  const [positioning, setPositioning] = useState<ReactionVideo | null>(null);

  const selectedReactions = reactions.filter((r) => draft.reaction_pool.includes(r.id));

  const stepIndex = STEPS.indexOf(step);
  const set = (patch: Partial<AutomationDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const blockers = useMemo(() => activationBlockers(draft), [draft]);
  const queriesCount = draft.search_queries.filter((q) => q.trim()).length;

  function goNext() {
    const next = STEPS[stepIndex + 1];
    if (next) setStep(next);
  }
  function goBack() {
    const prev = STEPS[stepIndex - 1];
    if (prev) setStep(prev);
  }

  async function save(activate: boolean) {
    setSaving(true);
    try {
      await onSave(draftToRow(draft), activate);
    } finally {
      setSaving(false);
    }
  }

  const canAdvanceTema = draft.name.trim().length > 0 && queriesCount > 0;
  const canAdvanceReaction = draft.reaction_pool.length > 0;

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div className="panel wizard-panel" onClick={(e) => e.stopPropagation()}>
        <div className="wizard-header">
          <div className="col" style={{ gap: 4 }}>
            <h2 className="text-lg">{existing ? "Editar automação" : "Nova automação"}</h2>
            <p className="text-sm muted">Busca → reaction → render → agenda, no automático</p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        <div className="wizard-steps">
          {STEPS.map((s, idx) => (
            <div
              className={`wizard-step ${s === step ? "active" : idx < stepIndex ? "done" : ""}`}
              key={s}
            >
              <span className="wizard-step-num">
                {idx < stepIndex ? <Icon name="check" size={12} /> : idx + 1}
              </span>
              <span className="wizard-step-label">{STEP_LABELS[s]}</span>
            </div>
          ))}
        </div>

        <div className="wizard-body">
          {step === "tema" && (
            <FieldGroup>
              <Field>
                <FieldLabel>Nome da automação</FieldLabel>
                <Input
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Ex: Reacts de futebol"
                  value={draft.name}
                />
              </Field>
              <Field>
                <FieldLabel>
                  Temas de busca
                  <span className="text-xs muted ml-2">escreva e adicione · máx. {MAX_QUERIES}</span>
                </FieldLabel>
                <PillListInput
                  normalize={normalizeQuery}
                  onChange={(v) => set({ search_queries: v.slice(0, MAX_QUERIES) })}
                  placeholder="Ex: Neymar edits"
                  values={draft.search_queries}
                />
              </Field>
              <Field>
                <FieldLabel>Fonte</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Pill tone="violet"><Icon name="youtube" size={11} style={{ marginRight: 4 }} />YouTube Shorts</Pill>
                  <Pill tone="neutral">TikTok · em breve</Pill>
                  <Pill tone="neutral">Instagram · em breve</Pill>
                </div>
              </Field>
              <div className="grid gap-3 grid-cols-3">
                <Field>
                  <FieldLabel>Views mínimas</FieldLabel>
                  <ViewCountInput onChange={(v) => set({ min_view_count: v })} value={draft.min_view_count} />
                </Field>
                <Field>
                  <FieldLabel>Duração máx (s)</FieldLabel>
                  <Input
                    onChange={(e) => set({ max_duration_s: Number(e.target.value) })}
                    type="number"
                    value={draft.max_duration_s}
                  />
                </Field>
                <Field>
                  <FieldLabel>Últimos (dias)</FieldLabel>
                  <Input
                    onChange={(e) => set({ recent_days: Number(e.target.value) })}
                    type="number"
                    value={draft.recent_days}
                  />
                </Field>
              </div>
            </FieldGroup>
          )}

          {step === "reaction" && (
            <Field>
              <FieldLabel>
                Reactions
                <span className="text-xs muted ml-2">sorteadas a cada execução · posição se ajusta na Biblioteca</span>
              </FieldLabel>
              {reactions.length === 0 ? (
                <div className="empty" style={{ padding: "24px 12px" }}>
                  <div>
                    <h3>Nenhuma reaction</h3>
                    <p>Adicione reactions a este avatar na Biblioteca.</p>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2 grid-cols-3 sm:grid-cols-4">
                  {reactions.map((reaction) => {
                    const selected = draft.reaction_pool.includes(reaction.id);
                    return (
                      <button
                        className={`content-select-card ${selected ? "selected" : ""}`}
                        key={reaction.id}
                        onClick={() =>
                          set({
                            reaction_pool: selected
                              ? draft.reaction_pool.filter((r) => r !== reaction.id)
                              : [...draft.reaction_pool, reaction.id],
                          })
                        }
                        type="button"
                      >
                        <StorageVideoPreview
                          aspect="reel"
                          bucket="reaction-videos"
                          path={reaction.storage_path}
                          showTitle={false}
                          title={reaction.name}
                        />
                        {selected && (
                          <div className="content-select-check">
                            <Icon name="check" size={14} />
                          </div>
                        )}
                        <p className="truncate text-xs mt-1 muted">{reaction.name}</p>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedReactions.length > 0 && (
                <div className="col" style={{ gap: 8, marginTop: 10 }}>
                  <div className="flex items-center gap-2">
                    <Pill tone="violet">{selectedReactions.length} no pool</Pill>
                    <span className="text-xs muted">posicione cada reaction para não cortar o rosto no split</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedReactions.map((r) => (
                      <button
                        className="tab"
                        key={r.id}
                        onClick={() => setPositioning(r)}
                        type="button"
                      >
                        <Icon name="reaction" size={12} style={{ marginRight: 4 }} />
                        {r.name}
                        <Icon name="edit" size={11} style={{ marginLeft: 6, opacity: 0.7 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </Field>
          )}

          {step === "textos" && (
            <FieldGroup>
              <TextModeField
                allowNone
                label="Divisão (overlay)"
                mode={draft.overlay_mode}
                onMode={(m) => set({ overlay_mode: m })}
                fixedValue={draft.overlay_text}
                onFixed={(v) => set({ overlay_text: v })}
                ideas={draft.overlay_ideas}
                onIdeas={(v) => set({ overlay_ideas: v })}
                aiInstructions={draft.overlay_ai_instructions}
                onAiInstructions={(v) => set({ overlay_ai_instructions: v })}
                fixedPlaceholder="OLHA ISSO"
                ideasPlaceholder="Olha isso"
                aiPlaceholder="Ex: estilo provocativo, sempre em CAIXA ALTA"
                aiHint="Overlay genérico de até 3 palavras. Se a OpenAI falhar, a execução falha."
                noneHint="Sem texto de overlay no vídeo."
              />
              <TextModeField
                label="Legenda"
                mode={draft.caption_mode}
                onMode={(m) => set({ caption_mode: m === "none" ? "fixed" : m })}
                fixedValue={draft.caption_template}
                onFixed={(v) => set({ caption_template: v })}
                ideas={draft.caption_ideas}
                onIdeas={(v) => set({ caption_ideas: v })}
                aiInstructions={draft.caption_ai_instructions}
                onAiInstructions={(v) => set({ caption_ai_instructions: v })}
                fixedPlaceholder="React do dia 🔥 #futebol"
                ideasPlaceholder="React novo no ar."
                aiPlaceholder="Ex: tom empolgado, 1-2 frases, termine com #futebol #neymar"
                aiHint="Instrua o estilo, tamanho e hashtags da legenda. Se a OpenAI falhar, a execução falha."
              />
            </FieldGroup>
          )}

          {step === "agenda" && (
            <FieldGroup>
              <Field>
                <FieldLabel>
                  Contas de destino
                  <span className="text-xs muted ml-2">uma ou mais</span>
                </FieldLabel>
                {accounts.length === 0 ? (
                  <p className="text-xs muted">Nenhuma conta conectada — você pode salvar como rascunho.</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {accounts.map((a) => {
                      const on = draft.account_ids.includes(a.id);
                      return (
                        <button
                          className={`tab ${on ? "active" : ""}`}
                          key={a.id}
                          onClick={() =>
                            set({
                              account_ids: on
                                ? draft.account_ids.filter((x) => x !== a.id)
                                : [...draft.account_ids, a.id],
                            })
                          }
                          type="button"
                        >
                          <Icon name={a.platform} size={12} style={{ marginRight: 4 }} />
                          {a.username ?? a.display_name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Field>
              <Field>
                <FieldLabel>Dias da semana</FieldLabel>
                <div className="flex flex-wrap gap-1">
                  {DAY_NAMES.map((name, day) => {
                    const on = draft.days_of_week.includes(day);
                    return (
                      <button
                        className={`tab ${on ? "active" : ""}`}
                        key={day}
                        onClick={() =>
                          set({
                            days_of_week: on
                              ? draft.days_of_week.filter((d) => d !== day)
                              : [...draft.days_of_week, day],
                          })
                        }
                        type="button"
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field>
                <FieldLabel>
                  Horários do dia
                  <span className="text-xs muted ml-2">cada horário = 1 post · máx. {MAX_POSTS_PER_DAY}/dia</span>
                </FieldLabel>
                <PillListInput
                  normalize={normalizeTime}
                  onChange={(v) => set({ post_times: v.slice(0, MAX_POSTS_PER_DAY) })}
                  placeholder="09:00"
                  values={draft.post_times}
                />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={draft.share_to_feed}
                  onChange={(e) => set({ share_to_feed: e.target.checked })}
                  type="checkbox"
                />
                Compartilhar no feed (Instagram)
              </label>
              <p className="text-xs muted">Fuso: America/Sao_Paulo</p>
            </FieldGroup>
          )}

          {step === "revisao" && (
            <ReviewStep accounts={accounts} draft={draft} reactionCount={draft.reaction_pool.length} />
          )}
        </div>

        <div className="wizard-footer" style={FOOTER_STYLE}>
          {stepIndex > 0 ? (
            <Button onClick={goBack} variant="outline">Voltar</Button>
          ) : (
            <Button onClick={onClose} variant="outline">Cancelar</Button>
          )}

          {step !== "revisao" ? (
            <Button
              disabled={
                (step === "tema" && !canAdvanceTema) ||
                (step === "reaction" && !canAdvanceReaction)
              }
              onClick={goNext}
            >
              Próximo
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button disabled={saving} onClick={() => void save(false)} variant="outline">
                Salvar rascunho
              </Button>
              <Button disabled={saving || blockers.length > 0} onClick={() => void save(true)}>
                {blockers.length > 0 ? `Falta: ${blockers[0]}` : "Salvar e ativar"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
    {positioning && (
      <ReactionPositionModal
        onClose={() => setPositioning(null)}
        onSaved={onReactionsRefresh}
        reaction={positioning}
      />
    )}
    </>
  );
}

function TextModeField({
  label,
  mode,
  onMode,
  fixedValue,
  onFixed,
  ideas,
  onIdeas,
  aiInstructions,
  onAiInstructions,
  fixedPlaceholder,
  ideasPlaceholder,
  aiPlaceholder,
  aiHint,
  allowNone = false,
  noneHint,
}: {
  label: string;
  mode: "none" | "fixed" | "ideas" | "ai";
  onMode: (m: "none" | "fixed" | "ideas" | "ai") => void;
  fixedValue: string;
  onFixed: (v: string) => void;
  ideas: string[];
  onIdeas: (v: string[]) => void;
  aiInstructions: string;
  onAiInstructions: (v: string) => void;
  fixedPlaceholder: string;
  ideasPlaceholder: string;
  aiPlaceholder: string;
  aiHint: string;
  allowNone?: boolean;
  noneHint?: string;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select onChange={(e) => onMode(e.target.value as "none" | "fixed" | "ideas" | "ai")} value={mode}>
        {allowNone && <option value="none">Nenhum (sem overlay)</option>}
        <option value="fixed">Texto fixo</option>
        <option value="ideas">Sortear ideias</option>
        <option value="ai">Gerar com IA</option>
      </Select>
      {mode === "none" && noneHint && <p className="text-xs muted">{noneHint}</p>}
      {mode === "fixed" && (
        <Input onChange={(e) => onFixed(e.target.value)} placeholder={fixedPlaceholder} value={fixedValue} />
      )}
      {mode === "ideas" && (
        <PillListInput
          normalize={(raw) => (raw.trim() ? raw.trim() : null)}
          onChange={onIdeas}
          placeholder={ideasPlaceholder}
          values={ideas}
        />
      )}
      {mode === "ai" && (
        <>
          <Textarea
            onChange={(e) => onAiInstructions(e.target.value)}
            placeholder={aiPlaceholder}
            rows={3}
            value={aiInstructions}
          />
          <p className="text-xs muted">{aiHint}</p>
        </>
      )}
    </Field>
  );
}

function ReviewStep({
  accounts,
  draft,
  reactionCount,
}: {
  accounts: SocialAccount[];
  draft: AutomationDraft;
  reactionCount: number;
}) {
  const selectedAccounts = accounts.filter((a) => draft.account_ids.includes(a.id));
  const times = draft.post_times.filter(Boolean);
  const perWeek = draft.days_of_week.length * times.length;
  const modeLabel = (m: string) =>
    m === "none" ? "nenhum" : m === "fixed" ? "fixo" : m === "ideas" ? "ideias" : "IA";

  return (
    <div className="card card-pad" style={{ padding: 14 }}>
      <div className="grid gap-2">
        <Row label="Tema">{draft.search_queries.filter(Boolean).join(" · ") || "—"}</Row>
        <Row label="Fonte">YouTube Shorts</Row>
        <Row label="Reactions">{reactionCount} no pool</Row>
        <Row label="Divisão">{modeLabel(draft.overlay_mode)}</Row>
        <Row label="Legenda">{modeLabel(draft.caption_mode)}</Row>
        <Row label="Dias">{draft.days_of_week.map((d) => DAY_NAMES[d]).join(", ") || "—"}</Row>
        <Row label="Horários">{times.join(", ") || "—"}</Row>
        <Row label="Contas">
          {selectedAccounts.length > 0
            ? selectedAccounts.map((a) => a.username ?? a.display_name).join(", ")
            : "—"}
        </Row>
        <Row label="Estimativa"><Pill tone="info">~{perWeek} posts/semana</Pill></Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm muted" style={{ minWidth: 90 }}>{label}</span>
      <div className="flex-1 text-sm">{children}</div>
    </div>
  );
}
