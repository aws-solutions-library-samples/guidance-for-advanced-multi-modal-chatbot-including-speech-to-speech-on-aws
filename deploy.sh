#!/bin/bash
set -e  # Exit on error

# Script to deploy the multimedia-rag-chat-assistant

# Configuration with defaults
ENV="dev"
REGION=$(aws configure get region || echo "us-west-2")
EDGE_LAMBDA="false"
SKIP_FRONTEND="false"
SKIP_INFRASTRUCTURE="false"
LOCAL_CONFIG_ONLY="false"

# Parse command line options
while getopts ":e:r:lfsih" opt; do
  case $opt in
    e) ENV="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    l) EDGE_LAMBDA="true" ;;
    f) SKIP_FRONTEND="true" ;;
    s) SKIP_INFRASTRUCTURE="true" ;;
    i) LOCAL_CONFIG_ONLY="true" ;;
    h)
      echo "Usage: ./deploy.sh [options]"
      echo ""
      echo "Options:"
      echo "  -e ENV     Environment name (default: dev)"
      echo "  -r REGION  AWS region (default: from AWS CLI config)"
      echo "  -l         Deploy Lambda@Edge functions (us-east-1)"
      echo "  -f         Skip frontend deployment (infrastructure only)"
      echo "  -s         Skip infrastructure (frontend only)"
      echo "  -i         Generate local configuration only (no deployment)"
      echo "  -h         Show this help"
      exit 0
      ;;
    \?)
      echo "Invalid option: -$OPTARG" >&2
      exit 1
      ;;
    :)
      echo "Option -$OPTARG requires an argument." >&2
      exit 1
      ;;
  esac
done

# Print banner
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║            🚀 Multimedia RAG Chat Assistant Deployment         ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "Deploy Edge Lambda: $EDGE_LAMBDA"
echo ""

# Ensure commander package is installed for the config generator
if [ "$SKIP_INFRASTRUCTURE" = "false" ] || [ "$LOCAL_CONFIG_ONLY" = "true" ]; then
  echo "📦 Checking dependencies..."
  cd cdk
  npm list commander || npm install commander --no-save
  cd ..
fi

# Step 1: Deploy Infrastructure Stack (if not skipped)
if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "📦 Deploying infrastructure stack..."
  cd cdk
  npm ci
  npm run build
  npx cdk deploy MultimediaRagStack --context resourceSuffix=$ENV --require-approval=never
  cd ..
fi

# Step 2: Deploy Lambda@Edge (if requested)
if [ "$EDGE_LAMBDA" = "true" ] && [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "🌐 Deploying Lambda@Edge stack to us-east-1..."
  cd cdk
  npx cdk deploy LambdaEdgeStack --context deployEdgeLambda=true --context resourceSuffix=$ENV --require-approval=never
  cd ..
fi

# Step 3: Generate local development configuration
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating local development configuration..."
  cd cdk
  node ./scripts/generate-local-config.js --env $ENV --region $REGION
  cd ..
fi

# Step 4: Deploy frontend (if not skipped)
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "🖥️  Building and deploying React frontend..."
  cd cdk
  npx cdk deploy FrontendStack --context resourceSuffix=$ENV --require-approval=never
  cd ..
fi

echo "✅ Deployment complete!"
echo ""
echo "To run the React app locally:"
echo "  cd chatbot-react"
echo "  npm start"
echo ""
echo "Your app will use cloud resources from the '$ENV' environment."
