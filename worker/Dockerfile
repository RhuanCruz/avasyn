FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir yt-dlp gallery-dl

ENV PATH="/opt/venv/bin:${PATH}"

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY worker ./worker

CMD ["node", "worker/server.mjs"]
