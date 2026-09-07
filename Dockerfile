# Multi-stage build, same technique as the sibling Purchase Division service
# (BB-PurchaseDomain/Dockerfile): stage 1 builds the React console with Node,
# stage 2 is Python + FastAPI with only the built frontend/dist copied in.
# Mirrors how the app already runs — one FastAPI process serving both the API
# and the built console on one port (see the "built frontend" mount at the
# bottom of backend/app/main.py) — so Docker doesn't change the architecture,
# it just makes the two-step build (npm run build, then restart the backend)
# into one `docker build`.

# ── stage 1: build the React console ────────────────────────────────────────
FROM node:20-slim AS fe-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN node node_modules/vite/bin/vite.js build

# ── stage 2: the backend, with the built console alongside it ──────────────
FROM python:3.12-slim AS backend
WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
# main.py resolves the frontend as ../../frontend/dist relative to itself
# (backend/app/main.py -> repo root -> frontend/dist), and config.py resolves
# .env and data/ the same way (relative to backend/app/core, up to repo
# root) — so the image's layout has to mirror the repo's layout exactly, not
# just "the files exist somewhere."
COPY --from=fe-build /app/frontend/dist frontend/dist

# .env and data/ are runtime state (secrets, generated dataset), not image
# content — bind-mounted in via docker-compose.yml so a rebuild/redeploy
# never touches them and never bakes credentials into the image.
EXPOSE 8001
CMD ["python", "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8001"]
