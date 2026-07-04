# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY tsconfig.json package.json ./
COPY src/ ./src/
COPY scenarios/ ./scenarios/
RUN npm install -g typescript && tsc -p tsconfig.json

# Stage 2: Runtime
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY scenarios/ ./scenarios/
COPY src/support.js ./src/support.js
COPY "src/No Route to Host.dc.html" "./src/No Route to Host.dc.html"
COPY src/.thumbnail ./src/.thumbnail

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost:3000/api/scenarios || exit 1

CMD ["node", "dist/server/index.js"]
