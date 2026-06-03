import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
import { invokeFunction } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { SocialAccount } from "@/lib/types";
import { useSupabaseQuery } from "@/hooks/useSupabaseQuery";

type ConnectResponse = {
  url: string;
};

export function AccountsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [syncing, setSyncing] = useState(false);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("social_accounts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []) as SocialAccount[];
  }, []);

  const {
    data: accounts,
    refresh: refreshAccounts,
  } = useSupabaseQuery(loadAccounts, []);

  const syncAccounts = useCallback(async () => {
    setSyncing(true);
    try {
      await invokeFunction("zernio-sync-accounts");
      toast.success("Contas sincronizadas");
      await refreshAccounts();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao sincronizar");
    } finally {
      setSyncing(false);
    }
  }, [refreshAccounts]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const accountId = searchParams.get("accountId");
    const username = searchParams.get("username");

    if (connected === "instagram" || accountId || username) {
      void syncAccounts().then(() => {
        navigate("/accounts", { replace: true });
      });
    }
  }, [navigate, searchParams, syncAccounts]);

  async function connectAccount() {
    try {
      const response = await invokeFunction<ConnectResponse>("zernio-connect-url", {
        redirectUrl: `${window.location.origin}/accounts`,
      });
      window.location.href = response.url;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao iniciar OAuth");
    }
  }

  return (
    <>
      <PageHeader
        action={
          <div className="flex gap-2">
            <Button onClick={() => void syncAccounts()} variant="outline">
              {syncing ? "Sincronizando..." : "Sincronizar"}
            </Button>
            <Button onClick={() => void connectAccount()}>Conectar Instagram</Button>
          </div>
        }
        description="Conecte e sincronize contas Instagram via Zernio."
        title="Contas"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{account.display_name}</CardTitle>
                  <CardDescription>{account.username ?? account.zernio_account_id}</CardDescription>
                </div>
                <Badge variant={account.active ? "success" : "secondary"}>
                  {account.active ? "Ativa" : "Inativa"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Instagram</p>
              {account.profile_url ? (
                <a
                  className="mt-2 block truncate text-sm text-primary hover:underline"
                  href={account.profile_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  {account.profile_url}
                </a>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {accounts.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="p-8 text-sm text-muted-foreground">
              Nenhuma conta Instagram conectada.
            </CardContent>
          </Card>
        ) : null}
      </section>
    </>
  );
}
