FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py triage.py webex.py dashboard.html ./
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "9000"]
