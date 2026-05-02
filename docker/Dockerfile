# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock* .yarnrc.yml* ./
COPY server/package.json ./server/
COPY ui/package.json ./ui/
COPY desktop/package.json ./desktop/
RUN yarn install --immutable || yarn install

FROM deps AS build-ui
WORKDIR /app
COPY ui ./ui
RUN yarn workspace @mango/ui build

FROM deps AS build-server
WORKDIR /app
COPY server ./server
RUN yarn workspace @mango/server build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5180
ENV HOST=0.0.0.0
ENV STATIC_DIR=/app/public
ENV MANGO_DATA_DIR=/data
COPY --from=build-server /app/server/dist ./dist
COPY --from=build-server /app/server/package.json ./package.json
# Yarn 4 (`nodeLinker: node-modules`) hoists deps to the workspace root —
# the per-workspace `server/node_modules` only holds a sliver, if anything.
COPY --from=build-server /app/node_modules ./node_modules
COPY --from=build-ui /app/server/public ./public
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 5180
CMD ["node", "dist/index.js"]
