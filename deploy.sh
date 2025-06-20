#!/bin/bash
set -e  # Exit on error

# Simplified deployment script for Multimedia RAG Chat Assistant with Speech-to-Speech capabilities
# Uses SSM Parameter Store for Lambda@Edge configuration - eliminates complex ARN passing

# Configuration with defaults
ENV="dev"
PROFILE="default"
REGION=$(aws configure get region || echo "us-east-1")
EDGE_LAMBDA="false"
SKIP_FRONTEND="false"
SKIP_INFRASTRUCTURE="false"
LOCAL_CONFIG_ONLY="false"
S2S_ENABLED="true"
ECR_REPO_NAME="speech-to-speech-backend"

# Parse command line options
while getopts ":e:r:p:lfsiSh" opt; do
  case $opt in
    e) ENV="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
    l) EDGE_LAMBDA="true" ;;
    f) SKIP_FRONTEND="true" ;;
    s) SKIP_INFRASTRUCTURE="true" ;;
    i) LOCAL_CONFIG_ONLY="true" ;;
    S) S2S_ENABLED="false" ;;
    h)
      echo "Usage: ./deploy.sh [options]"
      echo ""
      echo "Options:"
      echo "  -e ENV     Environment name (default: dev)"
      echo "  -r REGION  AWS region (default: from AWS CLI config)"
      echo "  -p PROFILE AWS profile name to use (default: default)"
      echo "  -l         Deploy Lambda@Edge functions (always in us-east-1)"
      echo "  -f         Skip frontend deployment (infrastructure only)"
      echo "  -s         Skip infrastructure (frontend only)"
      echo "  -i         Generate local configuration only (no deployment)"
      echo "  -S         Disable Speech-to-Speech capabilities (enabled by default)"
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

# Check region compatibility with Speech-to-Speech
if [ "$S2S_ENABLED" = "true" ] && [ "$REGION" != "us-east-1" ]; then
  echo "⚠️ Warning: Speech-to-Speech deployment requires us-east-1 region"
  echo "   Current region: $REGION"
  echo "   Speech-to-Speech capabilities will be disabled. Re-run with -r us-east-1 to enable Speech-to-Speech."
  S2S_ENABLED="false"
fi

# Print banner
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║       🚀 Multimedia RAG Chat Assistant Deployment              ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "AWS Profile: $PROFILE"
echo "Deploy Edge Lambda: $EDGE_LAMBDA"
echo "Deploy Speech-to-Speech: $S2S_ENABLED"
echo ""

# Ensure commander package is installed for the config generator
if [ "$SKIP_INFRASTRUCTURE" = "false" ] || [ "$LOCAL_CONFIG_ONLY" = "true" ]; then
  echo "📦 Checking dependencies..."
  cd cdk
  npm list commander || npm install commander --no-save
  cd ..
fi

# Note: React frontend build moved after environment variables are generated

# Step 2: Deploy Infrastructure Stack (if not skipped)
if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  # Prepare deployment context variables
  DEPLOY_CONTEXT="--context resourceSuffix=$ENV"
  
  # Add frontend context flag if needed
  if [ "$SKIP_FRONTEND" = "false" ]; then
    echo "Deploying with frontend support..."
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deployFrontend=true"
  fi
  
  # Add edge lambda context flag if needed
  if [ "$EDGE_LAMBDA" = "true" ]; then
    echo "Deploying with Lambda@Edge support..."
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deployEdgeLambda=true"
  fi
  
  # Add speech-to-speech context flag if needed
  if [ "$S2S_ENABLED" = "true" ]; then
    echo "Deploying with Speech-to-Speech support..."
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context deploySpeechToSpeech=true"
  fi
  
  # Step 2.1: Deploy Lambda@Edge stack first if requested (must be in us-east-1)
  if [ "$EDGE_LAMBDA" = "true" ]; then
    echo "📦 Deploying Lambda@Edge stack in us-east-1..."
    cd cdk
    npm ci
    npm run build
    
    # Deploy Lambda@Edge stack in us-east-1 with target region context
    echo "Deploying LambdaEdgeStack-$ENV..."
    npx cdk deploy "LambdaEdgeStack-$ENV" $DEPLOY_CONTEXT --context targetRegion=$REGION --profile $PROFILE --region us-east-1 --require-approval=never
    
    echo "✅ Lambda@Edge deployed successfully (will read Cognito config from SSM in $REGION)"
    cd ..
  fi
  
  # Step 2.2: Prepare for Speech-to-Speech if requested (must be in us-east-1)
  if [ "$S2S_ENABLED" = "true" ]; then
    echo "📦 Preparing Speech-to-Speech backend..."
    
    # Step 2.2.1: Get or create ECR repository
    echo "=== Getting or creating ECR repository ==="
    ECR_REPO_URI=$(aws ecr describe-repositories --repository-names "$ECR_REPO_NAME-$ENV" --profile $PROFILE --region us-east-1 --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo "")

    if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
      echo "ECR repository not found in region us-east-1. Creating it now..."
      aws ecr create-repository --repository-name "$ECR_REPO_NAME-$ENV" --profile $PROFILE --region us-east-1
      
      # Get the URI of the newly created repository
      ECR_REPO_URI=$(aws ecr describe-repositories --repository-names "$ECR_REPO_NAME-$ENV" --profile $PROFILE --region us-east-1 --query 'repositories[0].repositoryUri' --output text)
      
      if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
        echo "Failed to create ECR repository. Please check your AWS credentials and permissions."
        exit 1
      else
        echo "Successfully created ECR repository: $ECR_REPO_URI"
      fi
    fi
    
    # Step 2.2.2: Build and push Docker image
    echo "=== Building and pushing Docker image ==="
    cd speech-backend

    echo "Using ECR repository: $ECR_REPO_URI"

    # Get ECR login token
    echo "Logging in to ECR..."
    aws ecr get-login-password --profile $PROFILE --region us-east-1 | docker login --username AWS --password-stdin $ECR_REPO_URI
    if [ $? -ne 0 ]; then
      echo "Failed to log in to ECR. Please check your AWS credentials and permissions."
      exit 1
    fi

    # Build Docker image
    echo "Building Docker image..."
    # Build for AMD64 platform specifically
    docker buildx build --platform linux/amd64 -t "$ECR_REPO_NAME-$ENV:latest" --load .
    if [ $? -ne 0 ]; then
      echo "Docker build failed. Please check the Dockerfile and your Docker installation."
      exit 1
    fi

    # Tag and push Docker image
    echo "Tagging and pushing Docker image to ECR..."
    docker tag "$ECR_REPO_NAME-$ENV:latest" "$ECR_REPO_URI:latest"
    docker push "$ECR_REPO_URI:latest"
    if [ $? -ne 0 ]; then
      echo "Failed to push Docker image to ECR. Please check your network connection and AWS permissions."
      exit 1
    fi

    echo "Successfully pushed Docker image to ECR: $ECR_REPO_URI:latest"
    cd ..
    
    # Add ECR repository name to context for Speech-to-Speech stack
    DEPLOY_CONTEXT="$DEPLOY_CONTEXT --context ecrRepositoryName=$ECR_REPO_NAME-$ENV"
  fi
  
  # Step 2.3: Deploy MultimediaRagStack
  echo "📦 Deploying MultimediaRagStack..."
  cd cdk
  
  # Ensure dependencies are installed
  if [ "$EDGE_LAMBDA" != "true" ]; then
    # Only run these if not already done for Lambda@Edge
    npm ci
    npm run build
  fi
  
  # Deploy the MultimediaRagStack with the appropriate context
  echo "Deploying MultimediaRagStack-$ENV..."
  npx cdk deploy "MultimediaRagStack-$ENV" $DEPLOY_CONTEXT --profile $PROFILE --region $REGION --require-approval=never
  cd ..
fi

# Step 3: Generate local and production configurations
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating configurations..."
  
  # Step 3.1: Get outputs from MultimediaRagStack
  echo "🔍 Getting outputs from MultimediaRagStack..."
  
  # Get Lambda function name
  LAMBDA_FUNCTION_NAME=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='RetrievalFunctionName'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get Media bucket name
  MEDIA_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get Cognito User Pool ID
  USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get Cognito User Pool Client ID
  USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoUserPoolClientId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get Cognito Identity Pool ID
  IDENTITY_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CognitoIdentityPoolId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get CloudFront Domain Name
  CLOUDFRONT_DOMAIN_FULL=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Strip .cloudfront.net suffix to get just the subdomain
  CLOUDFRONT_DOMAIN=${CLOUDFRONT_DOMAIN_FULL%.cloudfront.net}
  
  # Get Knowledge Base ID
  KNOWLEDGE_BASE_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='DocumentsKnowledgeBaseId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Get Data Source ID
  DATA_SOURCE_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='DocumentsDataSourceId'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
  # Step 3.2: Get WebSocket URL from MultimediaRagStack if Speech-to-Speech is deployed
  WEBSOCKET_URL=""
  if [ "$S2S_ENABLED" = "true" ]; then
    echo "🔍 Getting WebSocket URL from MultimediaRagStack..."
    WEBSOCKET_URL=$(aws cloudformation describe-stacks \
      --stack-name "MultimediaRagStack-$ENV" \
      --query "Stacks[0].Outputs[?OutputKey=='WebSocketURL'].OutputValue" \
      --output text \
      --region $REGION \
      --profile $PROFILE)
    
    # If not found, look in us-east-1 region (nested stack might have outputs in parent region)
    if [ -z "$WEBSOCKET_URL" ] || [ "$WEBSOCKET_URL" == "None" ]; then
      echo "WebSocket URL not found in $REGION, checking us-east-1..."
      WEBSOCKET_URL=$(aws cloudformation describe-stacks \
        --stack-name "MultimediaRagStack-$ENV" \
        --query "Stacks[0].Outputs[?OutputKey=='WebSocketURL'].OutputValue" \
        --output text \
        --region us-east-1 \
        --profile $PROFILE)
    fi
    
    if [ -z "$WEBSOCKET_URL" ] || [ "$WEBSOCKET_URL" == "None" ]; then
      echo "⚠️ WebSocket URL not found in CloudFormation outputs"
      # Generate WebSocket URL from CloudFront domain
      if [ ! -z "$CLOUDFRONT_DOMAIN" ]; then
        WEBSOCKET_URL="wss://$CLOUDFRONT_DOMAIN/ws/speech-to-speech"
        echo "Generated WebSocket URL based on CloudFront domain: $WEBSOCKET_URL"
      fi
    else
      echo "WebSocket URL: $WEBSOCKET_URL"
    fi
  fi
  
  # Step 3.3: Generate complete .env file
  echo "📝 Generating .env file with all outputs..."
  cat > chatbot-react/.env << EOL
REACT_APP_LAMBDA_FUNCTION_NAME=$LAMBDA_FUNCTION_NAME
REACT_APP_S3_SOURCE=$MEDIA_BUCKET
REACT_APP_AWS_REGION=$REGION
REACT_APP_USER_POOL_ID=$USER_POOL_ID
REACT_APP_USER_POOL_CLIENT_ID=$USER_POOL_CLIENT_ID
REACT_APP_IDENTITY_POOL_ID=$IDENTITY_POOL_ID
REACT_APP_CLOUDFRONT_DOMAIN_NAME=$CLOUDFRONT_DOMAIN
REACT_APP_DOCUMENTS_KB_ID=$KNOWLEDGE_BASE_ID
REACT_APP_DOCUMENTS_DS_ID=$DATA_SOURCE_ID
REACT_APP_WEBSOCKET_URL=$WEBSOCKET_URL

# Speech-to-Speech Knowledge Base Integration Settings
USE_RAG=true
RAG_MODEL_ARN=anthropic.claude-3-haiku-20240307-v1:0
EOL

  echo "✅ Configuration generated successfully"
fi

# Step 4: Build React App with environment variables
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "🖥️  Building React frontend with environment variables..."
  cd chatbot-react
  npm install
  npm run build
  cd ..
fi

# Step 5: Deploy frontend to S3 if not skipped
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "📤 Deploying frontend to S3..."
  
  # Get the S3 bucket name from MultimediaRagStack outputs
  echo "🔍 Looking for application host bucket name..."
  APP_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
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
  
  # Get CloudFront distribution ID
  echo "🔍 Looking for CloudFront distribution ID..."
  CF_DIST_ID=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
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
if [ "$S2S_ENABLED" = "true" ]; then
  echo "Speech-to-Speech capabilities are enabled and integrated with the frontend."
else
  echo "Speech-to-Speech capabilities are disabled."
  if [ "$REGION" != "us-east-1" ]; then
    echo "To enable Speech-to-Speech, re-run with -r us-east-1 (as Speech-to-Speech is only available in us-east-1 region)."
  else
    echo "To enable Speech-to-Speech, re-run without the -S flag."
  fi
fi
