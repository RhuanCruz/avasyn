-- Os cookies do YouTube viviam só em YOUTUBE_COOKIES_BASE64, uma variável de ambiente do
-- worker. Trocar um cookie vencido exigia editar o stack no Portainer e recriar o
-- container: um deploy inteiro para colar um texto. Como o YouTube invalida a sessão em
-- poucos dias, isso virava trabalho recorrente, e o download ficava quebrado no intervalo
-- entre o cookie vencer e alguém perceber.
--
-- Esta tabela guarda o valor para o worker ler em tempo de job, sem redeploy. O cookie é
-- uma credencial de sessão, então ninguém além do service role pode tocar nela: RLS está
-- ligado e NÃO existe policy nenhuma, o que nega tudo para anon e authenticated (o
-- service role ignora RLS por definição). A escrita passa pela edge function
-- set-worker-cookies e a UI só enxerga o metadata -- nomes e expiração, nunca o valor.

create table if not exists public.worker_credentials (
  key text primary key,
  value text not null,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

alter table public.worker_credentials enable row level security;

-- Sem policies de propósito: qualquer policy criada aqui abriria a leitura do valor para o
-- cliente do navegador. Se um dia precisar expor algo, exponha o metadata por uma view ou
-- por edge function, nunca a coluna value.
revoke all on public.worker_credentials from anon, authenticated;

comment on table public.worker_credentials is
  'Credenciais que o worker lê em runtime (ex.: cookies do YouTube). Somente service_role. Escrita via edge function set-worker-cookies.';
comment on column public.worker_credentials.value is
  'Segredo em texto puro. Nunca deve ser devolvido para o cliente do navegador.';
comment on column public.worker_credentials.metadata is
  'Resumo seguro para a UI: contagem, nomes dos cookies de sessão e expiração. Sem valores.';
