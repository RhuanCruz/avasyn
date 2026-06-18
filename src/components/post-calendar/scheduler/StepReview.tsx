import { useState } from "react";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { computeSlots } from "@/lib/calendar-utils";
import { invokeFunction } from "@/lib/api";
import type { SocialAccount, SocialPlatform } from "@/lib/types";

import type { WizardState } from "./types";

type Props = {
  avatarId: string;
  onBack: () => void;
  onScheduled: () => void;
  selectedAccounts: SocialAccount[];
  state: WizardState;
};

type SchedulePostsResponse = {
  created: number;
  scheduled: number;
};

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
};

export function StepReview({ avatarId, onBack, onScheduled, selectedAccounts, state }: Props) {
  const [submitting, setSubmitting] = useState(false);

  const { items, reactConfig, scheduleConfig } = state;
  const renderedItems = items.filter((item) => item.kind === "rendered_job");
  const rawItems = items.filter((item) => item.kind !== "rendered_job");

  const previewSlots = computeSlots({
    weekdays: scheduleConfig.weekdays,
    times: scheduleConfig.times,
    count: Math.min(items.length, 5),
  });

  const allSlots = computeSlots({
    weekdays: scheduleConfig.weekdays,
    times: scheduleConfig.times,
    count: items.length,
  });

  const lastSlot = allSlots[allSlots.length - 1];
  const lastDate = lastSlot ? new Date(lastSlot) : null;

  async function handleSubmit() {
    if (selectedAccounts.length === 0) {
      toast.error("Selecione pelo menos uma rede para postar");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        avatarId,
        accountIds: selectedAccounts.map((a) => a.id),
        reactionIds: rawItems.length > 0 ? reactConfig.reactionIds : undefined,
        overlayPhrases: rawItems.length > 0 ? reactConfig.overlayPhrases : undefined,
        captions: rawItems.length > 0 ? reactConfig.captions : undefined,
        hashtags: rawItems.length > 0 && reactConfig.hashtags ? reactConfig.hashtags : undefined,
        items: items.map((item) => {
          if (item.kind === "rendered_job") return { kind: "rendered_job", jobId: item.jobId };
          if (item.kind === "library") return { kind: "library", sourceVideoId: item.sourceVideoId, overlayText: item.overlayText, caption: item.caption };
          return { kind: "url", url: item.url, overlayText: item.overlayText, caption: item.caption };
        }),
        schedule: {
          weekdays: scheduleConfig.weekdays,
          times: scheduleConfig.times,
          timezone: "America/Sao_Paulo",
        },
      };

      const resp = await invokeFunction<SchedulePostsResponse>("schedule-posts", payload);
      const total = (resp.created ?? 0) + (resp.scheduled ?? 0);
      toast.success(`${total} post${total !== 1 ? "s" : ""} agendado${total !== 1 ? "s" : ""} com sucesso`);
      onScheduled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao agendar posts");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="col" style={{ gap: 12 }}>
        <div className="card card-pad" style={{ padding: 14 }}>
          <div className="text-md" style={{ marginBottom: 10 }}>Resumo</div>
          <div className="grid gap-2">
            <SummaryRow label="Redes">
              <div className="flex flex-wrap gap-1">
                {selectedAccounts.map((a) => (
                  <Pill key={a.id} tone="base">
                    <Icon name={a.platform} size={11} style={{ marginRight: 4 }} />
                    {a.username ?? a.display_name} · {PLATFORM_LABELS[a.platform]}
                  </Pill>
                ))}
              </div>
            </SummaryRow>
            <SummaryRow label="Posts selecionados">
              <div className="flex flex-wrap gap-1">
                <Pill tone="violet">{items.length} total</Pill>
                {renderedItems.length > 0 && <Pill tone="ok">{renderedItems.length} prontos</Pill>}
                {rawItems.length > 0 && <Pill tone="info">{rawItems.length} p/ renderizar</Pill>}
              </div>
            </SummaryRow>
            <SummaryRow label="Dias">
              <div className="flex flex-wrap gap-1">
                {scheduleConfig.weekdays.map((d) => (
                  <Pill key={d} tone="base">{DAY_NAMES[d]}</Pill>
                ))}
              </div>
            </SummaryRow>
            <SummaryRow label="Horários">
              <div className="flex flex-wrap gap-1">
                {scheduleConfig.times.map((t) => (
                  <Pill key={t} tone="base">{t}</Pill>
                ))}
              </div>
            </SummaryRow>
            {rawItems.length > 0 && (
              <SummaryRow label="Reactions">
                <Pill tone="violet">{reactConfig.reactionIds.length} selecionada{reactConfig.reactionIds.length !== 1 ? "s" : ""}</Pill>
              </SummaryRow>
            )}
            {lastDate && (
              <SummaryRow label="Último slot">
                <span>{DAY_NAMES[lastDate.getDay()]}, {lastDate.getDate()} {MONTH_NAMES[lastDate.getMonth()]} às {lastSlot!.slice(11, 16)}</span>
              </SummaryRow>
            )}
          </div>
        </div>

        {previewSlots.length > 0 && (
          <div className="card card-pad" style={{ padding: 14 }}>
            <div className="text-md" style={{ marginBottom: 10 }}>
              Próximos slots
            </div>
            <div className="col" style={{ gap: 6 }}>
              {previewSlots.map((slot, i) => {
                const d = new Date(slot);
                const item = items[i];
                const label = item?.label ?? "";
                return (
                  <div className="flex items-center gap-3 text-sm" key={slot}>
                    <Pill tone="neutral">{i + 1}</Pill>
                    <div className="col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="text-xs muted">
                        {DAY_NAMES[d.getDay()]}, {d.getDate()} {MONTH_NAMES[d.getMonth()]} às {slot.slice(11, 16)}
                      </span>
                      <span className="truncate text-sm">{label}</span>
                    </div>
                  </div>
                );
              })}
              {items.length > 5 && (
                <span className="text-xs muted">+ {items.length - 5} post{items.length - 5 !== 1 ? "s" : ""} adicionais...</span>
              )}
            </div>
          </div>
        )}

        {rawItems.length > 0 && (
          <div className="card card-pad" style={{ padding: 12 }}>
            <p className="text-sm muted">
              Os {rawItems.length} vídeo{rawItems.length !== 1 ? "s" : ""} da biblioteca/busca serão renderizados em segundo plano.
              O calendário reflete o progresso em tempo real.
            </p>
          </div>
        )}
      </div>

      <div className="wizard-footer">
        <Button disabled={submitting} onClick={onBack} variant="outline">Voltar</Button>
        <Button disabled={submitting || selectedAccounts.length === 0} onClick={() => void handleSubmit()}>
          {submitting ? "Agendando..." : `Agendar ${items.length} post${items.length !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm muted" style={{ minWidth: 110 }}>{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
