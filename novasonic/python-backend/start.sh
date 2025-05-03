#!/bin/bash

# Set environment variables if not already set
export HOST=${HOST:-"0.0.0.0"}
export WS_PORT=${WS_PORT:-"8081"}
export HEALTH_PORT=${HEALTH_PORT:-"8082"}
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-"us-east-1"}

echo "Starting Nova Sonic WebSocket Server"
echo "HOST: $HOST"
echo "WS_PORT: $WS_PORT"
echo "HEALTH_PORT: $HEALTH_PORT"
echo "AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION"

# Start the server
python server.py