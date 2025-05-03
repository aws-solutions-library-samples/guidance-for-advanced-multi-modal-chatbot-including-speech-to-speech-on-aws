# Chat with your multimedia content using AWS CDK, Amazon Bedrock Data Automation and Amazon Bedrock Knowledge Bases

## Overview
Extracting meaningful insights from diverse data sources has become increasingly challenging. This becomes particularly difficult when businesses have terabytes of video and audio files, along with text based data and need to quickly access specific sections or topics, summarize content, or answer targeted questions using information sourced from these diverse files without having to switch context or solutions. 
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
| EmbeddingModelId | The Amazon Bedrock supported embedding LLM ID used in Bedrock Knowledge Base. | Default: "amazon.titan-embed-text-v2:0" |
| DataParser | The data processing strategy to use for multimedia content. | Default: "Bedrock Data Automation" |
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
- All infrastructure stacks with default options
- React frontend application
- Local development configuration

### Deployment Options

| Option | Description | Default |
|--------|-------------|---------|
| -e ENV | Environment name for resource naming | dev |
| -r REGION | AWS region | from AWS CLI config |
| -p PROFILE | AWS profile name to use | default |
| -l | Deploy Lambda@Edge functions (in us-east-1) | false |
| -f | Skip frontend deployment (infrastructure only) | false |
| -s | Skip infrastructure deployment (frontend only) | false |
| -i | Generate local configuration only (no deployment) | false |
| -h | Show help message | - |

### Example Deployment Commands

Deploy with Lambda@Edge (JWT validation):
```bash
./deploy.sh -e dev -l
```

Deploy infrastructure only (skip frontend):
```bash
./deploy.sh -e dev -f
```

Deploy using a specific AWS profile and region:
```bash
./deploy.sh -e dev -p my-aws-profile -r us-west-2
```

Generate local development configuration only:
```bash
./deploy.sh -e dev -i
```
3. Replace placeholder values with chatbot.yaml CloudFormation stack outputs
4. Build and Deploy Frontend
      * Install dependencies
      ```npm install```
      * Build the application
      ```npm run build```
5. Upload the contents of chatbot-react/build to ```< ReactAppHostBucket>``` Amazon S3 bucket
![deploy-app](https://github.com/user-attachments/assets/112b08be-af4b-4619-887d-a98384b416aa)

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

## Supported File Formats

The application supports various file formats through Amazon Bedrock Data Automation:

**Documents:**
- PDF (.pdf)
- Microsoft Word (.docx)
- Text files (.txt)
- HTML (.html)

**Images:**
- JPEG/JPG (.jpg, .jpeg)
- PNG (.png)
- TIFF (.tiff, .tif)
- WebP (.webp)

**Video:**
- MP4 (.mp4)
- MOV (.mov)
- WebM (.webm)

**Audio:**
- MP3 (.mp3)
- WAV (.wav)
- FLAC (.flac)
- OGG (.ogg)
- AMR (.amr)

## Troubleshooting

### Common Deployment Issues

1. **Bedrock Data Automation API Error:**
   - Error message: "ValidationException when calling the CreateDataAutomationProject operation: Invalid request with deprecated parameters"
   - Solution: The Bedrock Data Automation API parameters may have changed. Update the audio standard configuration in both `processing-stack.ts` and `chatbot.yaml` with the latest API format.

2. **Region Compatibility:**
   - Error: Services not available in the selected region
   - Solution: Bedrock Data Automation is available in limited regions. Deploy to a supported region like us-west-2.

3. **CloudFront Issues:**
   - Problem: Frontend not showing after deployment
   - Solution: Check the CloudFront distribution status and verify the S3 bucket policy allows CloudFront access.

4. **Lambda@Edge Deployment:**
   - Error: Lambda@Edge functions failed to deploy
   - Solution: Ensure Lambda@Edge functions are deployed in us-east-1 as required by AWS.

### Missing Environment Variables

If your local development environment is missing configuration:
1. Run `./deploy.sh -e dev -i` to regenerate the configuration files without deployment
2. Verify that `.env.local` has been created in the chatbot-react directory

## Limitations

- **File Size Limits:** 
  - Videos: Up to 5GB
  - Audio: Up to 2GB
  - Documents: Up to 20 pages or 100MB
  - Images: Up to 50MB each

- **API Limitations:**
  - Bedrock Data Automation has quota limitations - check AWS documentation for current limits
  - Knowledge Base sync operations can take several minutes to complete

- **Regional Availability:**
  - Bedrock Data Automation is currently available in limited regions
  - When deploying, ensure all required services are available in your target region

- **Resource Management:**
  - Files must be manually deleted from media and organized buckets
  - Amazon Bedrock Knowledge Bases must be manually synced to reflect deleted files

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
