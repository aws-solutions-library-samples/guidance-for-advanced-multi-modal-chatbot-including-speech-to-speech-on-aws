# Knowledge Base Integration Debugging Guide

This guide provides instructions on how to debug and fix issues with the knowledge base integration in the NovaSonic backend.

## Overview of Changes

We've made several changes to improve the knowledge base integration:

1. **Enhanced Logging**: Added detailed logging to help identify issues with the knowledge base integration.
2. **Environment Variable Handling**: Improved how environment variables are passed from the chatbot-react frontend to the NovaSonic backend.
3. **Query Parameter Extraction**: Fixed the query parameter extraction in the `processToolUse` method to handle both "query" and "argName1" parameter names.
4. **Cross-Region Support**: Added support for cross-region knowledge base access (e.g., backend in us-east-1, knowledge base in us-west-2).
5. **Test Script**: Added a test script to help debug knowledge base integration issues.

## Debugging Steps

### 1. Test the Knowledge Base Integration Locally

Use the provided test script to test the knowledge base integration locally:

#### Same-Region Scenario

```bash
cd novasonic/python-backend
# Test with basic retrieval
./test_kb.py --kb-id 3QZG4IXJK3 --kb-region us-west-2 --backend-region us-west-2 --query "amazon community policy" --debug

# Test with RAG (retrieve and generate)
./test_kb.py --kb-id 3QZG4IXJK3 --kb-region us-west-2 --backend-region us-west-2 --query "amazon community policy" --use-rag --debug
```

#### Cross-Region Scenario

```bash
cd novasonic/python-backend
# Test with basic retrieval
./test_kb.py --kb-id 3QZG4IXJK3 --kb-region us-west-2 --backend-region us-east-1 --query "amazon community policy" --debug

# Test with RAG (retrieve and generate)
./test_kb.py --kb-id 3QZG4IXJK3 --kb-region us-west-2 --backend-region us-east-1 --query "amazon community policy" --use-rag --debug
```

Replace `3QZG4IXJK3` with your actual Knowledge Base ID and adjust the regions as needed.

### 2. Check Environment Variables

Make sure the following environment variables are set correctly in the chatbot-react/.env file:

```
REACT_APP_DOCUMENTS_KB_ID=your-knowledge-base-id
REACT_APP_AWS_REGION=your-knowledge-base-region
USE_RAG=true
RAG_MODEL_ARN=anthropic.claude-3-haiku-20240307-v1:0
```

Note that `REACT_APP_AWS_REGION` should be set to the region where your knowledge base is located, which might be different from the region where the NovaSonic backend is running.

### 3. Deploy with Updated Configuration

Deploy the NovaSonic backend with the updated configuration:

```bash
./deploy-combined.sh -n -r us-east-1
```

This will:
- Export environment variables from the chatbot-react/.env file
- Pass them to the NovaSonic backend container
- Deploy the updated NovaSonic backend

### 4. Check Logs

After deployment, check the logs for any errors:

```bash
# Get the ECS cluster and service name
CLUSTER_NAME="nova-sonic-backend"
SERVICE_NAME=$(aws ecs list-services --cluster $CLUSTER_NAME --region us-east-1 --query 'serviceArns[0]' --output text | awk -F'/' '{print $NF}')

# Get the task ARN
TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --region us-east-1 --query 'taskArns[0]' --output text)

# Get the log stream name
LOG_STREAM=$(aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $TASK_ARN --region us-east-1 --query 'tasks[0].containers[0].logStreamName' --output text)

# Get the log group name
LOG_GROUP="/ecs/nova-sonic-backend"

# View the logs
aws logs get-log-events --log-group-name $LOG_GROUP --log-stream-name $LOG_STREAM --region us-east-1
```

Look for any errors related to the knowledge base integration.

## Common Issues and Solutions

### 1. Knowledge Base ID Not Found

If you see an error like "Knowledge Base ID not configured" or "Knowledge Base not found", check:

- The REACT_APP_DOCUMENTS_KB_ID environment variable is set correctly
- The Knowledge Base exists in the specified region
- The IAM role has permissions to access the Knowledge Base

### 2. Region Mismatch

If you see an error related to the region, check:

- The REACT_APP_AWS_REGION environment variable is set correctly to the region where your knowledge base is located
- The Knowledge Base exists in the specified region
- The IAM role has permissions to access resources in both regions (if using cross-region)

### 3. Cross-Region Access Issues

If you're using a cross-region setup (e.g., backend in us-east-1, knowledge base in us-west-2) and experiencing issues:

- Verify that the IAM role has permissions to access Bedrock resources in both regions
- Check that the `bedrock-agent-runtime:Retrieve` and `bedrock-agent-runtime:RetrieveAndGenerate` permissions are included in the IAM policy
- Ensure that the knowledge base region is correctly passed to the Bedrock client
- Look for "Cross-region operation detected" log messages to confirm the system is aware of the cross-region setup

### 4. Tool Use Parameter Extraction

If the tool use parameter extraction is failing, check:

- The tool schema in s2sEvents.js defines the parameter as "query"
- The processToolUse method in s2s_session_manager.py is extracting the query parameter correctly
- The enhanced parameter extraction logic is looking for "query", "argName1", or any key containing "query"

### 5. RAG Model Not Found

If you see an error related to the RAG model, check:

- The RAG_MODEL_ARN environment variable is set correctly
- The model exists in the specified region
- The IAM role has permissions to access the model

## Additional Resources

- [Amazon Bedrock Knowledge Base Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base.html)
- [Amazon Bedrock RAG Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/knowledge-base-rag.html)
- [Cross-Region Access in AWS](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-requestedregion)
