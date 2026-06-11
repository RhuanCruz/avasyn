# Avasyn

MVP interno para gerar e postar Instagram Reels usando Supabase e Zernio.

## Stack

- Vite + React + TypeScript
- TailwindCSS + shadcn/ui-style source components
- Supabase Auth, Postgres, Storage, Realtime, Edge Functions
- pgmq + pg_cron
- Zernio API para Instagram
- OpenAI Responses API para persona/roteiros
- HeyGen API para avatares presenter, vozes e vídeos

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
     HEYGEN_API_KEY= \
     HEYGEN_WEBHOOK_URL= \
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
   supabase functions deploy create-heygen-presenter-avatar
   supabase functions deploy design-heygen-voice
   supabase functions deploy generate-presenter-script
   supabase functions deploy submit-presenter-video
   supabase functions deploy sync-presenter-video
   supabase functions deploy heygen-webhook --no-verify-jwt
   supabase functions deploy reel-processor
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

   Com `APIFY_TOKEN` configurado, links do YouTube usam o actor
   `epctex/youtube-video-downloader` antes do fallback `yt-dlp`.
   Se optar pelo fallback e aparecer `Sign in to confirm you're not a bot`,
   exporte cookies do YouTube no formato Netscape cookies.txt, gere base64 e
   salve em `YOUTUBE_COOKIES_BASE64`:

   ```bash
   base64 -i youtube-cookies.txt | tr -d '\n'
   ```

   Depois configure a URL do worker no Supabase:

   ```bash
   supabase secrets set \
     VIDEO_WORKER_URL=https://seu-worker.example.com \
     VIDEO_WORKER_SECRET=
   ```

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
