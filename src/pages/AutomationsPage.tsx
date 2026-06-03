import { FormEvent, useCallback, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/auth/AuthContext";
import { normalizeClipUrls } from "@/lib/job-utils";
import { supabase } from "@/lib/supabase";
import type { Automation, ReactionVideo, SocialAccount } from "@/lib/types";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";

export function AutomationsPage() {
  const { user } = useAuth();
  const [accountId, setAccountId] = useState("");
  const [reactionId, setReactionId] = useState("");
  const [postTimes, setPostTimes] = useState("09:00,12:00,18:00");
  const [postsPerDay, setPostsPerDay] = useState(3);
  const [clipUrls, setClipUrls] = useState("");
  const [captionTemplate, setCaptionTemplate] = useState(
    "Melhor lance do dia #futebol",
  );
  const [overlayText, setOverlayText] = useState("MELHOR LANCE DO DIA");
  const [submitting, setSubmitting] = useState(false);

  const loadAutomations = useCallback(async () => {
    const { data, error } = await supabase
      .from("automations")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as Automation[];
  }, []);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("*")
      .eq("active", true)
      .order("display_name");

    if (error) throw error;
    return (data ?? []) as SocialAccount[];
  }, []);

  const loadReactions = useCallback(async () => {
    const { data, error } = await supabase
      .from("reaction_videos")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as ReactionVideo[];
  }, []);

  const automations = useSupabaseQuery(loadAutomations, []);
  const accounts = useSupabaseQuery(loadAccounts, []);
  const reactions = useSupabaseQuery(loadReactions, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      const urls = normalizeClipUrls(clipUrls);
      const times = postTimes
        .split(",")
        .map((time) => time.trim())
        .filter(Boolean);

      const { error } = await supabase.from("automations").insert({
        user_id: user.id,
        account_id: accountId,
        posts_per_day: postsPerDay,
        post_times: times,
        reaction_pool: [reactionId],
        clip_urls: urls,
        caption_template: captionTemplate,
        overlay_text: overlayText,
        active: true,
      });

      if (error) throw error;
      toast.success("Automação criada");
      setClipUrls("");
      await automations.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao criar automação");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAutomation(automation: Automation) {
    const { error } = await supabase
      .from("automations")
      .update({ active: !automation.active })
      .eq("id", automation.id);

    if (error) {
      toast.error(error.message);
      return;
    }

    await automations.refresh();
  }

  return (
    <>
      <PageHeader
        description="Configuração enxuta de agenda por conta para o scheduler do MVP."
        title="Automações"
      />

      <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Nova automação</CardTitle>
            <CardDescription>Comece com uma conta, um pool de reaction e URLs fixas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="automationAccount">Conta</FieldLabel>
                  <Select
                    id="automationAccount"
                    onChange={(event) => setAccountId(event.target.value)}
                    required
                    value={accountId}
                  >
                    <option value="">Selecione</option>
                    {accounts.data.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.display_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="automationReaction">Reaction</FieldLabel>
                  <Select
                    id="automationReaction"
                    onChange={(event) => setReactionId(event.target.value)}
                    required
                    value={reactionId}
                  >
                    <option value="">Selecione</option>
                    {reactions.data.map((reaction) => (
                      <option key={reaction.id} value={reaction.id}>
                        {reaction.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="postsPerDay">Posts por dia</FieldLabel>
                    <Input
                      id="postsPerDay"
                      max={20}
                      min={1}
                      onChange={(event) => setPostsPerDay(Number(event.target.value))}
                      required
                      type="number"
                      value={postsPerDay}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="postTimes">Horários</FieldLabel>
                    <Input
                      id="postTimes"
                      onChange={(event) => setPostTimes(event.target.value)}
                      placeholder="09:00,12:00"
                      required
                      value={postTimes}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="automationClipUrls">URLs</FieldLabel>
                  <Textarea
                    id="automationClipUrls"
                    onChange={(event) => setClipUrls(event.target.value)}
                    required
                    value={clipUrls}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="captionTemplate">Caption</FieldLabel>
                  <Textarea
                    id="captionTemplate"
                    onChange={(event) => setCaptionTemplate(event.target.value)}
                    required
                    value={captionTemplate}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="automationOverlay">Overlay</FieldLabel>
                  <Input
                    id="automationOverlay"
                    onChange={(event) => setOverlayText(event.target.value)}
                    required
                    value={overlayText}
                  />
                </Field>
                <Button disabled={submitting} type="submit">
                  {submitting ? "Criando..." : "Criar automação ativa"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {automations.data.map((automation) => (
            <Card key={automation.id}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{automation.posts_per_day} posts/dia</CardTitle>
                    <CardDescription>{automation.post_times.join(", ")}</CardDescription>
                  </div>
                  <Badge variant={automation.active ? "success" : "secondary"}>
                    {automation.active ? "Ativa" : "Pausada"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {automation.caption_template}
                </p>
                <Button
                  onClick={() => void toggleAutomation(automation)}
                  size="sm"
                  variant="outline"
                >
                  {automation.active ? "Pausar" : "Ativar"}
                </Button>
              </CardContent>
            </Card>
          ))}
          {automations.data.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-sm text-muted-foreground">
                Nenhuma automação configurada.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>
    </>
  );
}
