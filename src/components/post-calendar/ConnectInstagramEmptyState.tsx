import { useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { invokeFunction } from "@/lib/api";
import type { SocialPlatform } from "@/lib/types";

type ConnectResponse = { url: string };

type Props = {
  avatarId: string;
  onSynced: () => Promise<void>;
};

export function ConnectInstagramEmptyState({ avatarId, onSynced }: Props) {
  const [connecting, setConnecting] = useState<SocialPlatform | null>(null);
  const [syncing, setSyncing] = useState(false);

  async function handleConnect(platform: SocialPlatform) {
    setConnecting(platform);
    try {
      const redirectUrl = `${window.location.origin}/avatars/${avatarId}?tab=calendario&connected=${platform}`;
      const response = await invokeFunction<ConnectResponse>("zernio-connect-url", {
        redirectUrl,
        avatarId,
        platform,
      });
      window.location.href = response.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão");
      setConnecting(null);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const resp = await invokeFunction<{ count?: number; returned?: number }>(
        "zernio-sync-accounts",
        { avatarId },
      );
      if ((resp?.count ?? 0) > 0) {
        toast.success("Contas sincronizadas");
      } else {
        toast.warning(
          `Nenhuma conta encontrada no Zernio${resp?.returned ? ` (${resp.returned} retornada(s), nenhuma suportada)` : ""}. Verifique se a conexão concluiu.`,
        );
      }
      await onSynced();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="panel empty">
      <div>
        <div className="flex justify-center gap-4" style={{ marginBottom: 16 }}>
          <Icon name="instagram" size={40} style={{ color: "var(--text-muted)" }} />
          <Icon name="youtube" size={40} style={{ color: "var(--text-muted)" }} />
        </div>
        <h3>Conecte uma conta para postar</h3>
        <p>
          Conecte Instagram ou YouTube a este avatar via Zernio para visualizar o calendário de posts.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          <Button
            disabled={connecting !== null}
            onClick={() => void handleConnect("instagram")}
          >
            <Icon name="instagram" size={14} style={{ marginRight: 6 }} />
            {connecting === "instagram" ? "Redirecionando..." : "Conectar Instagram"}
          </Button>
          <Button
            disabled={connecting !== null}
            onClick={() => void handleConnect("youtube")}
          >
            <Icon name="youtube" size={14} style={{ marginRight: 6 }} />
            {connecting === "youtube" ? "Redirecionando..." : "Conectar YouTube"}
          </Button>
          <Button
            disabled={syncing}
            onClick={() => void handleSync()}
            variant="outline"
          >
            {syncing ? "Sincronizando..." : "Já conectei, sincronizar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
