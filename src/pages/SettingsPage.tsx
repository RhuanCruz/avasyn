import { useCallback, useState } from "react";
import { toast } from "sonner";

import { Pill } from "@/components/operator-ui";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";
import { invokeFunction } from "@/lib/api";

type CookieSummary = {
  present: boolean;
  total: number;
  authCookies: { name: string; expiresAt: string | null; expired: boolean }[];
  missingAuthCookies: string[];
  expired: boolean | null;
  expiresAt: string | null;
};

type CookieStatus = {
  configured: boolean;
  metadata: CookieSummary;
  updatedAt: string | null;
};

const EMPTY_STATUS: CookieStatus = {
  configured: false,
  metadata: {
    present: false,
    total: 0,
    authCookies: [],
    missingAuthCookies: [],
    expired: null,
    expiresAt: null,
  },
  updatedAt: null,
};

export function SettingsPage() {
  const [cookies, setCookies] = useState("");
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(
    () => invokeFunction<CookieStatus>("get-worker-cookies-status", {}),
    [],
  );
  const status = useSupabaseQuery(loadStatus, EMPTY_STATUS);

  async function save() {
    if (!cookies.trim()) return;
    setSaving(true);
    try {
      await invokeFunction("set-worker-cookies", { cookies });
      // Limpa o campo: o valor não volta do servidor, então deixá-lo na tela só criaria
      // uma cópia do segredo sem utilidade.
      setCookies("");
      toast.success("Cookies salvos. O worker usa os novos no próximo download.");
      await status.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar os cookies");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        description="Credenciais que o worker de vídeo usa em runtime. Alterações valem no próximo job, sem redeploy."
        title="Configurações"
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card>
          <CardHeader>
            <CardTitle>Cookies do YouTube</CardTitle>
            <CardDescription>
              Usados só quando nenhum provider de download responde. Cole o conteúdo do
              <code> cookies.txt</code> (formato Netscape) ou o base64 que estava em
              <code> YOUTUBE_COOKIES_BASE64</code> — os dois funcionam.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="youtube-cookies">Novo arquivo de cookies</FieldLabel>
              <Textarea
                id="youtube-cookies"
                onChange={(event) => setCookies(event.target.value)}
                placeholder={"# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1796...\tSID\t..."}
                rows={10}
                spellCheck={false}
                style={{ fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 12 }}
                value={cookies}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={saving || !cookies.trim()} onClick={() => void save()}>
                {saving ? "Salvando..." : "Salvar cookies"}
              </Button>
              <span className="text-xs text-muted-foreground">
                O valor nunca é exibido de volta — só o resumo ao lado.
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Estado da sessão</CardTitle>
              <CardDescription>Recalculado a cada carregamento desta tela.</CardDescription>
            </CardHeader>
            <CardContent>
              {status.loading ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-32 rounded" />
                  <Skeleton className="h-4 w-48 rounded" />
                </div>
              ) : (
                <CookieStatusView status={status.data} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Como exportar</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-2 pl-4 text-sm text-muted-foreground">
                <li>Abra uma janela anônima e entre no YouTube com uma conta secundária.</li>
                <li>Exporte os cookies no formato Netscape <code>cookies.txt</code>.</li>
                <li>Cole aqui e salve.</li>
                <li>
                  Feche a janela anônima <strong>sem deslogar</strong> — o YouTube invalida a
                  sessão exportada assim que a aba original faz logout.
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </section>
    </>
  );
}

function CookieStatusView({ status }: { status: CookieStatus }) {
  if (!status.configured) {
    return (
      <div className="flex flex-col gap-2">
        <Pill tone="warn">Não configurado</Pill>
        <p className="text-sm text-muted-foreground">
          Nenhum cookie salvo aqui. O worker está usando a variável de ambiente, se houver.
        </p>
      </div>
    );
  }

  const { metadata } = status;
  const expiresAt = metadata.expiresAt ? new Date(metadata.expiresAt) : null;
  const daysLeft = expiresAt
    ? Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {metadata.expired ? (
          <Pill tone="err">Sessão vencida</Pill>
        ) : daysLeft !== null && daysLeft <= 7 ? (
          <Pill tone="warn">Vence em {daysLeft} dia{daysLeft === 1 ? "" : "s"}</Pill>
        ) : (
          <Pill tone="ok">Sessão válida</Pill>
        )}
        <span className="text-xs text-muted-foreground">{metadata.total} cookies</span>
      </div>

      {expiresAt ? (
        <p className="text-sm text-muted-foreground">
          Expira em {expiresAt.toLocaleDateString()} às {expiresAt.toLocaleTimeString()}.
        </p>
      ) : null}

      {metadata.missingAuthCookies.length > 0 ? (
        <p className="text-sm" style={{ color: "var(--err)" }}>
          Faltam cookies de sessão: {metadata.missingAuthCookies.join(", ")}. O download vai
          levar bot-check mesmo assim.
        </p>
      ) : null}

      {status.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          Atualizado em {new Date(status.updatedAt).toLocaleString()}.
        </p>
      ) : null}
    </div>
  );
}
