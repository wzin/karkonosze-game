# Stage 1: build the Vite bundle (pnpm, lockfile-pinned).
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN pnpm build

# Stage 2: serve the static bundle with Caddy (same pattern as temple-runner,
# bananique and low-dynamic-range in homecloud).
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 80
