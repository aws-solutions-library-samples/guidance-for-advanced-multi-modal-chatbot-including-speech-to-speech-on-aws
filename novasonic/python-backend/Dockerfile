FROM python:3.12-slim

WORKDIR /app

# Copy requirements file
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Set environment variables
ENV HOST=0.0.0.0
ENV WS_PORT=8081
ENV HEALTH_PORT=8082
ENV AWS_DEFAULT_REGION=us-east-1
ENV DEBUG=true
ENV LOGLEVEL=DEBUG

# Knowledge Base integration environment variables
# These will be overridden by the container environment variables
ENV REACT_APP_DOCUMENTS_KB_ID=""
ENV REACT_APP_AWS_REGION="us-east-1"
ENV USE_RAG="true"
ENV RAG_MODEL_ARN="anthropic.claude-3-haiku-20240307-v1:0"

# Expose ports
EXPOSE 8081 8082

# Run the application
CMD ["python", "server.py"]
