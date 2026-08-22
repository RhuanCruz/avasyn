# Avasyn

MVP interno para gerar e postar Instagram Reels usando Supabase e Zernio.

## Stack

- Vite + React + TypeScript
- TailwindCSS + shadcn/ui-style source components
- Supabase Auth, Postgres, Storage, Realtime, Edge Functions
- pgmq + pg_cron
- Zernio API para Instagram
- OpenAI Responses API para persona/roteiros
- Hedra API para imagens, vozes e vídeos presenter

## Setup

1. Instale dependências:

   ```bash
   bun install
   ```

2. Crie `.env.local` com:

   ```bash
   VITE_SUPABASE_URL=
   VITE_SUPABASE_PUBLISHABLE_KEY=
   ```

3. Configure secrets das Edge Functions:

   ```bash
   supabase secrets set \
     SUPABASE_URL= \
     SUPABASE_ANON_KEY= \
     SUPABASE_SERVICE_ROLE_KEY= \
     OPENAI_API_KEY= \
     OPENAI_MODEL=gpt-4.1-mini \
     YOUTUBE_API_KEY= \
     APIFY_TOKEN= \
     APIFY_TIKTOK_ACTOR_ID=clockworks/tiktok-scraper \
     APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID=epctex/youtube-video-downloader \
     APIFY_YOUTUBE_QUALITY=720 \
     HEDRA_API_KEY= \
     ZERNIO_API_KEY= \
     ZERNIO_PROFILE_ID= \
     ZERNIO_WEBHOOK_SECRET= \
     APP_ORIGIN=http://localhost:5173
   ```

4. Rode migrations e functions:

   ```bash
   supabase db push
   supabase functions deploy zernio-connect-url
   supabase functions deploy zernio-sync-accounts
   supabase functions deploy create-manual-jobs
   supabase functions deploy create-media-import
   supabase functions deploy create-quick-react-job
   supabase functions deploy search-content
   supabase functions deploy structure-presenter-persona
   supabase functions deploy list-hedra-models
   supabase functions deploy list-hedra-voices
   supabase functions deploy improve-presenter-image-prompt
   supabase functions deploy generate-presenter-image-options
   supabase functions deploy sync-presenter-image-options
   supabase functions deploy upload-presenter-avatar-image
   supabase functions deploy select-presenter-base-image
   supabase functions deploy select-hedra-presenter-voice
   supabase functions deploy generate-presenter-script
   supabase functions deploy submit-presenter-video
   supabase functions deploy sync-presenter-video
   supabase functions deploy reel-processor
   supabase functions deploy search-tiktok
   supabase functions deploy post-to-zernio
   supabase functions deploy automation-scheduler
   supabase functions deploy zernio-webhook --no-verify-jwt
   ```

5. Suba o worker de vídeo:

   O Supabase Edge Runtime não permite subprocessos. Por isso `yt-dlp` e
   `ffmpeg` rodam em um worker externo.

   Em Railway/Render/Fly, aponte o deploy para `worker/Dockerfile` e configure:

   ```bash
   SUPABASE_URL=https://odbuwhhfwxttzbbjpsuh.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=
   VIDEO_WORKER_SECRET=
   HUNTAPI_API_KEY=
   WEBAPI_YOUTUBE_API_KEY=
   SAVENOW_API_KEY=
   SAVENOW_FORMAT=720
   APIFY_TOKEN=
   APIFY_TIKTOK_ACTOR_ID=clockworks/tiktok-scraper
   APIFY_YOUTUBE_DOWNLOADER_ACTOR_ID=epctex/youtube-video-downloader
   APIFY_YOUTUBE_QUALITY=720
   YOUTUBE_COOKIES_BASE64=
   INSTAGRAM_COOKIES_BASE64=
   INSTAGRAM_DOWNLOAD_DELAY_SECONDS=2
   YTDLP_NODE_PATH=/usr/local/bin/node
   PORT=8080
   ```

   **A imagem precisa do extra `curl-cffi`.** O `worker/Dockerfile` instala
   `yt-dlp[default,curl-cffi]`: o `default` traz o suporte local de EJS que
   alguns vídeos do YouTube exigem, e o `curl-cffi` habilita a impersonação de
   navegador que o extractor do TikTok exige. Sem ele todo download de TikTok
   falha com `The extractor is attempting impersonation, but no impersonate
   target is available` seguido de `Unexpected response from webpage request`.

   Extractors quebram quando o `yt-dlp` envelhece, e a layer do `pip` fica
   cacheada. Para forçar uma instalação nova, mude o build arg:

   ```bash
   docker build --build-arg YTDLP_CACHEBUST=$(date +%F) -f worker/Dockerfile .
   ```

   Para download de YouTube a cascata é: `HUNTAPI_API_KEY` → `WEBAPI_YOUTUBE_API_KEY`
   → `SAVENOW_API_KEY` → `APIFY_TOKEN` (actor `epctex/youtube-video-downloader`)
   → `yt-dlp` com cookies (último recurso). Configure ao menos um provider para
   que o download não dependa de cookies da conta do YouTube — só assim o
   `yt-dlp` deixa de ser alcançado no fluxo normal. Quando todos falham, o erro
   diz qual provider falhou e por quê (`HuntAPI: not configured | SaveNow: 502 | ...`).

   Se cair no fallback e aparecer `Sign in to confirm you're not a bot`, exporte
   cookies do YouTube no formato Netscape cookies.txt, gere base64 e salve em
   `YOUTUBE_COOKIES_BASE64`:

   ```bash
   base64 -i youtube-cookies.txt | tr -d '\n'
   ```

   Exporte os cookies de uma janela anônima com uma conta secundária e feche a
   janela **sem deslogar** — o YouTube invalida a sessão exportada assim que a
   aba original faz logout.

   Depois configure a URL do worker no Supabase:

   ```bash
   supabase secrets set \
     VIDEO_WORKER_URL=https://seu-worker.example.com \
     VIDEO_WORKER_SECRET=
   ```

   **Diagnóstico:** `GET /health` responde o que o deploy consegue de fato
   fazer — versão do `yt-dlp`, se a impersonação está disponível, quais
   providers estão configurados e se a sessão do YouTube ainda é válida
   (nomes e expiração dos cookies, nunca os valores):

   ```bash
   curl -s https://seu-worker.example.com/health | jq
   ```

   ```jsonc
   {
     "revision": "…",
     "ytdlp": { "version": "2026.08.15", "impersonation": { "available": true, "targetCount": 12 } },
     "providers": { "huntapi": true, "webapi": false, "savenow": false, "apify": true, "proxy": false },
     "cookies": { "youtube": { "present": true, "expired": false, "expiresAt": "2026-12-01T00:00:00.000Z" } }
   }
   ```

   `impersonation.available: false` significa que a imagem foi construída sem
   `curl-cffi` → TikTok não vai funcionar. `cookies.youtube.expired: true` (ou
   `missingAuthCookies` não vazio) significa que o `YOUTUBE_COOKIES_BASE64`
   precisa ser regerado.

   `INSTAGRAM_COOKIES_BASE64` deve conter um arquivo Netscape cookies.txt
   exportado de uma sessão Instagram autorizada. Após alterar o worker,
   reconstrua o stack para instalar também o `gallery-dl`.

6. Rode local:

   ```bash
   bun run dev
   ```

## Verificação

```bash
bun test
bun run lint
bun run build
```

O build usa `bun --bun` internamente para evitar conflitos de assinatura de bindings nativos de Rollup no macOS.

## Observações

- Supabase Auth deve ficar com email/senha e confirmação de email desativada.
- O MVP está travado em Instagram por enquanto.
- `reel-processor` apenas despacha jobs para `VIDEO_WORKER_URL`.
- O worker externo usa `yt-dlp` e `ffmpeg` para renderizar os vídeos.
