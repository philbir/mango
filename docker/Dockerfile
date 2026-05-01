# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json yarn.lock* .yarnrc.yml* ./
COPY server/package.json ./server/
COPY ui/package.json ./ui/
RUN yarn install --immutable || yarn install

FROM deps AS build-ui
WORKDIR /app
COPY ui ./ui
RUN yarn workspace @antoniq/mongo-manager-ui build

FROM deps AS build-server
WORKDIR /app
COPY server ./server
RUN yarn workspace @antoniq/mongo-manager-server build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5180
ENV STATIC_DIR=/app/public
COPY --from=build-server /app/server/dist ./dist
COPY --from=build-server /app/server/package.json ./package.json
COPY --from=build-server /app/server/node_modules ./node_modules
COPY --from=build-ui /app/server/public ./public
EXPOSE 5180
CMD ["node", "dist/index.js"]
