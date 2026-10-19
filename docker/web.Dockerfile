FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app
COPY . .
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1 CI=true
RUN pnpm install --frozen-lockfile --filter @omnichat/web... && pnpm --filter @omnichat/web build
USER node
EXPOSE 3000
CMD ["pnpm","--filter","@omnichat/web","start"]
