FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    HOME=/tmp \
    GOCACHE=/tmp/go-cache \
    GOMODCACHE=/tmp/go-mod-cache \
    TREE_SITTER_CACHE_DIR=/tmp/tree-sitter

WORKDIR /app
RUN addgroup --system graphmind && adduser --system --ingroup graphmind --home /app graphmind
RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm default-jdk-headless gcc g++ golang-go r-base-core \
    && npm install --global typescript \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=graphmind:graphmind . .
RUN mkdir -p /app/data && chown -R graphmind:graphmind /app
RUN mkdir -p /tmp/tree-sitter && chown -R graphmind:graphmind /tmp
USER graphmind

ENV DATABASE_PATH=/app/data/graphmind.db
EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
