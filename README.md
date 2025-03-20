# Chat with your multimedia content using AWS CDK, Amazon Bedrock Data Automation and Amazon Bedrock Knowledge Bases

## Overview
In the era of information overload, extracting meaningful insights from diverse data sources has become increasingly challenging. This becomes particularly difficult when businesses have terabytes of video and audio files, along with text based data and need to quickly access specific sections or topics, summarize content, or answer targeted questions using information sourced from these diverse files without having to switch context or solutions. 
This unified GenAI solution transforms how users interact with their data. This solution seamlessly integrates with various file formats including video, audio PDFs and text documents, providing a unified interface for knowledge extraction. Users can ask questions about their data, and the solution delivers precise answers, complete with source attribution. Responses are linked to their origin, which could include videos that load at the exact timestamp, for faster and efficient reference, PDF files or documents. 

This sample solution will demonstrate how to leverage AWS AI services to: 
* Process and index multi-format data at scale, including large video, audio and documents 
* Rapidly summarize extensive content from various file types 
* Deliver context-rich responses Provide an unified, intuitive user experience for seamless data exploration

https://github.com/user-attachments/assets/eabccee8-f780-43e6-ac31-064dacb48a09

## Architecture Overview

The application is implemented as a modular AWS CDK application with the following stack architecture:

1. **Storage Stack**
   - Media Bucket: Secure bucket for source files
   - Organized Bucket: Processed files destination
   - Application Host Bucket: React frontend host

2. **Auth Stack**
   - Cognito User Pool for authentication
   - Cognito Identity Pool for authorized access to AWS resources
   - User Pool Client for application integration

3. **OpenSearch Stack**
   - Vector database for semantic search capabilities
   - Embedding configuration for content indexing

4. **Processing Stack**
   - Initial Processing Lambda: Handles S3 uploads and triggers Bedrock Data Automation
   - Output Processing Lambda: Processes Bedrock Data Automation results and converts to searchable text
   - Retrieval Lambda: Handles user queries and response generation
   - Bedrock Knowledge Base configuration

5. **CloudFront Stack**
   - Content delivery configuration
   - Origin access controls
   - Distribution settings

6. **Lambda Edge Stack**
   - JWT validation at the edge
   - Request handling for protected content

7. **Frontend Stack**
   - React application build and deployment
   - Environment configuration
   - CloudFront integration

## Key Parameters

| Parameter | Description | Default/Constraints |
|-----------|-------------|-------------------|
| ModelId | The Amazon Bedrock supported LLM inference profile ID used for inference. | Default: "us.anthropic.claude-3-haiku-20240307-v1:0" |
| EmbeddingModelId | The Amazon Bedrock supported embedding LLM ID used in Bedrock Knowledge Bases. | Default: "amazon.titan-embed-text-v2:0" |
| ResourceSuffix | Suffix to append to resource names (e.g., dev, test, prod) | - Alphanumeric characters and hyphens only<br>- Pattern: ^[a-zA-Z0-9-]*$<br>- MinLength: 1<br>- MaxLength: 20 |

## Features
- Automatic media files transcription
- Support for multiple media formats
- Timestamped transcript generation
- User authentication using Amazon Cognito
- Automated deployment of both infrastructure and frontend
- Local development with cloud resources

## Security Features
- IAM roles with least privilege access
- Cognito user pool for authentication
- CloudFront resource URLs validated using Amazon Lambda@Edge
- Well-Architected security tagging and best practices

## Prerequisites
- AWS CLI with credentials configured
- Node.js and npm
- AWS CDK installed (`npm install -g aws-cdk`)
- Git (for cloning the repository)

# Deployment

## Option 1: Automated Deployment (Recommended)

The solution includes a comprehensive deployment script that handles all aspects of deployment:

1. Clone the repository and navigate to the project folder:
   ```bash
   git clone https://github.com/yourusername/multimedia-rag-chat-assistant.git
   cd multimedia-rag-chat-assistant
   ```

2. Run the deployment script:
   ```bash
   ./deploy.sh -e dev
   ```

This will deploy:
- All infrastructure stacks
- React frontend application
- Local development configuration

### Additional Deployment Options

Deploy with Lambda@Edge (JWT validation):
```bash
./deploy.sh -e dev -l
```

Deploy infrastructure only (skip frontend):
```bash
./deploy.sh -e dev -f
```

Deploy using a specific AWS profile:
```bash
./deploy.sh -e dev -p my-aws-profile
```

Generate local development configuration only:
```bash
./deploy.sh -e dev -i
```

For help and more options:
```bash
./deploy.sh -h
```

## Option 2: Manual CDK Deployment

If you prefer to control each step of the deployment process:

1. Install dependencies:
   ```bash
   cd cdk
   npm ci
   ```

2. Build the CDK app:
   ```bash
   npm run build
   ```

3. Bootstrap your AWS environment (if not already done):
   ```bash
   cdk bootstrap
   ```

4. Deploy the main stack:
   ```bash
   cdk deploy MultimediaRagStack --context resourceSuffix=dev --profile your-aws-profile
   ```

5. Deploy Lambda@Edge (if needed):
   ```bash
   cdk deploy LambdaEdgeStack --context deployEdgeLambda=true --context resourceSuffix=dev --profile your-aws-profile
   ```

6. Deploy the frontend:
   ```bash
   cdk deploy FrontendStack --context resourceSuffix=dev --profile your-aws-profile
   ```

7. Generate local development configuration:
   ```bash
   node ./scripts/generate-local-config.js --env dev --profile your-aws-profile
   ```

## Local Development

After deployment, you can run the React application locally while still connecting to cloud resources:

1. The deployment automatically creates a `.env.local` file in the `chatbot-react` directory with all necessary environment variables.

2. Start the React development server:
   ```bash
   cd chatbot-react
   npm start
   ```

3. Access the application at `http://localhost:3000`

## Usage

### Application Access
1. Access the deployed application using: `https://<CloudFront-Domain-Name>.cloudfront.net/`
2. Signup or Log in with your credentials
3. Use the left navigation pane to:
   - Upload files
   - Initiate data sync
   - Monitor sync status
4. Once sync is complete, start chatting with your data

### Test Guardrails
1. Create Guardrails from the Amazon Bedrock Console or obtain existing Guardrail ID and version
2. Use the left navigation pane to select 'Guardrails' from the dropdown
3. Provide the Guardrail ID and version 
4. Ask a question and test for blocked content

### Test different LLMs or Inference Configuration
1. Use the left navigation pane to select 'Inference Configuration' from the dropdown
2. Provide a Bedrock supported model's inference profile ID (This solution works best with Anthropic Claude 3 Haiku. Other LLMs might require prompt tuning)
3. Change Temperature and TopP
4. Ask a question and test inferred answer

## Data Upload Options
1. Direct S3 Upload: Place files in the media bucket
2. Web Interface: Upload through the application's UI

## Monitoring
- CloudWatch Logs for Lambda functions and upload/sync failures
- EventBridge rules for tracking file processing
- CDK Stack outputs for resource information

## Limitations
- Supports specific media file formats only (Refer to Amazon Bedrock Data Automation documentation)
- Maximum file size limitations apply based on AWS service limits
- Single document cannot exceed 20 pages
- Files have to be manually deleted from media and organized buckets, and Amazon Bedrock Knowledge Bases have to be manually synced to reflect these changes.

## This sample solution is intended to be used with public, non-sensitive data only
This is a demonstration/sample solution and is not intended for production use. Please note:
- Do not use sensitive, confidential, or critical data
- Do not process personally identifiable information (PII)
- Use only public data for testing and demonstration purposes
- This solution is provided for learning and evaluation purposes only

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
