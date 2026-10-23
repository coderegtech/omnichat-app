FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ git && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
COPY . .
ENV CI=true
RUN pnpm install --frozen-lockfile --filter @omnichat/api... --filter @omnichat/database... && pnpm db:generate && pnpm --filter @omnichat/api build
RUN mkdir -p /data/uploads && chown -R node:node /app /data
USER node
EXPOSE 4000
CMD ["pnpm","--filter","@omnichat/api","start"]
