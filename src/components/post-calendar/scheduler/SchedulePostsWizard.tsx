import { useState } from "react";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import type { SocialAccount, SocialPlatform } from "@/lib/types";

import { StepConfigureReact } from "./StepConfigureReact";
import { StepReview } from "./StepReview";
import { StepSchedule } from "./StepSchedule";
import { StepSelectContent } from "./StepSelectContent";
import type { ReactConfig, ScheduleConfig, ScheduleItem, WizardState } from "./types";

type Props = {
  avatarId: string;
  accounts: SocialAccount[];
  onClose: () => void;
  onScheduled: () => void;
};

type Step = "content" | "react" | "schedule" | "review";

const DEFAULT_STATE: WizardState = {
  items: [],
  reactConfig: {
    reactionIds: [],
    overlayPhrases: ["Olha isso", "Que lance", "Sem palavras", "Que cena", "Essa é braba"],
    captions: ["Essa reação diz tudo 🔥", "Sem palavras pra isso 😮", "React do dia 🎯"],
    hashtags: "#futebol #viral #reels",
  },
  scheduleConfig: {
    weekdays: [1, 3, 5],
    times: ["09:00", "18:00"],
  },
};

const STEP_LABELS: Record<Step, string> = {
  content: "Conteúdo",
  react: "React",
  schedule: "Agenda",
  review: "Revisão",
};

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
};

export function SchedulePostsWizard({ avatarId, accounts, onClose, onScheduled }: Props) {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [step, setStep] = useState<Step>("content");
  // Default: all active accounts selected
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(accounts.map((a) => a.id));

  const hasRawItems = state.items.some((item) => item.kind !== "rendered_job");
  const steps: Step[] = hasRawItems
    ? ["content", "react", "schedule", "review"]
    : ["content", "schedule", "review"];

  const stepIndex = steps.indexOf(step);

  function handleItemsConfirmed(items: ScheduleItem[]) {
    setState((prev) => ({ ...prev, items }));
    const nextHasRaw = items.some((item) => item.kind !== "rendered_job");
    setStep(nextHasRaw ? "react" : "schedule");
  }

  function handleReactConfirmed(reactConfig: ReactConfig, items: ScheduleItem[]) {
    setState((prev) => ({ ...prev, reactConfig, items }));
    setStep("schedule");
  }

  function handleScheduleConfirmed(scheduleConfig: ScheduleConfig) {
    setState((prev) => ({ ...prev, scheduleConfig }));
    setStep("review");
  }

  function goBack() {
    const prev = steps[stepIndex - 1];
    if (prev) setStep(prev);
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) => {
      if (prev.includes(id)) {
        // Don't allow deselecting the last account
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== id);
      }
      return [...prev, id];
    });
  }

  const selectedAccounts = accounts.filter((a) => selectedAccountIds.includes(a.id));

  const headerSubtitle = selectedAccounts.length === 0
    ? "Nenhuma rede selecionada"
    : selectedAccounts.length === 1
      ? `${selectedAccounts[0].username ?? selectedAccounts[0].display_name} · ${PLATFORM_LABELS[selectedAccounts[0].platform]}`
      : selectedAccounts.map((a) => PLATFORM_LABELS[a.platform]).join(" + ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
    >
      <div
        className="panel wizard-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="wizard-header">
          <div className="col" style={{ gap: 4 }}>
            <h2 className="text-lg">Agendar posts</h2>
            <p className="text-sm muted">{headerSubtitle}</p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

        {/* Platform selector — only shown when more than one account is connected */}
        {accounts.length > 1 && (
          <div className="flex items-center gap-2" style={{ padding: "8px 20px", borderBottom: "1px solid var(--border)" }}>
            <span className="text-xs muted" style={{ minWidth: 70 }}>Postar em:</span>
            {accounts.map((account) => {
              const selected = selectedAccountIds.includes(account.id);
              return (
                <button
                  key={account.id}
                  className="flex items-center gap-1 text-xs"
                  onClick={() => toggleAccount(account.id)}
                  style={{
                    background: selected ? "var(--accent-bg)" : "var(--surface-2)",
                    borderRadius: 6,
                    padding: "3px 10px",
                    border: `1px solid ${selected ? "var(--accent-hover)" : "var(--border)"}`,
                    color: selected ? "var(--accent-hover)" : "var(--text-muted)",
                    cursor: "pointer",
                  }}
                  type="button"
                >
                  <Icon name={account.platform} size={12} />
                  <span>{PLATFORM_LABELS[account.platform]}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="wizard-steps">
          {steps.map((s, idx) => (
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
          {step === "content" && (
            <StepSelectContent
              avatarId={avatarId}
              initialItems={state.items}
              onNext={handleItemsConfirmed}
            />
          )}
          {step === "react" && (
            <StepConfigureReact
              avatarId={avatarId}
              initialConfig={state.reactConfig}
              items={state.items}
              onBack={goBack}
              onNext={handleReactConfirmed}
            />
          )}
          {step === "schedule" && (
            <StepSchedule
              initialConfig={state.scheduleConfig}
              itemCount={state.items.length}
              onBack={goBack}
              onNext={handleScheduleConfirmed}
            />
          )}
          {step === "review" && (
            <StepReview
              avatarId={avatarId}
              onBack={goBack}
              onScheduled={onScheduled}
              selectedAccounts={selectedAccounts}
              state={state}
            />
          )}
        </div>
      </div>
    </div>
  );
}
