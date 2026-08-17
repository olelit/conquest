FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY server/package.json server/package-lock.json ./
RUN npm ci

FROM deps AS dev
COPY server/ ./
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY server/ ./
RUN npm run build

FROM base AS prod
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "dist/index.js"]
