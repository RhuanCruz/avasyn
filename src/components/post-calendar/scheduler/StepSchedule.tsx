import { useState } from "react";

import { Pill } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { computeSlots } from "@/lib/calendar-utils";

import type { ScheduleConfig } from "./types";

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
const MONTH_NAMES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

type Props = {
  initialConfig: ScheduleConfig;
  itemCount: number;
  onBack: () => void;
  onNext: (config: ScheduleConfig) => void;
};

export function StepSchedule({ initialConfig, itemCount, onBack, onNext }: Props) {
  const [weekdays, setWeekdays] = useState<number[]>(initialConfig.weekdays);
  const [timesText, setTimesText] = useState(initialConfig.times.join(", "));

  function toggleDay(day: number) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()
    );
  }

  const parsedTimes = timesText
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t));

  const previewSlots = computeSlots({
    weekdays,
    times: parsedTimes,
    count: Math.min(itemCount, 5),
  });

  function handleNext() {
    onNext({ weekdays, times: parsedTimes });
  }

  const canNext = weekdays.length > 0 && parsedTimes.length > 0;

  return (
    <div className="col" style={{ gap: 20 }}>
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
            <span className="text-xs muted ml-2">separados por vírgula · ex: 09:00, 18:00</span>
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

        {itemCount > 0 && weekdays.length > 0 && parsedTimes.length > 0 && (
          <Field>
            <FieldLabel>
              Prévia dos slots
              <span className="text-xs muted ml-2">{itemCount} post{itemCount !== 1 ? "s" : ""} total</span>
            </FieldLabel>
            <div className="col" style={{ gap: 4 }}>
              {previewSlots.map((slot, i) => {
                const d = new Date(slot);
                const label = `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTH_NAMES[d.getMonth()]} · ${slot.slice(11, 16)}`;
                return (
                  <div className="flex items-center gap-2 text-sm" key={slot}>
                    <Pill tone="neutral">{i + 1}</Pill>
                    <span>{label}</span>
                  </div>
                );
              })}
              {itemCount > 5 && (
                <span className="text-xs muted">
                  + {itemCount - 5} slot{itemCount - 5 !== 1 ? "s" : ""} adicionais...
                </span>
              )}
            </div>
          </Field>
        )}
      </FieldGroup>

      <div className="wizard-footer">
        <Button onClick={onBack} variant="outline">Voltar</Button>
        <Button disabled={!canNext} onClick={handleNext}>
          Próximo
        </Button>
      </div>
    </div>
  );
}
