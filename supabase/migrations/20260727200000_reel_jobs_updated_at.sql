-- reel_jobs só tinha created_at, então não havia como saber há quanto tempo um job
-- estava parado em "processing". Isso importa porque o worker pode morrer no meio do
-- render (o OOM killer manda SIGKILL e o catch que gravaria o erro nunca roda), e o job
-- fica órfão nesse status para sempre — a UI mostra "Renderizando" indefinidamente.
-- O reaper em retry-failed-jobs usa esta coluna para achar esses jobs.

alter table public.reel_jobs
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_reel_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists reel_jobs_set_updated_at on public.reel_jobs;

-- Trigger em vez de setar na aplicação: tanto o reel-processor quanto o worker mudam o
-- status, e um deles esquecer de atualizar o carimbo reintroduziria o job fantasma.
create trigger reel_jobs_set_updated_at
  before update on public.reel_jobs
  for each row
  execute function public.touch_reel_jobs_updated_at();

create index if not exists reel_jobs_status_updated_at_idx
  on public.reel_jobs (status, updated_at);
