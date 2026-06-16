import { useState } from "react";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import type { SocialAccount } from "@/lib/types";

import { StepConfigureReact } from "./StepConfigureReact";
import { StepReview } from "./StepReview";
import { StepSchedule } from "./StepSchedule";
import { StepSelectContent } from "./StepSelectContent";
import type { ReactConfig, ScheduleConfig, ScheduleItem, WizardState } from "./types";

type Props = {
  avatarId: string;
  account: SocialAccount;
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

export function SchedulePostsWizard({ avatarId, account, onClose, onScheduled }: Props) {
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [step, setStep] = useState<Step>("content");

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
            <p className="text-sm muted">
              {account.username ?? account.display_name} · Instagram
            </p>
          </div>
          <Button onClick={onClose} size="sm" variant="outline">
            <Icon name="x" />
          </Button>
        </div>

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
              account={account}
              avatarId={avatarId}
              onBack={goBack}
              onScheduled={onScheduled}
              state={state}
            />
          )}
        </div>
      </div>
    </div>
  );
}
