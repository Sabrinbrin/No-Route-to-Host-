# Stage 1: Build the monorepo (engine + web bundle)
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/ ./packages/
COPY scenarios/ ./scenarios/
RUN npm ci && npm run build

# Stage 2: Serve the static Vite build (the game runs entirely client-side)
FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=builder /app/packages/frontend/dist/ ./public/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:8080/ >/dev/null 2>&1 || exit 1

CMD ["serve", "-s", "public", "-l", "8080"]
