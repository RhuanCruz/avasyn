-- Todos os caminhos que criam job fazem duas coisas: enqueue_reel_job() (mensagem na pgmq)
-- e uma chamada direta ao reel-processor com o jobId. O caminho direto não conhece o
-- msg_id, então nunca apagava a mensagem — sobrava uma órfã por job criado. Enquanto nada
-- lia a fila isso ficou invisível; no momento em que um consumidor passou a drenar, cada
-- órfã virou um reprocessamento de job já publicado, ou seja, post duplicado.
--
-- Esta função deixa o caminho direto limpar a própria mensagem por job_id.
create or replace function public.delete_reel_job_messages_for_job(job_id uuid)
returns int
language plpgsql
security definer
set search_path = public, pgmq
as $func$
declare
  deleted int := 0;
  found_msg record;
begin
  -- pgmq.delete de um id por vez em vez da variante com array: é a mesma assinatura que o
  -- resto do schema já usa e não depende da versão da extensão.
  for found_msg in
    select q.msg_id
    from pgmq.q_reel_jobs q
    where q.message->>'job_id' = job_id::text
  loop
    perform pgmq.delete('reel_jobs', found_msg.msg_id);
    deleted := deleted + 1;
  end loop;

  return deleted;
end;
$func$;

revoke all on function public.delete_reel_job_messages_for_job(uuid) from public;
grant execute on function public.delete_reel_job_messages_for_job(uuid) to service_role;
