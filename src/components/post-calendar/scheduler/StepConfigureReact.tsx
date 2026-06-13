import { useCallback, useState } from "react";

import { Icon, Pill } from "@/components/operator-ui";
import { StorageVideoPreview } from "@/components/VideoPreview";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { supabase } from "@/lib/supabase";
import type { ReactionVideo } from "@/lib/types";

import type { ReactConfig } from "./types";

type Props = {
  avatarId: string;
  initialConfig: ReactConfig;
  onBack: () => void;
  onNext: (config: ReactConfig) => void;
};

export function StepConfigureReact({ avatarId, initialConfig, onBack, onNext }: Props) {
  const [selectedReactionIds, setSelectedReactionIds] = useState<string[]>(initialConfig.reactionIds);
  const [overlayText, setOverlayText] = useState(initialConfig.overlayPhrases.join("\n"));
  const [captionsText, setCaptionsText] = useState(initialConfig.captions.join("\n"));
  const [hashtags, setHashtags] = useState(initialConfig.hashtags);

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

    onNext({
      reactionIds: selectedReactionIds,
      overlayPhrases: overlayPhrases.length > 0 ? overlayPhrases : initialConfig.overlayPhrases,
      captions: captions.length > 0 ? captions : initialConfig.captions,
      hashtags: hashtags.trim(),
    });
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

      <div className="wizard-footer">
        <Button onClick={onBack} variant="outline">Voltar</Button>
        <Button disabled={!canNext} onClick={handleNext}>
          Próximo
        </Button>
      </div>
    </div>
  );
}
