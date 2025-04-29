#!/bin/bash
set -e  # Exit on error

# Combined deployment script for Multimedia RAG Chat Assistant and NovaSonic

# Configuration with defaults
ENV="dev"
PROFILE="default"
REGION=$(aws configure get region || echo "us-east-1")
EDGE_LAMBDA="false"
SKIP_FRONTEND="false"
SKIP_INFRASTRUCTURE="false"
LOCAL_CONFIG_ONLY="false"
DEPLOY_NOVASONIC="false"
SKIP_NOVASONIC="false"
ECR_REPO_NAME="nova-sonic-backend"
CLUSTER_NAME="nova-sonic-backend"
NOVASONIC_STACK_NAME="NovaSonicBackendStack"

# Parse command line options
while getopts ":e:r:p:lfsinNh" opt; do
  case $opt in
    e) ENV="$OPTARG" ;;
    r) REGION="$OPTARG" ;;
    p) PROFILE="$OPTARG" ;;
    l) EDGE_LAMBDA="true" ;;
    f) SKIP_FRONTEND="true" ;;
    s) SKIP_INFRASTRUCTURE="true" ;;
    i) LOCAL_CONFIG_ONLY="true" ;;
    n) DEPLOY_NOVASONIC="true" ;;
    N) SKIP_NOVASONIC="true" ;;
    h)
      echo "Usage: ./deploy-combined.sh [options]"
      echo ""
      echo "Options:"
      echo "  -e ENV     Environment name (default: dev)"
      echo "  -r REGION  AWS region (default: from AWS CLI config, must be us-east-1 if using NovaSonic)"
      echo "  -p PROFILE AWS profile name to use (default: default)"
      echo "  -l         Deploy Lambda@Edge functions (always in us-east-1)"
      echo "  -f         Skip frontend deployment (infrastructure only)"
      echo "  -s         Skip infrastructure (frontend only)"
      echo "  -i         Generate local configuration only (no deployment)"
      echo "  -n         Deploy NovaSonic backend (requires us-east-1 region)"
      echo "  -N         Skip NovaSonic backend deployment"
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

# Check region compatibility with NovaSonic
if [ "$DEPLOY_NOVASONIC" = "true" ] && [ "$REGION" != "us-east-1" ]; then
  echo "❌ Error: NovaSonic deployment requires us-east-1 region"
  echo "   Current region: $REGION"
  echo "   Please use -r us-east-1 when deploying NovaSonic"
  exit 1
fi

# If both DEPLOY_NOVASONIC and SKIP_NOVASONIC are true, prioritize SKIP_NOVASONIC
if [ "$DEPLOY_NOVASONIC" = "true" ] && [ "$SKIP_NOVASONIC" = "true" ]; then
  echo "⚠️ Warning: Both -n and -N options provided. Prioritizing -N (Skip NovaSonic)"
  DEPLOY_NOVASONIC="false"
fi

# Print banner
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║       🚀 Combined Multimedia RAG & NovaSonic Deployment        ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo "Environment: $ENV"
echo "Region: $REGION"
echo "AWS Profile: $PROFILE"
echo "Deploy Edge Lambda: $EDGE_LAMBDA"
echo "Deploy NovaSonic: $DEPLOY_NOVASONIC"
echo ""

# Ensure commander package is installed for the config generator
if [ "$SKIP_INFRASTRUCTURE" = "false" ] || [ "$LOCAL_CONFIG_ONLY" = "true" ]; then
  echo "📦 Checking dependencies..."
  cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/cdk
  npm list commander || npm install commander --no-save
  cd ../..
fi

# Step 1: Build React App first (if not skipped)
if [ "$SKIP_FRONTEND" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  echo "🖥️  Building React frontend..."
  cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react
  npm install
  npm run build
  cd ../..
fi

# Step 2: Deploy Infrastructure Stack (if not skipped)
if [ "$SKIP_INFRASTRUCTURE" = "false" ] && [ "$LOCAL_CONFIG_ONLY" = "false" ]; then
  # Initialize variables for Lambda@Edge ARN
  EDGE_LAMBDA_ARN=""
  
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
  
  # Step 2.1: Deploy Lambda@Edge stack first if requested (must be in us-east-1)
  if [ "$EDGE_LAMBDA" = "true" ]; then
    echo "📦 Deploying Lambda@Edge stack in us-east-1..."
    cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/cdk
    npm ci
    npm run build
    
    # Deploy Lambda@Edge stack in us-east-1
    echo "Deploying LambdaEdgeStack-$ENV..."
    npx cdk deploy "LambdaEdgeStack-$ENV" $DEPLOY_CONTEXT --profile $PROFILE --region us-east-1 --require-approval=never
    
    # Get the Lambda@Edge ARN for use in MultimediaRagStack
    EDGE_LAMBDA_ARN=$(aws cloudformation describe-stacks \
      --stack-name "LambdaEdgeStack-$ENV" \
      --query "Stacks[0].Outputs[?OutputKey=='LambdaEdgeVersionArn'].OutputValue" \
      --output text \
      --region us-east-1 \
      --profile $PROFILE)
    
    echo "Lambda@Edge ARN: $EDGE_LAMBDA_ARN"
    cd ../..
  fi
  
  # Step 2.2: Deploy MultimediaRagStack
  echo "📦 Deploying MultimediaRagStack..."
  cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/cdk
  
  # Ensure dependencies are installed
  if [ "$EDGE_LAMBDA" != "true" ]; then
    # Only run these if not already done for Lambda@Edge
    npm ci
    npm run build
  fi
  
  # Deploy the MultimediaRagStack with the appropriate context
  echo "Deploying MultimediaRagStack-$ENV..."
  npx cdk deploy "MultimediaRagStack-$ENV" $DEPLOY_CONTEXT --profile $PROFILE --region $REGION --require-approval=never
  cd ../..
  
  # Step 2.3: Deploy NovaSonic if requested
  if [ "$DEPLOY_NOVASONIC" = "true" ] && [ "$SKIP_NOVASONIC" = "false" ]; then
    echo "📦 Deploying NovaSonic backend..."
    
    # Step 2.3.1: Get or create ECR repository
    echo "=== Getting or creating ECR repository ==="
    ECR_REPO_URI=$(aws ecr describe-repositories --repository-names $ECR_REPO_NAME --profile $PROFILE --region us-east-1 --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo "")

    if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
      echo "ECR repository not found in region us-east-1. Creating it now..."
      aws ecr create-repository --repository-name $ECR_REPO_NAME --profile $PROFILE --region us-east-1
      
      # Get the URI of the newly created repository
      ECR_REPO_URI=$(aws ecr describe-repositories --repository-names $ECR_REPO_NAME --profile $PROFILE --region us-east-1 --query 'repositories[0].repositoryUri' --output text)
      
      if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
        echo "Failed to create ECR repository. Please check your AWS credentials and permissions."
        exit 1
      else
        echo "Successfully created ECR repository: $ECR_REPO_URI"
      fi
    fi
    
    # Step 2.3.2: Build and push Docker image
    echo "=== Building and pushing Docker image ==="
    cd novasonic/python-backend

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
    docker build -t $ECR_REPO_NAME:latest .
    if [ $? -ne 0 ]; then
      echo "Docker build failed. Please check the Dockerfile and your Docker installation."
      exit 1
    fi

    # Tag and push Docker image
    echo "Tagging and pushing Docker image to ECR..."
    docker tag $ECR_REPO_NAME:latest $ECR_REPO_URI:latest
    docker push $ECR_REPO_URI:latest
    if [ $? -ne 0 ]; then
      echo "Failed to push Docker image to ECR. Please check your network connection and AWS permissions."
      exit 1
    fi

    echo "Successfully pushed Docker image to ECR: $ECR_REPO_URI:latest"
    cd ../..
    
    # Step 2.3.3: Build and deploy NovaSonic CDK stack
    echo "=== Building and deploying NovaSonic stack ==="
    cd novasonic/infrastructure
    # Set CDK_DEFAULT_REGION to ensure CDK uses the correct region
    export CDK_DEFAULT_REGION=us-east-1
    echo "Setting CDK_DEFAULT_REGION to us-east-1"
    # Remove any existing context file that might override region settings
    rm -f cdk.context.json
    npm install
    npm run build
    # Deploy the NovaSonic stack
    npx cdk deploy $NOVASONIC_STACK_NAME --profile $PROFILE --region us-east-1 --require-approval=never
    cd ../..

    # Force a new deployment of the ECS service to use the latest image
    echo "=== Getting ECS service name ==="
    SERVICE_NAME=$(aws ecs list-services --cluster $CLUSTER_NAME --profile $PROFILE --region us-east-1 --query 'serviceArns[0]' --output text | awk -F'/' '{print $NF}')

    if [ -z "$SERVICE_NAME" ] || [ "$SERVICE_NAME" == "None" ]; then
      echo "No ECS service found in cluster $CLUSTER_NAME"
    else
      echo "Found ECS service: $SERVICE_NAME"
      echo "=== Forcing new deployment of ECS service ==="
      # Use --no-cli-pager to prevent the full service description from being printed
      aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment --profile $PROFILE --region us-east-1 --no-cli-pager --output json > /dev/null
      echo "Service update initiated successfully"
      
      # Print just the essential service information
      echo "=== Current service status ==="
      aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --profile $PROFILE --region us-east-1 --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount,DeploymentStatus:deployments[0].status}' --output table
    fi
  fi
fi

# Step 3: Generate local and production configurations
if [ "$LOCAL_CONFIG_ONLY" = "true" ] || [ "$SKIP_INFRASTRUCTURE" = "false" ]; then
  echo "⚙️  Generating configurations..."
  
  # Step 3.1: Generate base configuration using existing script
  cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/cdk
  node ./scripts/generate-local-config.js --env $ENV --region $REGION --profile $PROFILE
  cd ../..
  
  # Step 3.2: Get outputs from MultimediaRagStack
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
  CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name "MultimediaRagStack-$ENV" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDomainName'].OutputValue" \
    --output text \
    --region $REGION \
    --profile $PROFILE)
  
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
  
  # Step 3.3: Get WebSocket URL from NovaSonic if deployed
  WEBSOCKET_URL=""
  if [ "$DEPLOY_NOVASONIC" = "true" ] && [ "$SKIP_NOVASONIC" = "false" ]; then
    echo "🔍 Getting WebSocket URL from NovaSonic stack..."
    WEBSOCKET_URL=$(aws cloudformation describe-stacks \
      --stack-name $NOVASONIC_STACK_NAME \
      --query "Stacks[0].Outputs[?OutputKey=='WebSocketURL'].OutputValue" \
      --output text \
      --region us-east-1 \
      --profile $PROFILE)
    
    echo "WebSocket URL: $WEBSOCKET_URL"
  fi
  
  # Step 3.4: Generate complete .env file
  echo "📝 Generating .env file with all outputs..."
  cat > guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/.env << EOL
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

# Amazon Nova Sonic Knowledge Base Integration Settings
USE_RAG=false
RAG_MODEL_ARN=us.amazon.nova-micro-v1:0
EOL

  echo "✅ Configuration generated successfully"
fi

# Step 4: Deploy frontend to S3 if not skipped
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
  aws s3 sync guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/build/ s3://$APP_BUCKET/ \
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
echo "  cd guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react"
echo "  npm start"
echo ""
echo "Your app will use cloud resources from the '$ENV' environment."
if [ "$DEPLOY_NOVASONIC" = "true" ] && [ "$SKIP_NOVASONIC" = "false" ]; then
  echo "NovaSonic backend is deployed and integrated with the frontend."
fi
