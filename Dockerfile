FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package.json
RUN npm install --prefix frontend || (cd frontend && npm install)
COPY frontend/ frontend/
RUN cd frontend && npm run build

FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY data/ data/
COPY --from=frontend-build /frontend/dist/ backend/static/

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "backend"]
