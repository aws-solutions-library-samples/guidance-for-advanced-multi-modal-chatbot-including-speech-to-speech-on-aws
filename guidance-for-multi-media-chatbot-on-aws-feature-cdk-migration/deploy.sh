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
  
  # Define main stack to deploy (StorageDistStack is now part of MultimediaRagStack)
  STACKS="MultimediaRagStack-$ENV"
  
  # Add Lambda@Edge stack if specified
  if [ "$EDGE_LAMBDA" = "true" ]; then
    STACKS="$STACKS LambdaEdgeStack-$ENV"
  fi
  
  # Note: Frontend is now deployed directly via S3 sync
  
  # Deploy the stacks with the appropriate context
  echo "Deploying stacks: $STACKS"
  echo "With context: $DEPLOY_CONTEXT"
  npx cdk deploy $STACKS $DEPLOY_CONTEXT --profile $PROFILE --require-approval=never
  cd ..
fi

# Step 3: Generate local and production configurations
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating configurations..."
  cd cdk
  node ./scripts/generate-local-config.js --env $ENV --region $REGION --profile $PROFILE
  cd ..
fi

# Step 4: Deploy frontend to S3 if not skipped
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "📤 Deploying frontend to S3..."
  
  # Get the S3 bucket name from StorageDistStack outputs
  echo "🔍 Looking for application host bucket name..."
  APP_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name MultimediaRagStack-$ENV \
    --query "Stacks[0].Outputs[?contains(ExportName, 'ApplicationHostBucketName') || OutputKey=='ApplicationHostBucketName'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  if [ -z "$APP_BUCKET" ]; then
    echo "❌ Failed to get S3 bucket name from CloudFormation outputs"
    exit 1
  fi
  
  echo "📝 Using S3 bucket: $APP_BUCKET"
  
  # Perform the S3 sync
  echo "🔄 Syncing React build to S3..."
  aws s3 sync chatbot-react/build/ s3://$APP_BUCKET/ \
    --profile $PROFILE \
    --delete \
    --cache-control "max-age=3600"
  
  # Get CloudFront distribution ID - now in StorageDistStack inside MultimediaRagStack
  echo "🔍 Looking for CloudFront distribution ID..."
  CF_DIST_ID=$(aws cloudformation describe-stacks \
    --stack-name MultimediaRagStack-$ENV \
    --query "Stacks[0].Outputs[?contains(ExportName, 'CloudFrontDistributionId') || OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  if [ ! -z "$CF_DIST_ID" ]; then
    echo "🌐 Creating CloudFront invalidation..."
    aws cloudfront create-invalidation \
      --distribution-id $CF_DIST_ID \
      --paths "/*" \
      --profile $PROFILE
  else
    echo "⚠️ CloudFront distribution ID not found, skipping cache invalidation"
  fi
fi

echo "✅ Deployment complete!"
echo ""
echo "To run the React app locally:"
echo "  cd chatbot-react"
echo "  npm start"
echo ""
echo "Your app will use cloud resources from the '$ENV' environment."
