# Spec Detalhada: Imagens do Avatar Presenter

## Objetivo

Refazer a UX de imagem do avatar presenter para suportar dois caminhos claros:

1. Usuario faz upload manual de uma imagem pronta.
2. Usuario escreve um prompt e a plataforma gera imagens com OpenAI `gpt-image-2`.

Quando a plataforma gera a imagem, a IA deve melhorar o prompt do usuario, gerar 3 opcoes iniciais e permitir que o usuario escolha uma. Depois da escolha, o sistema gera um grid de emocoes e perspectivas do mesmo avatar para melhorar consistencia futura.

## Principios de UX

- O usuario nunca deve ficar preso a um caminho unico.
- Upload manual deve ser simples e direto.
- Geracao por IA deve mostrar escolhas reais, nao uma unica imagem.
- O prompt melhorado deve ser visivel e editavel antes de gastar com geracao.
- A imagem base selecionada e a fonte de verdade visual do avatar.
- O grid de variacoes deve parecer o mesmo personagem em condicoes diferentes.
- O usuario precisa aprovar explicitamente a imagem base e o pacote visual.

## Fluxo da Etapa

### 1. Escolha do Caminho

Tela inicial da etapa de imagem:

- Card `Gerar com IA`
  - Campo de prompt livre.
  - Exemplo de placeholder: `Ex.: apresentador brasileiro de futebol, carismatico, camisa social azul, estudio esportivo moderno`.

- Card `Enviar imagem`
  - Upload de arquivo.
  - Aceitar `jpeg`, `png`, `webp`.
  - Validar tamanho maximo definido pelo bucket.

### 2. Caminho Upload Manual

1. Usuario envia imagem.
2. Frontend mostra preview.
3. Usuario confirma como imagem base.
4. Backend salva imagem no bucket e cria registro como `source = upload`.
5. Usuario pode:
   - aprovar direto;
   - ou gerar grid de emocoes/perspectivas usando essa imagem como referencia.

Upload manual nao deve chamar OpenAI automaticamente antes da confirmacao.

### 3. Caminho Gerar com IA

1. Usuario escreve prompt bruto.
2. Backend chama OpenAI para melhorar o prompt.
3. UI mostra:
   - prompt original;
   - prompt melhorado;
   - campos editaveis para ajustar estilo, idade aparente, roupa, fundo, energia.
4. Usuario confirma.
5. Backend gera 3 opcoes com `gpt-image-2`.
6. UI mostra as 3 opcoes em grid.
7. Usuario seleciona uma como imagem base.
8. Backend marca a imagem escolhida como `base_selected`.

### 4. Grid de Variacoes

Apos escolher a imagem base, o sistema oferece gerar o pacote visual.

Grid MVP recomendado: 8 imagens.

- Frente neutra.
- Frente sorrindo.
- Frente serio/concentrado.
- Frente falando.
- Tres quartos esquerda.
- Tres quartos direita.
- Close-up expressivo.
- Surpreso/reagindo.

Todas as imagens devem ser geradas a partir da imagem base como referencia. O prompt deve reforcar:

- mesma identidade;
- mesmo rosto;
- mesma idade aparente;
- mesmo cabelo;
- mesma roupa ou roupa muito semelhante;
- fundo consistente ou neutro;
- variacao apenas de expressao, pose ou perspectiva.

### 5. Revisao e Aprovacao

UI mostra:

- imagem base destacada;
- grid de variacoes;
- botao `Aprovar pacote visual`;
- botao `Regenerar pacote`;
- botao `Trocar imagem base`.

Ao aprovar, o profile do avatar passa a ter visual pronto.

## Dados e Persistencia

### Tabela `presenter_avatar_images`

Campos sugeridos:

- `id`
- `user_id`
- `avatar_id`
- `image_set_id`
- `kind`
  - `option`
  - `base`
  - `variation`
  - `upload`
- `source`
  - `openai`
  - `upload`
- `status`
  - `draft`
  - `generated`
  - `selected`
  - `approved`
  - `rejected`
  - `error`
- `prompt`
- `improved_prompt`
- `variation_label`
- `storage_path`
- `preview_url`
- `provider`
- `provider_asset_id`
- `metadata`
- `created_at`
- `updated_at`

### Tabela `presenter_image_sets`

Campos sugeridos:

- `id`
- `user_id`
- `avatar_id`
- `base_image_id`
- `status`
  - `draft`
  - `base_selected`
  - `generating_variations`
  - `ready_for_review`
  - `approved`
  - `error`
- `prompt_original`
- `prompt_improved`
- `error_message`
- `metadata`
- `created_at`
- `updated_at`

### `presenter_avatar_profiles`

Campos sugeridos:

- `approved_image_set_id`
- `approved_base_image_id`
- `visual_source`
  - `upload`
  - `openai`
- `visual_status`
  - `not_started`
  - `in_review`
  - `approved`

## Edge Functions

### `improve-presenter-image-prompt`

Input:

```json
{
  "avatarId": "uuid",
  "rawPrompt": "string"
}
```

Output:

```json
{
  "improvedPrompt": "string",
  "negativePromptGuidance": "string",
  "styleNotes": ["string"]
}
```

Responsabilidade:

- usar nome, tema principal e persona do avatar;
- transformar prompt bruto em prompt visual claro;
- evitar instrucoes contraditorias;
- preservar linguagem visual util para consistencia.

### `generate-presenter-image-options`

Input:

```json
{
  "avatarId": "uuid",
  "prompt": "string",
  "count": 3
}
```

Responsabilidade:

- gerar 3 imagens com `gpt-image-2`;
- salvar cada imagem no bucket;
- criar registros `presenter_avatar_images`;
- retornar URLs assinadas ou paths.

### `upload-presenter-avatar-image`

Responsabilidade:

- receber path ja enviado pelo frontend ou upload via signed URL;
- validar ownership;
- criar registro de imagem como `source = upload`.

### `generate-presenter-image-set`

Input:

```json
{
  "avatarId": "uuid",
  "baseImageId": "uuid"
}
```

Responsabilidade:

- gerar as 8 variacoes MVP;
- usar imagem base como referencia;
- salvar imagens no bucket;
- marcar set como `ready_for_review`.

## OpenAI Images

Modelo default:

```txt
gpt-image-2
```

Configuracao inicial:

- Opcoes iniciais: qualidade `low` ou `medium`, dependendo do custo aceitavel.
- Imagem base final: manter a opcao selecionada pelo usuario.
- Variacoes: usar qualidade `medium` se o custo permitir; senao `low` no MVP.
- Tamanho recomendado para avatar vertical: `1024x1536`.

Regra de custo:

- Nao gerar grid antes de o usuario escolher a imagem base.
- Nao gerar mais de 3 opcoes iniciais no MVP.
- Regenerar deve criar novo set, nao sobrescrever historico sem registro.

## UI Detalhada

### Estado `not_started`

Mostra dois cards:

- `Gerar com IA`
- `Enviar imagem`

### Estado `prompt_review`

Mostra:

- prompt original;
- prompt melhorado editavel;
- botao `Gerar 3 opcoes`.

### Estado `options_generated`

Mostra:

- grid 3 colunas com opcoes;
- cada card com botao `Usar esta imagem`;
- acao secundaria `Voltar e editar prompt`.

### Estado `base_selected`

Mostra:

- imagem base grande;
- botao `Gerar pacote visual`;
- acao `Trocar imagem base`.

### Estado `set_generating`

Mostra:

- imagem base;
- skeleton/grid em processamento;
- texto curto: `Gerando emocoes e perspectivas`.

### Estado `set_ready`

Mostra:

- imagem base;
- grid de 8 variacoes;
- botao `Aprovar pacote visual`;
- botao `Regenerar pacote`.

### Estado `approved`

Mostra:

- imagem base aprovada;
- grid aprovado;
- status `Visual aprovado`;
- proxima etapa: voz.

## Validacoes

- Upload deve aceitar apenas imagem.
- Prompt bruto deve ter pelo menos 8 caracteres.
- Prompt melhorado pode ser editado pelo usuario.
- Nao permitir avancar para voz sem imagem base aprovada.
- Nao permitir gerar video sem pacote visual aprovado ou upload aprovado.
- Imagens com erro ficam visiveis como falha recuperavel, nao quebram o wizard inteiro.

## Erros e Recuperacao

- Falha ao melhorar prompt: permitir editar prompt bruto manualmente e tentar de novo.
- Falha em uma das 3 opcoes: mostrar as que geraram e permitir regenerar faltantes.
- Falha no grid: manter imagem base e permitir tentar novamente.
- Upload invalido: mostrar mensagem de formato/tamanho.
- Sem credito OpenAI: bloquear geracao com mensagem clara.

## Testes

### Unitarios

- normalizacao de prompt visual;
- validacao de estados do wizard;
- selecao de imagem base;
- montagem de labels do grid;
- parser de resposta OpenAI Images.

### Edge Functions

- prompt bruto vira prompt melhorado;
- geracao de 3 opcoes salva 3 registros;
- upload manual cria registro correto;
- grid de variacoes salva 8 imagens;
- erro parcial nao apaga imagem base.

### Frontend

- usuario consegue alternar entre upload e geracao;
- usuario consegue revisar prompt melhorado;
- usuario consegue selecionar uma das 3 opcoes;
- usuario consegue aprovar pacote visual;
- estados de loading e erro aparecem sem duplicar cards.

## Criterios de Aceite

- Usuario pode concluir etapa de imagem sem gerar nada, apenas com upload.
- Usuario pode concluir etapa de imagem gerando 3 opcoes e escolhendo uma.
- Depois de selecionar a base, usuario pode gerar e aprovar grid de variacoes.
- O hub do avatar mostra a imagem base aprovada.
- O sistema sabe qual imagem usar como referencia para Hedra.
- Nenhuma etapa posterior de video inicia sem imagem aprovada.

