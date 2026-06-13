# Build frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Backend + serve frontend
FROM node:18-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm install --production

COPY backend/src/ ./src/
COPY --from=frontend-build /app/frontend/build ./public

# Serve frontend statically from Express
RUN echo "const express = require('express'); const path = require('path'); " >> ./src/serve-static.js && \
    echo "// Injected by Docker" >> ./src/serve-static.js

EXPOSE 5000

CMD ["node", "src/server.js"]
