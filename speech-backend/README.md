# Nova Sonic WebSocket Server

This is a WebSocket server implementation for Amazon Nova Sonic speech-to-speech (S2S) service. It provides a bidirectional streaming interface between web clients and Amazon Bedrock's Nova Sonic model.

## Features

- WebSocket server for real-time audio streaming
- Health check endpoint for container deployments
- CORS support for cross-origin connections
- Automatic credential management using ECS task roles
- Tool use capabilities for integrations

## Prerequisites

- Python 3.12+
- AWS credentials with access to Amazon Bedrock and Nova Sonic
- Docker (for containerized deployment)

## Environment Variables

The server requires the following environment variables:

- `HOST`: Host to bind the server to (use '0.0.0.0' for container deployment)
- `WS_PORT`: WebSocket server port (default: 8081)
- `HEALTH_PORT`: Health check HTTP port (default: 8082)
- `AWS_DEFAULT_REGION`: AWS region for Bedrock (default: 'us-east-1')

## Local Development

1. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the server:
   ```bash
   export HOST=localhost
   export WS_PORT=8081
   export HEALTH_PORT=8082
   python server.py
   ```

## Docker Deployment

1. Build the Docker image:
   ```bash
   docker build -t nova-sonic-app .
   ```

2. Run the container:
   ```bash
   docker run -p 8081:8081 -p 8082:8082 nova-sonic-app
   ```

## AWS Deployment

Use the provided `deploy.sh` script to deploy to AWS:

```bash
./deploy.sh
```

This will:
1. Create an ECR repository if it doesn't exist
2. Build and push the Docker image
3. Deploy the CloudFormation stack with the Fargate service

## Architecture

The server consists of the following components:

- `server.py`: Main entry point that starts the WebSocket server and health check endpoint
- `s2s_session_manager.py`: Manages bidirectional streaming with Nova Sonic
- `s2s_events.py`: Utility class for creating Nova Sonic events

## AWS Infrastructure

The infrastructure is defined using AWS CDK in the `infrastructure` folder. It creates:

- VPC with public and private subnets
- ECS Fargate cluster and service
- Network Load Balancer for WebSocket connections
- IAM roles with necessary permissions
- CloudWatch dashboard for monitoring

## Credentials Management

The server relies on the ECS container agent to provide and refresh AWS credentials automatically. The task role assigned to the Fargate task has the necessary permissions for Bedrock access.

## WebSocket API

Connect to the WebSocket server at `ws://<nlb-dns>:8081/ws/nova-sonic` to start a session.

## Health Check

The health check endpoint is available at `http://<nlb-dns>:8082/health` and returns a 200 OK response when the server is healthy.