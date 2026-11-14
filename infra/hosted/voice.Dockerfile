# syntax=docker/dockerfile:1
# Voice worker image. Build context: voice/. No secret is copied or baked in.
# Licence: the `av` wheel bundles FFmpeg built with GPL code. Build this image
# on the server or keep it in a PRIVATE registry until the owner decides the
# open question in AGENTS.md. Never push it to a public registry.
ARG PYTHON_IMAGE=python:3.13.13-slim-bookworm@sha256:355bfa66770995d7e9a0da4b3473b44d0cb451f6b56f5615ad9c39e3c4eca03f
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.11.13@sha256:841c8e6fe30a8b07b4478d12d0c608cba6de66102d29d65d1cc423af86051563

FROM ${UV_IMAGE} AS uv

FROM ${PYTHON_IMAGE} AS build
COPY --from=uv /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY jomcall_voice ./jomcall_voice

FROM ${PYTHON_IMAGE} AS runtime
RUN groupadd --system --gid 10001 jomcall \
 && useradd --system --uid 10001 --gid jomcall --home-dir /nonexistent --shell /usr/sbin/nologin jomcall \
 && mkdir -p /data/cache /data/stages \
 && chown jomcall:jomcall /data/cache /data/stages
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
COPY --from=build /app/jomcall_voice /app/jomcall_voice
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    JOMCALL_VOICE_CACHE_DIR=/data/cache \
    JOMCALL_VOICE_STAGES_DIR=/data/stages
USER jomcall
# `start` is the production mode. A call is capped at 300 s, so a stop waits
# up to 320 s for running calls; Compose gives the container 330 s.
CMD ["python", "-m", "jomcall_voice", "start", "--drain-timeout", "320"]
