# PRD: Refatoracao do Presenter Avatar Pipeline

## Resumo

Refatorar o fluxo de avatar presenter para separar claramente quatro etapas: identidade/persona, imagem, voz e video. A imagem passa a ser gerada ou enviada pelo usuario antes de qualquer integracao de video. A voz e o video deixam de depender de HeyGen no caminho principal e passam a usar Hedra. OpenAI continua responsavel por persona, melhoria de prompts, pesquisa, roteiro e geracao/edicao de imagens com `gpt-image-2`.

O objetivo do MVP refatorado e reduzir ambiguidade para o usuario: primeiro criar a identidade visual e vocal do avatar, depois gerar roteiros e videos usando esses assets persistentes.

## Objetivos

- Permitir que o usuario crie um avatar presenter com visual consistente.
- Aceitar dois caminhos de imagem: upload manual ou geracao dentro da plataforma.
- Quando gerar imagem na plataforma, sempre melhorar o prompt do usuario e gerar 3 opcoes iniciais.
- Depois da escolha da imagem base, gerar um grid de variacoes controladas de emocoes e perspectivas.
- Criar uma voz consistente por avatar, preferencialmente via Hedra voice clone, com fallback para voz publica selecionada.
- Usar Hedra para renderizacao de video com o asset visual e o `voice_id` persistente.
- Manter nossa autoria de roteiro: persona, pesquisa, script e revisao continuam no nosso sistema.

## Nao Objetivos

- Nao implementar edicao avancada de video neste ciclo.
- Nao publicar automaticamente em redes sociais a partir do presenter neste ciclo.
- Nao criar marketplace de vozes ou imagens.
- Nao clonar voz sem consentimento explicito e arquivo enviado pelo usuario.
- Nao depender de URLs, links ou datas cruas no texto falado pelo avatar.

## Personas de Usuario

- Criador solo que quer um personagem consistente para videos curtos.
- Operador de canais que cria muitos presenters por nicho.
- Usuario que ja tem uma imagem pronta e so quer transformar em avatar de video.
- Usuario que nao tem imagem pronta e espera que a plataforma gere opcoes boas.

## Fluxo Geral

1. **Identidade**
   - Usuario informa nome do avatar e tema principal.
   - Esses campos orientam persona, visual, voz e roteiro.

2. **Persona**
   - Usuario escreve texto livre sobre comportamento, tom, crencas, bordoes e limites.
   - Backend estrutura a persona com OpenAI.
   - Usuario revisa e aprova.

3. **Imagem**
   - Usuario escolhe entre upload manual ou gerar na plataforma.
   - Se gerar na plataforma, nossa IA melhora o prompt e gera 3 opcoes.
   - Usuario escolhe uma imagem base.
   - Sistema gera um grid de emocoes e perspectivas a partir da imagem aprovada.
   - Usuario aprova o pacote visual final.

4. **Voz**
   - Usuario escolhe entre clonar uma voz ou usar uma voz publica Hedra.
   - Para voz clonada, usuario envia audio de referencia e confirma consentimento.
   - Backend cria `hedra_voice_id` persistente.
   - Voz fica associada ao avatar.

5. **Roteiro**
   - Usuario informa tema do video.
   - Backend faz pesquisa atual, gera brief editorial e roteiro falado.
   - Roteiro e validado para nao conter links, URLs ou datas cruas.
   - Usuario revisa e aprova.

6. **Video**
   - Backend envia imagem/avatar asset, `voice_id` e roteiro para Hedra.
   - Projeto acompanha status por polling/webhook.
   - Card atualiza via Supabase Realtime.

## Arquitetura Proposta

### Frontend

- `/avatars/new/presenter` vira um wizard por etapas com estado persistente.
- O hub do avatar presenter mostra:
  - status da persona;
  - imagem base aprovada;
  - grid visual aprovado;
  - voz persistente;
  - projetos de video.
- Cards de projeto continuam retangulares em grid, com estados claros:
  - roteiro em revisao;
  - reprocessando roteiro;
  - processando video;
  - video pronto;
  - erro.

### Supabase

Manter tabelas existentes quando possivel e adicionar campos/tabelas especificas para assets persistentes:

- `presenter_avatar_profiles`
  - adicionar campos para provider atual de imagem/video/voz.
  - armazenar imagem base aprovada e asset Hedra correspondente.
  - armazenar `hedra_voice_id`.

- Nova tabela sugerida: `presenter_avatar_images`
  - uma linha por imagem gerada ou enviada.
  - campos: `avatar_id`, `kind`, `status`, `source`, `prompt`, `improved_prompt`, `storage_path`, `preview_url`, `provider_asset_id`, `metadata`.

- Nova tabela sugerida: `presenter_image_sets`
  - representa o pacote visual aprovado.
  - campos: `avatar_id`, `base_image_id`, `status`, `metadata`.

- `presenter_video_projects`
  - substituir campos HeyGen por campos neutros ou Hedra.
  - manter `script`, `script_text`, `status`, `video_url`, `thumbnail_url`, `error_message`.

### Storage

- Bucket para imagens do presenter:
  - uploads manuais;
  - opcoes geradas;
  - grid de variacoes;
  - imagens aprovadas para Hedra.

### Edge Functions

Funcoes novas ou refatoradas:

- `improve-presenter-image-prompt`
- `generate-presenter-image-options`
- `generate-presenter-image-set`
- `upload-presenter-image`
- `create-hedra-voice`
- `create-hedra-video`
- `sync-hedra-video`
- `delete-presenter-video-project`

Funcoes existentes a manter/refatorar:

- `structure-presenter-persona`
- `generate-presenter-script`
- `submit-presenter-video`
- `sync-presenter-video`

## Etapas de Implementacao

### Etapa 1: Imagens do Avatar

Prioridade maxima. Implementar o novo fluxo de upload/geracao, prompt melhorado, 3 opcoes e grid de variacoes. Ver spec detalhada em `docs/presenter-avatar-images-spec.md`.

### Etapa 2: Voz Hedra

Criar fluxo para voz persistente:

- listar vozes publicas da Hedra;
- permitir fallback por voz publica;
- permitir upload de audio para voice clone;
- exigir confirmacao de consentimento antes de clonar;
- salvar `hedra_voice_id` no perfil presenter;
- bloquear geracao de video se nao houver voz definida.

### Etapa 3: Video Hedra

Refatorar provider de video:

- fazer upload/registro dos assets de imagem na Hedra;
- gerar video com Hedra usando imagem aprovada e `hedra_voice_id`;
- manter status local via polling/webhook;
- mostrar video final no mesmo card.

### Etapa 4: Roteiro e Qualidade

Manter o motor atual, mas adaptar o output para Hedra:

- `script_text` continua sendo texto falado;
- links e datas cruas continuam proibidos no roteiro;
- fontes ficam apenas em `research_summary`;
- duracao alvo deve ser configuravel por projeto.

### Etapa 5: Limpeza da UI e Deploy

- Remover textos e nomes HeyGen da UI e README.
- Atualizar env vars.
- Atualizar comandos de deploy.
- Adicionar logs e mensagens de erro por provider.

## Regras de Produto

- O usuario sempre precisa aprovar a imagem base antes do grid de variacoes.
- Upload manual nao deve obrigar geracao inicial por IA.
- Imagem gerada pela plataforma sempre passa por prompt melhorado antes.
- Gerar 3 opcoes iniciais, nao uma.
- O grid de variacoes deve preservar identidade, nao reinventar o personagem.
- A voz deve ser persistente por avatar.
- Video nao pode ser gerado sem imagem aprovada e voz definida.
- Roteiro falado nao pode conter URL, link, dominio ou data crua.

## Estados Principais

- Persona: `draft`, `generated`, `approved`.
- Imagem: `source_pending`, `prompt_review`, `options_generated`, `base_selected`, `set_generating`, `set_ready`, `approved`.
- Voz: `not_configured`, `public_selected`, `clone_processing`, `clone_ready`, `error`.
- Video: `script_pending_review`, `ready_for_video`, `submitted`, `processing`, `completed`, `error`.

## Metricas de Sucesso

- Usuario consegue sair da etapa de imagens com imagem base e pacote visual aprovado.
- Nenhum video e enviado para Hedra sem imagem e voz persistentes.
- Reprocessamento de roteiro atualiza o mesmo card, sem duplicacao.
- Texto falado enviado para provider nao contem links ou datas cruas.
- O custo estimado por video pode ser exibido antes da geracao.

## Riscos

- Custo de imagens pode subir se gerarmos opcoes demais.
- Grid de variacoes pode perder identidade se o prompt/edicao nao usar a imagem base como referencia.
- Voice clone exige consentimento e pode falhar com audio ruim.
- Hedra pode cobrar TTS e video separadamente; precisamos medir saldo antes/depois no primeiro teste real.

## Deploy e Configuracao

Novas variaveis esperadas:

```bash
OPENAI_API_KEY=
OPENAI_IMAGE_MODEL=gpt-image-2
HEDRA_API_KEY=
HEDRA_WEBHOOK_URL=
```

Variaveis HeyGen devem ser removidas apenas quando o provider Hedra estiver completo e validado.

