#!/bin/bash
set -e

# Configuration
REGION=${AWS_REGION:-"us-east-1"}
PROFILE=${AWS_PROFILE:-"default"}
ECR_REPO_NAME="nova-sonic-backend"
CLUSTER_NAME="nova-sonic-backend"
STACK_NAME="NovaSonicBackendStack"

echo "=== Nova Sonic Deployment Script ==="
echo "Using AWS Region: $REGION"
echo "Using AWS Profile: $PROFILE"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "AWS CLI is not installed. Please install it first."
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install it first."
    exit 1
fi

# Step 1: Export environment variables from chatbot-react/.env
echo "=== Exporting environment variables from chatbot-react/.env ==="
if [ -f "../guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/.env" ]; then
    echo "Found .env file, exporting variables..."
    # Export REACT_APP_* variables
    export $(grep -v '^#' ../guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/.env | grep REACT_APP_ | xargs)
    # Export USE_RAG and RAG_MODEL_ARN variables
    export $(grep -v '^#' ../guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/.env | grep USE_RAG | xargs)
    export $(grep -v '^#' ../guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/.env | grep RAG_MODEL_ARN | xargs)
    
    # Print the exported variables for debugging
    echo "Exported environment variables:"
    echo "REACT_APP_DOCUMENTS_KB_ID: $REACT_APP_DOCUMENTS_KB_ID"
    echo "REACT_APP_AWS_REGION: $REACT_APP_AWS_REGION"
    echo "USE_RAG: $USE_RAG"
    echo "RAG_MODEL_ARN: $RAG_MODEL_ARN"
else
    echo "Warning: .env file not found in ../guidance-for-multi-media-chatbot-on-aws-feature-cdk-migration/chatbot-react/"
fi

# Step 2: Install dependencies for infrastructure
echo "=== Installing infrastructure dependencies ==="
cd infrastructure
npm install
cd ..

# Step 2: Get or create ECR repository
echo "=== Getting or creating ECR repository ==="
ECR_REPO_URI=$(aws ecr describe-repositories --repository-names $ECR_REPO_NAME --profile $PROFILE --region $REGION --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo "")

if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
    echo "ECR repository not found in region $REGION. Creating it now..."
    aws ecr create-repository --repository-name $ECR_REPO_NAME --profile $PROFILE --region $REGION
    
    # Get the URI of the newly created repository
    ECR_REPO_URI=$(aws ecr describe-repositories --repository-names $ECR_REPO_NAME --profile $PROFILE --region $REGION --query 'repositories[0].repositoryUri' --output text)
    
    if [ -z "$ECR_REPO_URI" ] || [ "$ECR_REPO_URI" == "None" ]; then
        echo "Failed to create ECR repository. Please check your AWS credentials and permissions."
        exit 1
    else
        echo "Successfully created ECR repository: $ECR_REPO_URI"
    fi
fi

# Step 3: Build and push Docker image
echo "=== Building and pushing Docker image ==="
cd python-backend

echo "Using ECR repository: $ECR_REPO_URI"

# Get ECR login token
echo "Logging in to ECR..."
aws ecr get-login-password --profile $PROFILE --region $REGION | docker login --username AWS --password-stdin $ECR_REPO_URI
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
cd ..

# Step 4: Build and deploy CDK stack
echo "=== Building and deploying ECS stack ==="
cd infrastructure
# Set CDK_DEFAULT_REGION to ensure CDK uses the correct region
export CDK_DEFAULT_REGION=$REGION
echo "Setting CDK_DEFAULT_REGION to $REGION"
# Remove any existing context file that might override region settings
rm -f cdk.context.json
npm run build
# Deploy the ECS stack
npx cdk deploy $STACK_NAME --profile $PROFILE --region $REGION
cd ..

# Force a new deployment of the ECS service to use the latest image
echo "=== Getting ECS service name ==="
SERVICE_NAME=$(aws ecs list-services --cluster $CLUSTER_NAME --profile $PROFILE --region $REGION --query 'serviceArns[0]' --output text | awk -F'/' '{print $NF}')

if [ -z "$SERVICE_NAME" ] || [ "$SERVICE_NAME" == "None" ]; then
    echo "No ECS service found in cluster $CLUSTER_NAME"
else
    echo "Found ECS service: $SERVICE_NAME"
    echo "=== Forcing new deployment of ECS service ==="
    # Use --no-cli-pager to prevent the full service description from being printed
    aws ecs update-service --cluster $CLUSTER_NAME --service $SERVICE_NAME --force-new-deployment --profile $PROFILE --region $REGION --no-cli-pager --output json > /dev/null
    echo "Service update initiated successfully"
    
    # Print just the essential service information
    echo "=== Current service status ==="
    aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --profile $PROFILE --region $REGION --query 'services[0].{Status:status,DesiredCount:desiredCount,RunningCount:runningCount,PendingCount:pendingCount,DeploymentStatus:deployments[0].status}' --output table
fi

echo "=== Deployment completed successfully ==="
echo "WebSocket URL can be found in the CDK stack outputs."
