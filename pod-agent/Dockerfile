FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py triage_local.py portal.html ./
COPY hazard-packs ./hazard-packs
RUN mkdir -p /data
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
