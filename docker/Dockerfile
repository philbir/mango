# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
COPY ui/package.json ./ui/
COPY docs-site/package.json ./docs-site/
COPY desktop/package.json ./desktop/
RUN pnpm install --frozen-lockfile

FROM deps AS build-ui
WORKDIR /app
COPY ui ./ui
RUN pnpm --filter @mango/ui build

FROM deps AS build-server
WORKDIR /app
COPY server ./server
RUN pnpm --filter @mango/server build
# Self-contained prod-only node_modules for the runtime image (pnpm's workspace
# node_modules is symlinked into the root store, so it can't be copied as-is).
# --legacy: the server has no workspace:* deps, so no injection is needed.
RUN pnpm --filter @mango/server deploy --legacy --prod /out

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5180
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/public
ENV MANGO_DATA_DIR=/data
# MongoDB Database Tools (mongoexport, mongoimport, mongodump, mongorestore)
# powers the Database Info page's import/export panel. Without these binaries
# on PATH, the server's boot-time probe leaves `dbToolsAvailable: false` and
# the UI hides the section.
RUN apk add --no-cache mongodb-tools
COPY --from=build-server /app/server/dist ./dist
COPY --from=build-server /out/package.json ./package.json
COPY --from=build-server /out/node_modules ./node_modules
COPY --from=build-ui /app/server/public ./public
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 5180
CMD ["node", "dist/index.js"]
