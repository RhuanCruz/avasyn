FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

# Bump YTDLP_CACHEBUST (any new value) to force a fresh yt-dlp/gallery-dl install
# on rebuild. Without it Docker reuses this layer and keeps shipping the pinned
# old yt-dlp, which is what breaks TikTok/YouTube extractors over time.
ARG YTDLP_CACHEBUST=2026-08-21

# `curl-cffi` is required: the TikTok extractor needs browser impersonation and
# without it every request fails with "no impersonate target is available".
# `default` brings the local EJS support some YouTube videos need.
RUN echo "ytdlp-cachebust=${YTDLP_CACHEBUST}" \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade "yt-dlp[default,curl-cffi]" gallery-dl \
  && /opt/venv/bin/yt-dlp --version \
  && /opt/venv/bin/python -c "import curl_cffi.requests; print('curl_cffi ok')"

ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY worker ./worker

CMD ["node", "worker/server.mjs"]
