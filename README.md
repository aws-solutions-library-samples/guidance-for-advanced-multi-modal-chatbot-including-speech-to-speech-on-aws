# Chat with your multimedia content using AWS CDK, Amazon Bedrock Data Automation and Amazon Bedrock Knowledge Bases

## Overview
Extracting meaningful insights from diverse data sources has become increasingly challenging. This becomes particularly difficult when businesses have terabytes of video and audio files, along with text based data and need to quickly access specific sections or topics, summarize content, or answer targeted questions using information sourced from these diverse files without having to switch context or solutions. 
This unified GenAI solution transforms how users interact with their data. This solution seamlessly integrates with various file formats including video, audio PDFs and text documents, providing a unified interface for knowledge extraction. Users can ask questions about their data, and the solution delivers precise answers, complete with source attribution. Responses are linked to their origin, which could include videos that load at the exact timestamp, for faster and efficient reference, PDF files or documents. 

This sample solution will demonstrate how to leverage AWS AI services to: 
* Process and index multi-format data at scale, including large video, audio and documents 
* Rapidly summarize extensive content from various file types 
* Deliver context-rich responses Provide an unified, intuitive user experience for seamless data exploration
* Engage in real-time speech-to-speech conversations with your knowledge base (optional)

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

8. **Speech-to-Speech Stack (Optional)**
   - WebSocket server for real-time audio streaming
   - Amazon Nova Sonic integration for speech-to-speech capabilities
   - ECS Fargate service with Docker container
   - Network Load Balancer for WebSocket connections

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
- Real-time speech-to-speech conversations with your knowledge base (optional)
- WebSocket-based communication for low-latency voice responses

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
- Docker (for building the Speech-to-Speech container)

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
| -S | Disable Speech-to-Speech capabilities | false (enabled by default) |
| -h | Show help message | - |

### Example Deployment Commands

#### Complete Production Deployment (with all features)
```bash
# Deploy a production environment with all features enabled
./deploy.sh -e prod -r us-east-1 -l
```
**Explanation**: This command deploys the complete solution with both Lambda@Edge JWT validation and Speech-to-Speech capabilities in a production environment. Using `us-east-1` region ensures Speech-to-Speech capabilities are available, while the `-l` flag enables CloudFront JWT validation for enhanced security.

#### Development Environment in Non-us-east-1 Region
```bash
# Deploy a development environment in us-west-2 (Speech-to-Speech will be automatically disabled)
./deploy.sh -e dev -r us-west-2
```
**Explanation**: This deploys the solution in us-west-2 region for development. The Speech-to-Speech capabilities will be automatically disabled since they're only available in us-east-1, but all other features will function normally.

#### Minimal Deployment (for testing)
```bash
# Deploy basic infrastructure without Speech-to-Speech and frontend for testing
./deploy.sh -e test -S -f
```
**Explanation**: This creates a minimal testing deployment with only the core infrastructure. The frontend deployment is skipped (`-f`) and Speech-to-Speech capabilities are disabled (`-S`), making this ideal for quick testing of backend components.

#### Update Frontend Only
```bash
# Update only the frontend without redeploying infrastructure
./deploy.sh -e dev -s
```
**Explanation**: When you've made changes only to the frontend code and want to update it without redeploying the infrastructure stacks. This is much faster than a full deployment.

#### Cross-Account Deployment with Custom Profile
```bash
# Deploy to a different AWS account using a specific profile
./deploy.sh -e staging -p staging-account -r us-east-1
```
**Explanation**: This example demonstrates using a custom AWS profile to deploy to a separate AWS account, which is common in enterprise environments with development/staging/production in separate accounts.

#### Secure Production Deployment
```bash
# Deploy a production environment with all security features
./deploy.sh -e prod -r us-east-1 -l -p production-profile
```
**Explanation**: This deploys a secure production environment with Lambda@Edge for JWT validation, using a dedicated production AWS profile. The deployment uses us-east-1 to enable all features including Speech-to-Speech.

#### Local Development Configuration
```bash
# Generate configuration files for local development without deploying 
./deploy.sh -e dev -i -p dev-profile
```
**Explanation**: This generates the necessary environment configuration for local development against existing cloud resources without deploying any infrastructure. Useful for frontend developers who don't need to deploy infrastructure changes.

## Speech-to-Speech Capabilities

This solution includes optional integration with Amazon Nova Sonic for real-time speech-to-speech conversations with your knowledge base:

- **Real-time bidirectional audio streaming**: Talk naturally with your data using voice
- **Voice-based RAG**: Query your multimedia content knowledge base using spoken language
- **WebSocket communication**: Low-latency responses through WebSocket protocol
- **Seamless integration**: Uses the same knowledge base as the text chat interface

The speech-to-speech capability is deployed by default when using `us-east-1` region. To disable it, use the `-S` flag during deployment.

**IMPORTANT**: Speech-to-Speech capabilities using Amazon Nova Sonic are currently only available in the **us-east-1** (N. Virginia) region. When deploying in other regions, the Speech-to-Speech capability will be automatically disabled.

## Usage

### Application Access
1. Access the deployed application using: `https://<CloudFront-Domain-Name>.cloudfront.net/`
2. Signup or Log in with your credentials
3. Use the left navigation pane to:
   - Upload files
   - Initiate data sync
   - Monitor sync status
4. Once sync is complete, start chatting with your data (via text or speech)

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
- CloudWatch dashboards for monitoring Speech-to-Speech service performance

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

5. **Speech-to-Speech Issues:**
   - Error: Speech-to-Speech stack deployment failed
   - Solution: Verify you are deploying in us-east-1 region, as Nova Sonic is currently only available there.

### Missing Environment Variables

If your local development environment is missing configuration:
1. Run `./deploy.sh -e dev -i` to regenerate the configuration files without deployment
2. Verify that `.env.local` has been created in the chatbot-react directory

## Cost

You are responsible for the cost of the AWS services used while running this Guidance. As of May 2025, the cost for running this Guidance with the default settings in the US East (N. Virginia) Region is approximately $213.18 per month for processing (~1,000 conversations with 5,000 multimedia files).

This estimate is based on a deployment supporting 100 active users executing approximately 1,000 multimedia RAG conversations per month. Each conversation processes an average of 5 multimedia files (PDFs, images, videos, etc.) through the RAG pipeline.

| AWS Service | Dimensions | Cost - USD |
|-------------|------------|------------|
| Amazon S3 | • 100GB total storage<br>• 5,000 PUT requests<br>• 50,000 GET requests | $4.75 |
| Amazon OpenSearch Serverless | • On-demand capacity (8hrs/day)<br>• 50GB storage | $152.40 |
| AWS Lambda | • 5,000 retrieval invocations<br>• 5,000 processing invocations | $1.22 |
| Amazon ECS Fargate | • 1 task (1vCPU, 2GB)<br>• 8hrs/day operation | $9.72 |
| Network Load Balancer | • 1 NLB<br>• 50GB processed | $17.10 |
| Amazon VPC (NAT Gateway) | • 1 NAT Gateway (8hrs/day)<br>• 20GB data | $11.70 |
| Amazon CloudFront | • 100GB data transfer<br>• 1M requests | $9.50 |
| Amazon EventBridge | • 5,000 custom events | $0.01 |
| Amazon CloudWatch | • 5GB logs, 10 metrics, 1 dashboard | $6.50 |
| Amazon Cognito | • 100 monthly active users | $0.28 |
| **TOTAL** | | **$213.18** |

**Note**: The above estimate only covers AWS infrastructure costs. Additional Amazon Bedrock model inference charges and Amazon Nova Sonic charges will apply based on your usage and are not included in this estimate. These charges depend on the specific models used, the number of tokens processed, and the duration of speech-to-speech interactions. Please refer to the [Amazon Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) page for current model inference costs.

We recommend creating a Budget through AWS Cost Explorer to help manage costs. Prices are subject to change. For full details, refer to the pricing webpage for each AWS service used in this Guidance.

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
  - Bedrock Data Automation is available in limited regions
  - Speech-to-Speech capabilities using Amazon Nova Sonic are currently only available in us-east-1 region
  - When deploying, ensure all required services are available in your target region

- **Resource Management:**
  - Files must be manually deleted from media and organized buckets
  - Amazon Bedrock Knowledge Bases must be manually synced to reflect deleted files

## Cleanup

When you're done experimenting with this solution, follow these steps to remove all deployed resources and avoid ongoing charges.

### Automated Cleanup Process

1. **Empty S3 buckets first** (required before stack deletion):

   ```bash
   # Get bucket names from CloudFormation outputs (replace 'dev' with your environment name)
   MEDIA_BUCKET=$(aws cloudformation describe-stacks \
     --stack-name "MultimediaRagStack-dev" \
     --query "Stacks[0].Outputs[?OutputKey=='MediaBucketName'].OutputValue" \
     --output text \
     --region <your-region> \
     --profile <your-profile>)
   
   ORGANIZED_BUCKET=$(aws cloudformation describe-stacks \
     --stack-name "MultimediaRagStack-dev" \
     --query "Stacks[0].Outputs[?OutputKey=='OrganizedBucketName'].OutputValue" \
     --output text \
     --region <your-region> \
     --profile <your-profile>)
   
   APP_BUCKET=$(aws cloudformation describe-stacks \
     --stack-name "MultimediaRagStack-dev" \
     --query "Stacks[0].Outputs[?OutputKey=='ApplicationHostBucketName'].OutputValue" \
     --output text \
     --region <your-region> \
     --profile <your-profile>)
   
   # Empty all buckets
   aws s3 rm s3://$MEDIA_BUCKET --recursive
   aws s3 rm s3://$ORGANIZED_BUCKET --recursive
   aws s3 rm s3://$APP_BUCKET --recursive
   ```

2. **Delete the main CloudFormation stack**:

   ```bash
   # Navigate to the CDK directory
   cd cdk
   
   # Destroy the main stack (replace 'dev' with your environment name)
   npx cdk destroy MultimediaRagStack-dev --profile <your-profile> --region <your-region> --force
   ```

3. **Delete Lambda@Edge stack** (if you deployed it):

   ```bash
   # Lambda@Edge functions are always deployed in us-east-1
   npx cdk destroy LambdaEdgeStack-dev --profile <your-profile> --region us-east-1 --force
   ```

### Resources Requiring Manual Deletion

Some AWS resources may require manual deletion through the AWS Console:

1. **Amazon Bedrock Knowledge Base**:
   - Navigate to Amazon Bedrock console → Knowledge bases
   - Select the knowledge base (name contains `docs-kb-{environment}`)
   - Click "Delete"

2. **ECR Repository** (if Speech-to-Speech was enabled):
   - Navigate to Amazon ECR console in us-east-1 region
   - Select repository named `speech-to-speech-backend-{environment}`
   - Click "Delete repository"

3. **CloudWatch Log Groups**:
   - Navigate to CloudWatch console → Log groups
   - Delete log groups with names containing your environment suffix:
     - `/aws/lambda/retrieval-fn-{environment}`
     - `/aws/lambda/init-processing-{environment}`
     - `/aws/lambda/bda-processor-{environment}`
     - `/ecs/speech-to-speech-backend-{environment}` (if Speech-to-Speech was enabled)

4. **OpenSearch Serverless Collection** (if stuck in deletion):
   - If the OpenSearch collection remains stuck in "DELETING" state
   - Contact AWS Support for assistance

### Cross-Region Resource Cleanup

If you deployed with Speech-to-Speech or Lambda@Edge enabled, ensure you check both your deployment region and us-east-1:

- **Lambda@Edge**: Functions are deployed to us-east-1, and replicas are created in all CloudFront edge locations (replicas are automatically cleaned up by AWS, but may take several hours)
- **Speech-to-Speech**: ECR Repository, ECS Fargate Task, and NLB are in us-east-1

### Troubleshooting Stack Deletion

If stack deletion fails:

1. **Check the CloudFormation Events tab** for the specific resource causing the failure
2. **Verify all S3 buckets are empty** as this is the most common cause of deletion failure
3. **Check for resource dependencies** that might prevent deletion
4. **Delete resources manually** through their respective AWS Console pages as needed
5. **Try the CDK destroy command again** with the `--force` flag

### Verification

After completing the cleanup, verify the following resources have been deleted:

- S3 buckets (Media, Organized, Application Host, and Logs)
- CloudFront distribution
- Lambda functions
- OpenSearch Serverless collection
- Bedrock Knowledge Base
- Cognito User Pool and Identity Pool
- Network Load Balancer (if Speech-to-Speech was enabled)
- ECS Clusters and Services (if Speech-to-Speech was enabled)
- ECR Repository (if Speech-to-Speech was enabled)
- CloudWatch Log groups

### Cost Optimization During Testing

If you want to temporarily reduce costs without completely removing the solution:

1. **Delete the Knowledge Base data source** to stop Bedrock indexing charges
2. **Scale down the Speech-to-Speech Fargate service** to 0 tasks
3. **Empty the S3 buckets** to reduce storage costs

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

## Notices
Customers are responsible for making their own independent assessment of the information in this Guidance. This Guidance: (a) is for informational purposes only, (b) represents AWS current product offerings and practices, which are subject to change without notice, and (c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided “as is” without warranties, representations, or conditions of any kind, whether express or implied. AWS responsibilities and liabilities to its customers are controlled by AWS agreements, and this Guidance is not part of, nor does it modify, any agreement between AWS and its customers.
