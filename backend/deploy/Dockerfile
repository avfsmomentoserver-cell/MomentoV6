# Momento v6.5 Python backend
# build (from repo root):  docker build -f backend/deploy/Dockerfile -t momento-backend backend
FROM python:3.12-slim
WORKDIR /srv/momento
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MOMENTO_DB=/data/momento.db
COPY pyproject.toml ./
RUN pip install --no-cache-dir "fastapi>=0.110" "uvicorn[standard]>=0.29" "numpy>=1.26" "pydantic>=2.6" "httpx>=0.27"
COPY app ./app
COPY momento ./momento
COPY momento_core ./momento_core
VOLUME ["/data"]
EXPOSE 8787
# one worker: the Core holds the stateful caches and the alarm scheduler (DO semantics)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1", "--proxy-headers"]
