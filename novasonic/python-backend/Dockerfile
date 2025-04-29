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

# Expose ports
EXPOSE 8081 8082

# Run the application
CMD ["python", "server.py"]