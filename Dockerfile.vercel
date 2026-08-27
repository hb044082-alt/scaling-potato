FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y wget && \
    rm -rf /var/lib/apt/lists/*

RUN wget -O /app/index.js \
    "https://raw.githubusercontent.com/hb044082-alt/scaling-potato/refs/heads/main/index.js"

RUN npm init -y && \
    npm install @whiskeysockets/baileys pino

ENV NODE_ENV=production
ENV PORT=5900

EXPOSE 5900

CMD ["node", "/app/index.js"]
