import { useCallback, useState } from "react";

import { Icon, Pill } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo } from "@/lib/types";

import type { ReactConfig, ScheduleItem } from "./types";

type Props = {
  avatarId: string;
  initialConfig: ReactConfig;
  items: ScheduleItem[];
  onBack: () => void;
  onNext: (config: ReactConfig, items: ScheduleItem[]) => void;
};

type PerItemOverride = { overlayText: string; caption: string };

export function StepConfigureReact({ avatarId, initialConfig, items, onBack, onNext }: Props) {
  const [selectedReactionIds, setSelectedReactionIds] = useState<string[]>(initialConfig.reactionIds);
  const [overlayText, setOverlayText] = useState(initialConfig.overlayPhrases.join("\n"));
  const [captionsText, setCaptionsText] = useState(initialConfig.captions.join("\n"));
  const [hashtags, setHashtags] = useState(initialConfig.hashtags);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  // Per-video overrides keyed by index in the full items array (stable for the session).
  const rawItemIndexes = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item.kind !== "rendered_job");

  const [overrides, setOverrides] = useState<Record<number, PerItemOverride>>(() => {
    const initial: Record<number, PerItemOverride> = {};
    for (const { item, idx } of rawItemIndexes) {
      if (item.kind === "rendered_job") continue;
      initial[idx] = { overlayText: item.overlayText ?? "", caption: item.caption ?? "" };
    }
    return initial;
  });

  function setOverride(idx: number, field: keyof PerItemOverride, value: string) {
    setOverrides((prev) => ({
      ...prev,
      [idx]: { overlayText: "", caption: "", ...prev[idx], [field]: value },
    }));
  }

  const customizedCount = rawItemIndexes.filter(
    ({ idx }) => overrides[idx]?.overlayText.trim() || overrides[idx]?.caption.trim(),
  ).length;

  const loadReactions = useCallback(async (): Promise<ReactionVideo[]> => {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .eq("avatar_id", avatarId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as ReactionVideo[];
  }, [avatarId]);

  const reactionsQuery = useSupabaseQuery(loadReactions, []);

  function toggleReaction(id: string) {
    setSelectedReactionIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  function handleNext() {
    const overlayPhrases = overlayText.split("\n").map((s) => s.trim()).filter(Boolean);
    const captions = captionsText.split("\n").map((s) => s.trim()).filter(Boolean);

    const updatedItems = items.map((item, idx) => {
      if (item.kind === "rendered_job") return item;
      const ov = overrides[idx];
      return {
        ...item,
        overlayText: ov?.overlayText.trim() || undefined,
        caption: ov?.caption.trim() || undefined,
      };
    });

    onNext(
      {
        reactionIds: selectedReactionIds,
        overlayPhrases: overlayPhrases.length > 0 ? overlayPhrases : initialConfig.overlayPhrases,
        captions: captions.length > 0 ? captions : initialConfig.captions,
        hashtags: hashtags.trim(),
      },
      updatedItems,
    );
  }

  const canNext = selectedReactionIds.length > 0;

  return (
    <div className="col" style={{ gap: 20 }}>
      <FieldGroup>
        <Field>
          <FieldLabel>
            Reactions
            <span className="text-xs muted ml-2">serão intercaladas em round-robin</span>
          </FieldLabel>
          {reactionsQuery.loading ? (
            <p className="text-sm muted">Carregando reactions...</p>
          ) : reactionsQuery.data.length === 0 ? (
            <div className="empty" style={{ padding: "24px 12px" }}>
              <div>
                <h3>Nenhuma reaction</h3>
                <p>Adicione reactions a este avatar na biblioteca.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 grid-cols-3 sm:grid-cols-4">
              {reactionsQuery.data.map((reaction) => {
                const isSelected = selectedReactionIds.includes(reaction.id);
                return (
                  <button
                    className={`content-select-card ${isSelected ? "selected" : ""}`}
                    key={reaction.id}
                    onClick={() => toggleReaction(reaction.id)}
                    type="button"
                  >
                    <StorageVideoPreview
                      aspect="reel"
                      bucket="reaction-videos"
                      path={reaction.storage_path}
                      showTitle={false}
                      title={reaction.name}
                    />
                    {isSelected && (
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
          {selectedReactionIds.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <Pill tone="violet">
                {selectedReactionIds.length} reaction{selectedReactionIds.length !== 1 ? "s" : ""} selecionada{selectedReactionIds.length !== 1 ? "s" : ""}
              </Pill>
            </div>
          )}
        </Field>

        <Field>
          <FieldLabel>
            Frases de overlay
            <span className="text-xs muted ml-2">uma por linha · sistema sorteia</span>
          </FieldLabel>
          <Textarea
            onChange={(e) => setOverlayText(e.target.value)}
            placeholder={"Olha isso\nQue lance\nSem palavras\nQue cena"}
            rows={5}
            value={overlayText}
          />
          <p className="text-xs muted">Use frases curtas e universais (máx. 3 palavras) que funcionem para qualquer vídeo.</p>
        </Field>

        <Field>
          <FieldLabel>
            Legendas
            <span className="text-xs muted ml-2">uma por linha · sistema sorteia</span>
          </FieldLabel>
          <Textarea
            onChange={(e) => setCaptionsText(e.target.value)}
            placeholder={"Essa reação diz tudo 🔥\nSem palavras pra isso 😮\nReact do dia 🎯"}
            rows={4}
            value={captionsText}
          />
        </Field>

        <Field>
          <FieldLabel>
            Hashtags
            <span className="text-xs muted ml-2">anexadas a cada legenda</span>
          </FieldLabel>
          <input
            className="input"
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#futebol #viral #reels"
            value={hashtags}
          />
        </Field>
      </FieldGroup>

      {rawItemIndexes.length > 0 && (
        <div className="card card-pad" style={{ padding: 14 }}>
          <button
            className="flex items-center justify-between w-full"
            onClick={() => setCustomizeOpen((o) => !o)}
            type="button"
          >
            <div className="col items-start" style={{ gap: 2 }}>
              <span className="text-md">Personalizar por vídeo</span>
              <span className="text-xs muted">
                opcional · vazio = sistema sorteia das listas acima
                {customizedCount > 0 ? ` · ${customizedCount} personalizado${customizedCount !== 1 ? "s" : ""}` : ""}
              </span>
            </div>
            <Icon
              name="chevron-down"
              size={16}
              style={{ transform: customizeOpen ? "rotate(180deg)" : undefined }}
            />
          </button>

          {customizeOpen && (
            <div className="col" style={{ gap: 14, marginTop: 14 }}>
              {rawItemIndexes.map(({ item, idx }) => {
                if (item.kind === "rendered_job") return null;
                const ov = overrides[idx] ?? { overlayText: "", caption: "" };
                return (
                  <div className="flex gap-3" key={idx} style={{ alignItems: "flex-start" }}>
                    <div style={{ width: 56, flexShrink: 0 }}>
                      {item.kind === "library" && item.storagePath ? (
                        <StorageVideoPreview
                          aspect="reel"
                          bucket="source-videos"
                          path={item.storagePath}
                          showTitle={false}
                          title={item.label}
                        />
                      ) : item.kind === "url" && item.thumbnailUrl ? (
                        <img
                          alt={item.label}
                          className="aspect-[9/16] w-full overflow-hidden rounded-md object-cover"
                          loading="lazy"
                          src={item.thumbnailUrl}
                        />
                      ) : (
                        <div className="aspect-[9/16] w-full rounded-md bg-secondary" />
                      )}
                    </div>
                    <div className="col flex-1" style={{ gap: 6, minWidth: 0 }}>
                      <span className="truncate text-xs muted">{item.label}</span>
                      <input
                        className="input"
                        onChange={(e) => setOverride(idx, "overlayText", e.target.value)}
                        placeholder="Divisão · vazio = sistema sorteia"
                        value={ov.overlayText}
                      />
                      <Textarea
                        onChange={(e) => setOverride(idx, "caption", e.target.value)}
                        placeholder="Legenda · vazio = sistema sorteia"
                        rows={2}
                        value={ov.caption}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="wizard-footer">
        <Button onClick={onBack} variant="outline">Voltar</Button>
        <Button disabled={!canNext} onClick={handleNext}>
          Próximo
        </Button>
      </div>
    </div>
  );
}
