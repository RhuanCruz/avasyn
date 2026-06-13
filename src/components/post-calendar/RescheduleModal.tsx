import { useState } from "react";
import { toast } from "sonner";

import { Icon, Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { computeSlots } from "@/lib/calendar-utils";
import { invokeFunction } from "@/lib/api";

const DAYS = [
  { label: "Dom", value: 0 },
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sáb", value: 6 },
];

const DAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

type Props = {
  avatarId: string;
  pendingCount: number;
  onClose: () => void;
  onRescheduled: () => void;
};

type RescheduleResponse = { updated: number; total: number };

export function RescheduleModal({ avatarId, pendingCount, onClose, onRescheduled }: Props) {
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [timesText, setTimesText] = useState("09:00, 18:00");
  const [saving, setSaving] = useState(false);

  const parsedTimes = timesText
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t));

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  const previewSlots = computeSlots({
    weekdays,
    times: parsedTimes,
    count: Math.min(pendingCount, 4),
  });

  async function handleSave() {
    if (weekdays.length === 0 || parsedTimes.length === 0) return;

    setSaving(true);
    try {
      const resp = await invokeFunction<RescheduleResponse>("reschedule-posts", {
        avatarId,
        schedule: { weekdays, times: parsedTimes, timezone: "America/Sao_Paulo" },
      });
      const { updated, total } = resp;
      if (total === 0) {
        toast.info("Nenhum post pendente para reagendar");
      } else {
        toast.success(`${updated} de ${total} post${total !== 1 ? "s" : ""} reagendado${total !== 1 ? "s" : ""}`);
      }
      onRescheduled();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao reagendar");
    } finally {
      setSaving(false);
    }
  }

  const canSave = weekdays.length > 0 && parsedTimes.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 480, padding: 20 }}
      >
        <div className="flex items-start justify-between gap-3" style={{ marginBottom: 20 }}>
          <div>
            <h2 className="text-lg">Editar configuração de agenda</h2>
            <p className="text-sm muted" style={{ marginTop: 4 }}>
              Os {pendingCount} post{pendingCount !== 1 ? "s" : ""} pendente{pendingCount !== 1 ? "s" : ""} serão redistribuídos nos novos slots.
              Posts já publicados ou em publicação não são alterados.
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        <FieldGroup>
          <Field>
            <FieldLabel>Dias da semana</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {DAYS.map(({ label, value }) => (
                <button
                  className={`tab ${weekdays.includes(value) ? "active" : ""}`}
                  key={value}
                  onClick={() => toggleDay(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field>
            <FieldLabel>
              Horários
              <span className="text-xs muted ml-2">separados por vírgula</span>
            </FieldLabel>
            <input
              className="input"
              onChange={(e) => setTimesText(e.target.value)}
              placeholder="09:00, 18:00"
              value={timesText}
            />
            {parsedTimes.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {parsedTimes.map((t) => (
                  <Pill key={t} tone="base">{t}</Pill>
                ))}
              </div>
            )}
          </Field>

          {previewSlots.length > 0 && (
            <Field>
              <FieldLabel>Prévia dos primeiros slots</FieldLabel>
              <div className="col" style={{ gap: 4 }}>
                {previewSlots.map((slot, i) => {
                  const d = new Date(slot);
                  return (
                    <div className="flex items-center gap-2 text-sm" key={slot}>
                      <Pill tone="neutral">{i + 1}</Pill>
                      <span>
                        {DAY_NAMES[d.getDay()]}, {d.getDate()} {MONTH_NAMES[d.getMonth()]} às {slot.slice(11, 16)}
                      </span>
                    </div>
                  );
                })}
                {pendingCount > 4 && (
                  <span className="text-xs muted">+ {pendingCount - 4} slots adicionais...</span>
                )}
              </div>
            </Field>
          )}
        </FieldGroup>

        <div className="flex justify-end gap-2" style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <Button disabled={saving} onClick={onClose} variant="outline">Cancelar</Button>
          <Button disabled={!canSave || saving} onClick={() => void handleSave()}>
            {saving ? "Reagendando..." : "Salvar nova agenda"}
          </Button>
        </div>
      </div>
    </div>
  );
}
