FROM node:22-alpine AS builder

WORKDIR /app/backend

# Install dependencies needed for building
COPY backend/package*.json ./
RUN npm ci --ignore-scripts

# Build TypeScript sources
COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app/backend

ENV NODE_ENV=production \
    PORT=8000 \
    PUBLIC_DIR=/app/public \
    DATABASE_PATH=/app/backend/data/db.sqlite

# Tiny init to forward signals in containers
RUN apk add --no-cache tini

# Build deps for native modules like better-sqlite3
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
  && apk add --no-cache libstdc++

# Install production dependencies (build native extensions)
COPY backend/package*.json ./
RUN npm ci --omit=dev \
  && apk del .build-deps

# Copy compiled backend
COPY --from=builder /app/backend/dist ./dist

# Provide a place for the SQLite database (mount a volume in production)
RUN mkdir -p /app/backend/data

# Copy static frontend assets that the backend serves
WORKDIR /app
COPY index.html /app/public/index.html
COPY css /app/public/css
COPY js /app/public/js
COPY manifest.webmanifest /app/public/manifest.webmanifest
COPY sw.js /app/public/sw.js
COPY icons /app/public/icons

WORKDIR /app/backend

EXPOSE 8000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
