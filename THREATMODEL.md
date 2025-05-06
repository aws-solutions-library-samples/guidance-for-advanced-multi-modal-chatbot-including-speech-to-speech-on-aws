# AWS Threat Model Template

*Thanks for working with AppSec! This template focuses on building a threat model that get yous and your stakeholders all on the same page. Aim for a complete and self-contained doc. Link to/include content from other sources where necessary but beware access restrictions for the reader. Modify as you see fit: the best threat model is the one that works for your team. For more information on Threat Modeling including other templates, visit the* [*AWS Threat Modeling*](https://w.amazon.com/bin/view/AWS_IT_Security/Security_Reviews/Threat_Modeling/) *wiki. This template has bias towards AWS builders working on AWS services and features (versus our friends in ProServe and Solutions Architecture, for example).
*

*You can delete the italic help text if you find it useful to do so.*

Do not delete: This threat model is from the [AWS Threat Model template](https://quip-amazon.com/U68gAawbeZbB/AWS-Threat-Model-Template). Feedback [here](https://t.corp.amazon.com/create/templates/f2fffbc0-bc92-43c0-ab19-573e44ed21bb). Change log [here](https://w.amazon.com/bin/view/AWS_IT_Security/Security_Reviews/Threat_Modeling/Resources/AWSThreatModelTemplateChangeLog/).

# Introduction

## Purpose

A [threat model](https://catalog.workshops.aws/threatmodel/en-US/introduction/what-is-threat-modeling) answers four questions: What are we working on? What can go wrong? What are we going to do about it? Did we do a good job? The purpose of this threat model document is to ensure the reader can understand the security implications, potential vulnerabilities, and mitigations for the Multimedia RAG Chat Assistant solution.

## Project background

The Multimedia RAG Chat Assistant addresses the growing need for AI-powered systems that can analyze and respond to questions about various forms of content, including documents, images, audio, and video. Organizations need to extract value from their multimedia data repositories while maintaining security and data isolation between users.

## Service Overview

The Multimedia RAG Chat Assistant is a cloud-based solution that enables users to interact with a chatbot capable of processing and responding to queries about documents, images, audio, and video content. The system leverages AWS services including Bedrock, OpenSearch, Lambda, S3, CloudFront, and Cognito to provide a secure, scalable, and context-aware chat experience. Users can upload multimedia files, which are processed and indexed to enable retrieval-augmented generation (RAG) capabilities for more accurate and contextually relevant responses.

## Security Tenets

1. **Data Isolation** - Customer data must be completely isolated from other customers' data throughout the solution
2. **Secure by Default** - All components must be deployed with secure configurations by default
3. **Defense in Depth** - Multiple layers of security controls should be implemented across the solution
4. **Least Privilege** - All components should operate with the minimum permissions required
5. **Secure Transmission** - All data in transit must be encrypted using industry-standard protocols

## Assumptions

|ID	|Assumption	|Comments	|	|
|---	|---	|---	|---	|
|A-01	|AWS authentication (SigV4) and authorization (IAM) work correctly and are trusted methods to authenticate/authorize IAM principals	|Core AWS security mechanisms are assumed to function correctly	|	|
|A-02	|KMS is a secure cryptographic root for our system and can be trusted	|S3 buckets use SSE-S3 encryption for data at rest	|	|
|A-03	|Properly implemented TLS using cipher suites recommended by the [Crypto Bar Raiser](https://w.amazon.com/index.php/AWSCryptoBR) team is resistant to information disclosure and tampering to an acceptable level	|CloudFront is configured to redirect HTTP to HTTPS	|	|
|A-04	|AWS Cognito provides secure user authentication and federation capabilities	|Used for authenticating users and providing temporary credentials	|	|
|A-05	|AWS Bedrock models process data securely and do not retain customer information beyond the processing window	|Critical for maintaining data confidentiality when processing user queries	|	|

## Admin

* **AppSec Review link:** Not applicable for this exercise
* **Team Code Name:** Multimedia-RAG-Team
* Design documentation: Located in project repository README.md and associated documentation files

# System Architecture

This section answers "What are we building?" . The intent is to help the reader understand the system that is being modeled.

## High Level Design

The Multimedia RAG Chat Assistant is built as a set of interconnected AWS services, deployed using the AWS Cloud Development Kit (CDK). The architecture follows a modern cloud-native design with the following key components:

1. **Frontend Application**: React-based web application hosted in an S3 bucket, distributed via CloudFront
2. **Authentication Layer**: Cognito User Pools for user management and Lambda@Edge for token validation
3. **Storage Layer**: Multiple S3 buckets with encryption for various data types (media uploads, processed files)
4. **Processing Layer**: Lambda functions for document processing and retrieval
5. **Vector Database**: OpenSearch Serverless for efficient vector search capabilities
6. **AI Services**: Integration with AWS Bedrock for language model inference and knowledge base functionality
7. **Optional Speech Service**: WebSocket-based real-time audio communication service

All customer-facing APIs use SigV4 authentication. All data is encrypted at rest using S3-managed encryption, and all data in transit is protected with TLS 1.2+. The system implements least-privilege access through targeted IAM roles and policies.

## Low Level Design

### Authentication Stack

The Authentication Stack provides secure user management and access control:

- **Cognito User Pool**: Manages user accounts with email verification and strong password policies
- **User Pool Client**: Configured with OAuth flows and token expiration settings (5-minute access tokens)
- **Identity Pool**: Provides temporary AWS credentials for authenticated users
- **IAM Roles**: Define permissions for authenticated users with specific policies for Lambda invocation and S3 access
- **Lambda@Edge**: Performs JWT validation at CloudFront edge locations

### Storage and Distribution Stack

This stack manages all data storage and content delivery:

- **Media Bucket**: Stores uploaded user content with server-side encryption and CORS configuration
- **Organized Bucket**: Stores processed and structured data with lifecycle policies
- **Multimodal Bucket**: Stores specific formats of processed data for AI model consumption
- **Application Host Bucket**: Stores the React frontend application
- **CloudFront Distribution**: Delivers content securely with HTTPS enforcement and custom error responses
- **Origin Access Control**: Ensures S3 buckets are not publicly accessible

### OpenSearch Stack

Provides vector database functionality:

- **OpenSearch Serverless Collection**: Stores and indexes vector embeddings for efficient similarity search
- **Collection Policies**: Define access controls and encryption settings

### Processing Stack

Handles data transformation and AI operations:

- **Lambda Functions**: Process uploaded content and handle retrieval operations
- **Bedrock Integration**: Connects to AWS Bedrock for AI model inference
- **Knowledge Base**: Manages document indexing and semantic search capabilities

### Speech-to-Speech Stack (Optional)

Enables real-time audio communication:

- **Network Load Balancer**: Handles WebSocket connections
- **ECS Tasks**: Run containerized backend services for speech processing
- **WebSocket Gateway**: Manages real-time communication sessions

### User Interface

The user interface is a React application that provides:

- **Chat Interface**: For text-based interactions with the AI assistant
- **File Upload Component**: For submitting multimedia content
- **Media Viewer**: For displaying retrieved images, video, and audio
- **Speech Interface**: Optional component for voice interaction

### Authentication / Authorization

Authentication and authorization are implemented through multiple layers:

1. **User Authentication**:
   - Cognito User Pools for username/password authentication
   - Email verification for account security
   - Password policy enforcement (8+ chars, uppercase, lowercase, numbers)
   - Limited token validity (5 minutes for access tokens, 7 days for refresh tokens)

2. **Request Authorization**:
   - JWT token validation at CloudFront edge using Lambda@Edge
   - Token expiration verification
   - Issuer validation

3. **Resource Access**:
   - IAM roles with least privilege principles
   - S3 bucket policies restricting access to authorized users only
   - CloudFront Origin Access Control for S3 origins

4. **API Security**:
   - SigV4 signing for API requests
   - HTTPS enforcement for all API calls

## Data Flow Diagrams

```
[External User] <--HTTPS--> [CloudFront] <--HTTPS--> [S3 Application Bucket]
      |
      v
[Cognito Authentication]
      |
      v
[Authenticated API Requests]
      |
   +--+------------------+
   |                     |
   v                     v
[S3 Upload]          [Retrieval API]
   |                     |
   v                     v
[Processing Lambda]  [Retrieval Lambda]
   |                     |
   v                     |
[Vector Embedding]       |
   |                     |
   v                     |
[OpenSearch] <-----------+
   |
   v
[Bedrock Models]
   |
   v
[Response Generation]
```

## APIs

|API	|Method	|Status	|Mutating/Non-Mutating	|Functionality	|Callable from Internet	|Authorized Callers	|Comments	|
|---	|---	|---	|---	|---	|---	|---	|---	|
|uploadFile	|POST	|Implemented	|Mutating	|Allows users to upload multimedia files to the media bucket	|Yes	|Authenticated users	|Uses S3 presigned URLs	|
|getFiles	|GET	|Implemented	|Non-Mutating	|Lists files uploaded by the user	|Yes	|Authenticated users	|Respects user isolation	|
|sendMessage	|POST	|Implemented	|Mutating	|Sends a user query to the system	|Yes	|Authenticated users	|Calls retrieval function	|
|retrieveContext	|POST	|Implemented	|Non-Mutating	|Retrieves relevant context from vector database	|No	|Retrieval Lambda	|Internal API	|
|processFile	|POST	|Implemented	|Mutating	|Processes uploaded files for indexing	|No	|Processing Lambda	|Triggered by S3 events	|
|speechToSpeech	|WebSocket	|Optional	|Mutating	|Provides real-time speech interaction	|Yes	|Authenticated users	|Only available in us-east-1	|

## Assets

|Asset Name	|Asset Usage	|Data Type	|Comments	|
|---	|---	|---	|---	|
|User authentication data	|User credentials, JWT tokens, session information	|Authentication data	|Managed by Cognito	|
|User-uploaded media files	|Original files uploaded by users (documents, images, audio, video)	|Customer content	|Stored in Media Bucket with SSE-S3 encryption	|
|Processed content	|Extracted text, metadata, and structured information from user files	|Derived customer content	|Stored in Organized Bucket	|
|Vector embeddings	|Numerical representations of content for semantic search	|Derived customer content	|Stored in OpenSearch collection	|
|User conversation history	|Records of user interactions with the chatbot	|Customer content	|Stored temporarily for context	|
|Configuration data	|System configuration and operational parameters	|Service data	|Non-sensitive operational data	|
|Frontend application files	|React-based web interface	|Public content	|Distributed via CloudFront	|
|TLS certificates	|X.509 certificates for securing HTTPS connections	|Security credentials	|Managed by AWS Certificate Manager	|

## Threat Actors

* **Unauthenticated Internet Users**: May attempt to access protected resources or bypass authentication
* **Malicious Authenticated Users**: Legitimate users who attempt to access or manipulate other users' data
* **External Attackers**: Sophisticated actors attempting to exploit vulnerabilities for data theft or service disruption
* **Internal Threats**: Personnel with elevated permissions who might abuse access for data exfiltration

## Security Anti-Patterns

The system avoids several security anti-patterns:
1. **Public S3 buckets**: All buckets have public access blocked
2. **Over-permissioned IAM roles**: Roles follow least privilege principle
3. **Plaintext credentials**: No hardcoded credentials in code or configuration
4. **Insecure direct object references**: All resource access is properly authenticated and authorized
5. **Lack of encryption**: All data is encrypted at rest and in transit

# Threats

This section answers the question "[What can go wrong?](https://catalog.workshops.aws/threatmodel/en-US/what-can-go-wrong)". The intent is to help the reader understand the threats relevant to the system.

|Threat Number	|Priority	|Threat	|[STRIDE](https://catalog.workshops.aws/threatmodel/en-US/what-can-go-wrong/stride)	|Affected Assets	|Mitigations	|Comments	|Status	|
|---	|---	|---	|---	|---	|---	|---	|---	|
|T-001	|High	|A threat actor from the internet attempts to modify API calls in transit, leading to the reduction in confidentiality or integrity of requests/responses	|Tampering	|User authentication data, User-uploaded media files	|M-001, M-002	|Applies to all traffic between client and CloudFront/API endpoints	|Mitigated	|
|T-002	|High	|A threat actor attempts to impersonate a valid user by stealing or forging JWT tokens	|Spoofing	|User authentication data	|M-003, M-004, M-005	|JWT validation at the edge helps mitigate this threat	|Mitigated	|
|T-003	|High	|A malicious authenticated user attempts to access another user's data through path manipulation or parameter tampering	|Information Disclosure	|User-uploaded media files, Processed content, Vector embeddings	|M-006, M-007	|User isolation is critical for multi-tenant systems	|Mitigated	|
|T-004	|Medium	|A threat actor uploads malicious content designed to exploit parser vulnerabilities	|Elevation of Privilege	|Processing Lambda functions	|M-008	|File processing should be done in isolated environments	|Partially Mitigated	|
|T-005	|Medium	|A threat actor generates excessive requests to exhaust system resources or increase costs	|Denial of Service	|All system components	|M-009, M-010	|Rate limiting and monitoring help mitigate this threat	|Partially Mitigated	|
|T-006	|Medium	|A threat actor intercepts WebSocket communications in the speech-to-speech service	|Information Disclosure	|User conversation history	|M-011	|WebSocket connections must be secure	|Mitigated	|
|T-007	|Medium	|A threat actor manipulates AI prompts to extract sensitive information or generate harmful content	|Information Disclosure, Tampering	|Bedrock Models, User conversation history	|M-012	|Prompt engineering attacks are an emerging threat	|Partially Mitigated	|
|T-008	|Low	|A threat actor exploits misconfigured CORS settings to perform cross-site attacks	|Spoofing	|User authentication data	|M-013	|Proper CORS configuration is essential	|Mitigated	|
|T-009	|Low	|A threat actor attempts to exfiltrate data through side-channel attacks against AI models	|Information Disclosure	|Processed content, Vector embeddings	|M-014	|Model security is an emerging area	|Partially Mitigated	|
|T-010	|Low	|A threat actor exploits vulnerabilities in dependencies	|Elevation of Privilege	|All system components	|M-015	|Regular updates and auditing help mitigate this threat	|Ongoing	|

# Mitigations

This section answers "[What are we going to do about it?](https://catalog.workshops.aws/threatmodel/en-US/what-are-we-going-to-do-about-it)".  The intent is to help the reader understand the security strategy. Mitigations reduce the likelihood and/or impact of the occurrence of threats.

### Baseline Security Control Mitigations

The [Baseline Security Controls](https://w.amazon.com/bin/view/AWS_IT_Security/AppSec/ETSE/BaselineSecurityControls/) (BSCs) are a set of controls that, when applicable, must be implemented in AWS services.

|Mitigation Number	|Mitigation	|Threats Mitigating	|Status	|Ticket/Artifact/CR/Tests	|Comments	|
|---	|---	|---	|---	|---	|---	|
|BSC2	|Enable security HTTP headers	|T-008	|Implemented	|CloudFront security headers configuration	|Security headers are enabled in CloudFront distribution	|
|BSC6	|Implement checks to ensure that only the resource owner can take action against the resource (protect against Confused Deputy)	|T-003	|Implemented	|IAM policies with resource isolation	|User-specific resource prefixes are enforced	|
|BSC9	|Implement authorization for services	|T-002, T-003	|Implemented	|Lambda@Edge JWT validation	|All service interactions require proper authorization	|
|BSC10	|Ensure a consistent authorization experience (CAE) using IAM	|T-002, T-003	|Implemented	|IAM roles and policies configuration	|IAM is used consistently throughout the solution	|
|BSC12	|Ensure that bucket and objects are not world readable or world writable	|T-003	|Implemented	|S3 bucket configurations	|All buckets have blockPublicAccess set to BLOCK_ALL	|
|BSC13	|Encrypt service data using a KMS Customer Managed Key owned by your service	|T-003	|Implemented	|S3 bucket encryption settings	|S3 server-side encryption is enabled for all buckets	|
|BSC15	|Enable access logging for all AWS services that support it (such as S3, ELB, CloudFront, etc.)	|T-003	|Implemented	|S3 bucket logging configuration	|All S3 buckets have access logging enabled, with logs stored in a dedicated bucket	|
|BSC16	|Encrypt Data in Transit (HTTPS/TLS)	|T-001	|Implemented	|CloudFront distribution settings	|TLS 1.2+ is enforced for all communications	|
|BSC18	|Enable TLS for all ingress and egress connections	|T-001	|Implemented	|enforceSSL property in S3 buckets	|SSL is enforced for all S3 API calls	|
|BSC21	|Harden against denial of service	|T-005	|Partially Implemented	|CloudFront distribution settings	|Additional rate limiting may be required	|
|BSC28	|Apply least privilege principle to all processes, accounts, etc.	|T-002, T-003, T-004	|Implemented	|IAM role definitions	|All roles follow least privilege principle	|
|BSC32	|Implement authentication	|T-002	|Implemented	|Cognito User Pool configuration	|Cognito provides robust user authentication	|
|BSC33	|Use sigv4 as the secure default authentication mechanism for APIS	|T-002	|Implemented	|API Gateway configuration	|SigV4 signing is required for API access	|
|BSC45	|Restrict inbound and outbound network access to least privilege	|T-004, T-005	|Implemented	|Security group configurations	|Network access is appropriately restricted	|

### System Specific Mitigations

These are mitigations that are specific to the system being modeled.

|Mitigation Number	|Mitigation	|Threats Mitigating	|Status	|[Related BSC](https://w.amazon.com/bin/view/AWS_IT_Security/AppSec/ETSE/BaselineSecurityControls/)	|**Ticket/Artifact/CR/Tests**	|Comments	|
|---	|---	|---	|---	|---	|---	|---	|
|M-001	|TLS enforcement for all connections	|T-001	|Implemented	|BSC16, BSC18	|CloudFront configuration	|All traffic uses HTTPS with TLS 1.2+	|
|M-002	|HTTPS redirection in CloudFront	|T-001	|Implemented	|BSC16, BSC18	|CloudFront ViewerProtocolPolicy setting	|HTTP requests are automatically redirected to HTTPS	|
|M-003	|JWT validation at CloudFront edge	|T-002	|Implemented	|BSC9	|Lambda@Edge function code	|Tokens are validated before reaching origin	|
|M-004	|Short JWT expiration times (5 minutes)	|T-002	|Implemented	|BSC32	|Cognito User Pool Client configuration	|Limits window of opportunity for token theft	|
|M-005	|Token issuer validation	|T-002	|Implemented	|BSC32	|Lambda@Edge function code	|Ensures tokens are issued by the correct authority	|
|M-006	|User-specific resource prefixes	|T-003	|Implemented	|BSC6, BSC28	|S3 path design and IAM policies	|Enforces logical separation of user data	|
|M-007	|IAM policies with user context variables	|T-003	|Implemented	|BSC6, BSC28	|IAM policy documents	|Restricts access based on authenticated identity	|
|M-008	|Lambda function sandboxing	|T-004	|Implemented	|BSC28	|Lambda execution environment	|Provides isolation for file processing	|
|M-009	|API Gateway throttling	|T-005	|Partially Implemented	|BSC21	|API Gateway configuration	|Limits request rates but may need refinement	|
|M-010	|CloudWatch alarms for abnormal usage	|T-005	|Planned	|N/A	|Not yet implemented	|Will detect and alert on unusual patterns	|
|M-011	|Secure WebSocket implementation	|T-006	|Implemented	|BSC16, BSC18	|WebSocket configuration	|Ensures secure real-time communications	|
|M-012	|Input validation and prompt boundaries	|T-007	|Partially Implemented	|N/A	|Retrieval function implementation	|Sanitizes user input before sending to models	|
|M-013	|Restrictive CORS configuration	|T-008	|Implemented	|BSC2	|S3 bucket CORS settings	|Prevents unauthorized cross-origin requests	|
|M-014	|Query and response monitoring	|T-009	|Planned	|N/A	|Not yet implemented	|Will detect potential data leakage	|
|M-015	|Regular dependency updates	|T-010	|Ongoing	|N/A	|CI/CD pipeline	|Ensures known vulnerabilities are patched	|
|M-016	|S3 access logging with dedicated log bucket	|T-003	|Implemented	|BSC15	|Storage bucket configurations	|All S3 buckets log access to a dedicated bucket with appropriate lifecycle rules	|
|M-017	|Support for cross-account log storage	|T-003	|Implemented	|BSC15	|External log bucket parameter	|Option to use bucket in a separate account for higher security	|

## Security Tests

|Test Number	|Mitigations Tested	|Test Case	|Description	|Test Type	|Status	|
|---	|---	|---	|---	|---	|---	|
|Test-001	|M-001, M-002	|HTTP to HTTPS Redirection	|Verify that HTTP requests are redirected to HTTPS	|Integration	|Implemented	|
|Test-002	|M-001, M-002	|TLS Version Enforcement	|Verify that only TLS 1.2+ is accepted	|Integration	|Implemented	|
|Test-003	|M-003, M-004, M-005	|JWT Validation	|Test that expired or invalid tokens are rejected	|Unit, Integration	|Implemented	|
|Test-004	|M-003, M-004, M-005	|Token Issuer Validation	|Verify that tokens from incorrect issuers are rejected	|Unit	|Implemented	|
|Test-005	|M-006, M-007	|Cross-User Access Prevention	|Attempt to access another user's resources	|Integration	|Implemented	|
|Test-006	|M-008	|File Upload Handling	|Test processing of various file types including edge cases	|Integration	|Partially Implemented	|
|Test-007	|M-009, M-010	|Rate Limiting	|Verify that excessive requests are throttled	|Integration	|Planned	|
|Test-008	|M-011	|WebSocket Security	|Test secure WebSocket connections	|Integration	|Implemented	|
|Test-009	|M-012	|Prompt Injection Prevention	|Test boundary enforcement for AI prompts	|Unit, Integration	|Planned	|
|Test-010	|M-013	|CORS Configuration	|Verify that CORS headers are properly set	|Integration	|Implemented	|
|Test-011	|BSC15	|S3 Access Logging	|Verify that S3 access logs are properly generated in the dedicated logging bucket	|Integration	|Implemented	|
|Test-012	|BSC15	|Cross-Account Logging	|Verify that logs can be correctly sent to an external bucket when configured	|Integration	|Planned	|

## Appendix

### Glossary

|Term	|Definition	|Example	|
|---	|---	|---	|
|RAG	|Retrieval Augmented Generation, a technique that enhances LLM responses with relevant context	|Using document content to provide more accurate AI responses	|
|JWT	|JSON Web Token, a compact, URL-safe means of representing claims between two parties	|Authentication tokens used to validate user identity	|
|Vector Embedding	|Numerical representation of text or other data in high-dimensional space	|Converting document text into vectors for semantic search	|
|Lambda@Edge	|AWS service that runs code at edge locations in response to CloudFront events	|JWT validation function that runs at CloudFront edge	|

## References

The table below lists related threat models, design documents, PRFAQs, security reviews, pentests, or other documents.

|Reference	|Comments	|
|---	|---	|
|[AWS Cognito Security Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/security.html)	|Security best practices for Cognito	|
|[S3 Security Best Practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html)	|Guidelines for securing S3 buckets	|
|[CloudFront Security](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/security.html)	|Security considerations for CloudFront distributions	|
|[Lambda Security Overview](https://docs.aws.amazon.com/lambda/latest/dg/lambda-security.html)	|Security practices for Lambda functions	|
|[Bedrock Security](https://docs.aws.amazon.com/bedrock/latest/userguide/security.html)	|Security considerations for AWS Bedrock	|

### Documentation

* README.md - Main project documentation
* README-WebSocket-Authentication.md - WebSocket security details
* cdk/README.md - CDK deployment instructions
