# Root Dockerfile: the deployment entry point.
#
# Blocks' build runner (kaniko) builds with `--context /workspace/` and
# `--dockerfile Dockerfile`, both relative to the repository root, and the
# CLI exposes no way to point it at a subdirectory. The app lives in app/,
# so without this file the build fails with:
#   "error resolving dockerfile path: please provide a valid path to a
#    Dockerfile within the build context with --dockerfile"
#
# app/Dockerfile is kept for building from inside app/ locally; this one is
# the same build with app/-prefixed paths. Keep the two in step.
FROM node:22-alpine AS builder

WORKDIR /app

COPY app/package*.json ./

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY app/ ./

ARG ci_build=dev
ARG VITE_BLOCKS_API_URL
ARG VITE_BLOCKS_PROJECT_KEY
ARG VITE_BLOCKS_X_BLOCKS_KEY
ARG VITE_BLOCKS_APP_DOMAIN
ARG VITE_BLOCKS_OIDC_URL=https://iam.seliseblocks.com
ARG VITE_BLOCKS_OIDC_CLIENT_ID
ARG VITE_BLOCKS_OIDC_SCOPE="openid profile"
ARG VITE_BLOCKS_REDIRECT_URI
ARG VITE_BLOCKS_HOSTED_LOGIN=true

ENV VITE_BLOCKS_API_URL=${VITE_BLOCKS_API_URL}
ENV VITE_BLOCKS_PROJECT_KEY=${VITE_BLOCKS_PROJECT_KEY}
ENV VITE_BLOCKS_X_BLOCKS_KEY=${VITE_BLOCKS_X_BLOCKS_KEY}
ENV VITE_BLOCKS_APP_DOMAIN=${VITE_BLOCKS_APP_DOMAIN}
ENV VITE_BLOCKS_OIDC_URL=${VITE_BLOCKS_OIDC_URL}
ENV VITE_BLOCKS_OIDC_CLIENT_ID=${VITE_BLOCKS_OIDC_CLIENT_ID}
ENV VITE_BLOCKS_OIDC_SCOPE=${VITE_BLOCKS_OIDC_SCOPE}
ENV VITE_BLOCKS_REDIRECT_URI=${VITE_BLOCKS_REDIRECT_URI}
ENV VITE_BLOCKS_HOSTED_LOGIN=${VITE_BLOCKS_HOSTED_LOGIN}

RUN NODE_OPTIONS="--max-old-space-size=4096" npx vite build --mode "${ci_build}" \
  && node scripts/write-release-env.mjs "${ci_build}"

FROM nginxinc/nginx-unprivileged:1.29-alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY app/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
