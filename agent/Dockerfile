FROM python:3.12-slim
WORKDIR /app
COPY agent/requirements.lock.txt .
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir --timeout 120 --retries 5 --index-url "$PIP_INDEX_URL" -r requirements.lock.txt
COPY agent/ .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
