import { useState } from "react";
import { toast } from "sonner";

import { Icon } from "@/components/operator-ui";
import { Button } from "@/components/ui/button";
import { invokeFunction } from "@/lib/api";

type ConnectResponse = { url: string };

type Props = {
  avatarId: string;
  onSynced: () => Promise<void>;
};

export function ConnectInstagramEmptyState({ avatarId, onSynced }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function handleConnect() {
    setConnecting(true);
    try {
      const redirectUrl = `${window.location.origin}/avatars/${avatarId}?tab=calendario&connected=instagram`;
      const response = await invokeFunction<ConnectResponse>("zernio-connect-url", {
        redirectUrl,
        avatarId,
      });
      window.location.href = response.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar conexão");
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      await invokeFunction("zernio-sync-accounts", { avatarId });
      toast.success("Contas sincronizadas");
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
        <Icon
          name="instagram"
          size={40}
          style={{ color: "var(--text-muted)", marginBottom: 12 }}
        />
        <h3>Conecte uma conta Instagram</h3>
        <p>
          Para visualizar o calendário de posts deste avatar, conecte uma conta
          Instagram via Zernio.
        </p>
        <div className="flex justify-center gap-2 mt-4">
          <Button disabled={connecting} onClick={() => void handleConnect()}>
            {connecting ? "Redirecionando..." : "Conectar Instagram"}
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
