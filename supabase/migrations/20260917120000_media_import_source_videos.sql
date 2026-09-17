-- Depois que uma importação terminava, o frontend precisava ADIVINHAR qual linha de
-- source_videos tinha acabado de ser criada: tentava casar por source_external_id e, se
-- falhasse, comparava source_url com a URL do resultado da busca. Quando qualquer um dos
-- dois divergia do que o worker gravou -- e diverge, porque o external_id vem do metadata
-- do yt-dlp e a URL passa por normalização na edge function -- a tela mostrava
-- "Importação concluída, mas o vídeo não apareceu na biblioteca". O vídeo estava lá; só
-- não era encontrado.
--
-- Guardar o id de quem foi criado elimina o palpite inteiro.

alter table public.media_imports
  add column if not exists source_video_ids uuid[] not null default '{}'::uuid[];

comment on column public.media_imports.source_video_ids is
  'Ids de source_videos criados/atualizados por esta importação, na ordem em que foram processados. Preenchido pelo worker.';
