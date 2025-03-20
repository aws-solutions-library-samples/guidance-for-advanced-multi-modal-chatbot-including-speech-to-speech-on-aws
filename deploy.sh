#!/bin/bash
set -e  # Exit on error

# Script to deploy the multimedia-rag-chat-assistant

# Configuration with defaults
ENV="dev"
PROFILE="default"
REGION=$(aws configure get region || echo "us-east-1")
EDGE_LAMBDA="false"
SKIP_FRONTEND="false"
SKIP_INFRASTRUCTURE="false"
LOCAL_CONFIG_ONLY="false"

# Parse command line options
while getopts ":e:r:p:lfsih" opt; do
  case $opt in
    e) ENV="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
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
      echo "  -p PROFILE AWS profile name to use (default: default)"
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
echo "AWS Profile: $PROFILE"
echo "Deploy Edge Lambda: $EDGE_LAMBDA"
echo ""

# Ensure commander package is installed for the config generator
if [ "$SKIP_INFRASTRUCTURE" = "false" ] || [ "$LOCAL_CONFIG_ONLY" = "true" ]; then
  echo "📦 Checking dependencies..."
  cd cdk
  npm list commander || npm install commander --no-save
  cd ..
fi

# Step 1: Build React App first (if not skipped)
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "🖥️  Building React frontend..."
  cd chatbot-react
  npm install
  npm run build
  cd ..
fi

# Step 2: Deploy Infrastructure Stack (if not skipped)
if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "📦 Deploying infrastructure stack..."
  cd cdk
  npm ci
  npm run build
  
  # Prepare deployment context variables
  DEPLOY_CONTEXT="--context resourceSuffix=$ENV"
  
  # Add frontend context flag if needed
  if [ "$SKIP_FRONTEND" = "false" ]; then
    echo "Deploying FrontendStack stack..."
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deployFrontend=true"
  fi
  
  # Add edge lambda context flag if needed
  if [ "$EDGE_LAMBDA" = "true" ]; then
    echo "Deploying Lambda@Edge stack..."
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deployEdgeLambda=true"
  fi
  
  # Deploy the stack with the appropriate context
  echo "Deploying stack with context: $DEPLOY_CONTEXT"
  npx cdk deploy MultimediaRagStack-$ENV $DEPLOY_CONTEXT --profile $PROFILE --require-approval=never
  cd ..
fi

# Step 3: Generate local development configuration
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating local development configuration..."
  cd cdk
  node ./scripts/generate-local-config.js --env $ENV --region $REGION --profile $PROFILE
  cd ..
fi

echo "✅ Deployment complete!"
echo ""
echo "To run the React app locally:"
echo "  cd chatbot-react"
echo "  npm start"
echo ""
echo "Your app will use cloud resources from the '$ENV' environment."
