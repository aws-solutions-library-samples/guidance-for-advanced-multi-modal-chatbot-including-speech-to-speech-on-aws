import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageDistStack } from './storage-dist-stack';
import { AuthStack } from './auth-stack';
import { OpenSearchStack } from './opensearch-stack';
import { ProcessingStack } from './processing-stack';
import { SpeechToSpeechStack } from './speech-to-speech-stack';
import { ResourceConfig, WAF_TAGS } from './constants';

/**
 * Props for the MultimediaRagStack
 */
export interface MultimediaRagStackProps extends cdk.StackProps {
  /**
   * Configuration for resource naming
   */
  resourceConfig: ResourceConfig;
  
  /**
   * Model ID for Bedrock
   */
  modelId?: string;
  
  /**
   * Embedding Model ID for Bedrock
   */
  embeddingModelId?: string;
  
  /**
   * Whether to use Bedrock Data Automation
   */
  useBedrockDataAutomation?: boolean;
  
  /**
   * Lambda@Edge version ARN (optional - required for Auth)
   */
  edgeLambdaVersionArn?: string;
  
  /**
   * Whether to deploy Speech-to-Speech functionality
   */
  deploySpeechToSpeech?: boolean;
  
  /**
   * Configuration for Speech-to-Speech stack (optional)
   */
  speechToSpeechConfig?: {
    ecrRepositoryName?: string;
    memoryLimitMiB?: number;
    cpuUnits?: number;
    debugMode?: boolean;
  };
  
  /**
   * Cross-account S3 bucket ARN for access logs (optional - for higher security)
   * If provided, logs will be sent to this external bucket instead of the local log bucket
   */
  externalLogBucketArn?: string;
}

/**
 * Main stack for the multimedia RAG application
 * 
 * This stack uses composition pattern to deploy:
 * - StorageDist Stack: S3 buckets and CloudFront distribution
 * - Auth Stack: Cognito resources for authentication
 * - OpenSearch Stack: OpenSearch Serverless resources for vector search
 * - Processing Stack: Lambda functions and Bedrock resources
 */
export class MultimediaRagStack extends cdk.Stack {
  /**
   * Storage and Distribution Stack
   */
  public readonly storageDistStack: StorageDistStack;
  
  /**
   * Auth Stack
   */
  public readonly authStack: AuthStack;
  
  /**
   * OpenSearch Stack
   */
  public readonly openSearchStack: OpenSearchStack;
  
  /**
   * Processing Stack
   */
  public readonly processingStack: ProcessingStack;
  
  /**
   * Speech-to-Speech Stack (optional)
   */
  public readonly speechToSpeechStack?: SpeechToSpeechStack;
  

  constructor(scope: Construct, id: string, props: MultimediaRagStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceConfig.resourceSuffix);

    // First, conditionally deploy Speech-to-Speech stack if requested
    let nlbDnsName: string | undefined;
    if (props.deploySpeechToSpeech) {
      // Deploy the Speech-to-Speech stack with references to Cognito and Knowledge Base
      this.speechToSpeechStack = new SpeechToSpeechStack(this, 'SpeechToSpeechStack', {
        resourceSuffix: props.resourceConfig.resourceSuffix,
        ecrRepositoryName: props.speechToSpeechConfig?.ecrRepositoryName || `speech-to-speech-backend-${props.resourceConfig.resourceSuffix}`,
        memoryLimitMiB: props.speechToSpeechConfig?.memoryLimitMiB || 2048,
        cpuUnits: props.speechToSpeechConfig?.cpuUnits || 1024,
        debugMode: props.speechToSpeechConfig?.debugMode || false,
      });
      
      // Get the NLB DNS name to pass to StorageDistStack
      nlbDnsName = this.speechToSpeechStack.nlbDnsName;
    }
    
    // Create Storage and Distribution stack with NLB DNS name if available
    this.storageDistStack = new StorageDistStack(this, 'StorageDistStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      edgeLambdaVersionArn: props.edgeLambdaVersionArn,
      nlbDnsName: nlbDnsName, // Pass NLB DNS name if available
      externalLogBucketArn: props.externalLogBucketArn // Pass external log bucket ARN if available
    });
    
    // Note: WebSocket URL output is added at the end of the constructor
    
    // Deploy OpenSearch Stack as a NestedStack
    this.openSearchStack = new OpenSearchStack(this, 'OpenSearchStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      organizedBucket: this.storageDistStack.organizedBucket
    });

    // Deploy Processing Stack as a NestedStack to get the retrieval function
    this.processingStack = new ProcessingStack(this, 'ProcessingStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      modelId: props.modelId,
      embeddingModelId: props.embeddingModelId,
      mediaBucket: this.storageDistStack.mediaBucket,
      organizedBucket: this.storageDistStack.organizedBucket,
      multimodalBucket: this.storageDistStack.multimodalBucket,
      opensearchCollection: this.openSearchStack.collection
    });
    
    // Now that we have the processing stack, we can get the knowledge base ID
    if (this.speechToSpeechStack && this.processingStack.knowledgeBaseId) {
      // Unfortunately we can't update the stack properties after creation
      // This is a limitation of the CDK construct model
      console.info('Knowledge Base ID is available and should be passed to the SpeechToSpeechStack.');
    }
    
    // Deploy Auth Stack as a NestedStack with the retrieval function and media bucket
    this.authStack = new AuthStack(this, 'AuthStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      mediaBucket: this.storageDistStack.mediaBucket,
      retrievalFunction: this.processingStack.retrievalFunction
    });
    
    // Now that we have the Auth stack, we can get the Cognito user pool details
    if (this.speechToSpeechStack) {
      // Again, we can't update the stack properties after creation
      console.info('Cognito User Pool details are available and should be passed to the SpeechToSpeechStack.');
    }
    
    // Output key information for cross-stack references
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: this.authStack.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `MultimediaRagStack-CognitoUserPoolId`
    });
    
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', {
      value: this.authStack.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `MultimediaRagStack-CognitoUserPoolClientId` 
    });
    
    new cdk.CfnOutput(this, 'CognitoIdentityPoolId', {
      value: this.authStack.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `MultimediaRagStack-CognitoIdentityPoolId`
    });
    
    // Storage bucket outputs
    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.storageDistStack.mediaBucket.bucketName,
      description: 'Media bucket name',
      exportName: `StorageStack-MediaBucketName`
    });

    new cdk.CfnOutput(this, 'ApplicationHostBucketName', {
      value: this.storageDistStack.applicationHostBucket.bucketName,
      description: 'Application host bucket name',
      exportName: `${id}-ApplicationHostBucketName`
    });

    new cdk.CfnOutput(this, 'RetrievalFunctionName', {
      value: this.processingStack.retrievalFunction.functionName,
      description: 'Retrieval Lambda Function Name',
      exportName: `ProcessingStack-RetrievalFunctionName`
    });

    // Add Bedrock Knowledge Base outputs using real values from Processing Stack
    new cdk.CfnOutput(this, 'DocumentsKnowledgeBaseId', {
      value: this.processingStack.knowledgeBaseId,
      description: 'Documents Knowledge Base ID',
      exportName: `${id}-DocumentsKnowledgeBaseId`
    });
    
    new cdk.CfnOutput(this, 'DocumentsDataSourceId', {
      value: this.processingStack.dataSourceId,
      description: 'Documents Data Source ID',
      exportName: `${id}-DocumentsDataSourceId`
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.storageDistStack.distribution.distributionId,
      description: 'CloudFront Distribution ID (for cache invalidation)',
      exportName: `${id}-CloudFrontDistributionId`
    });
    
    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.storageDistStack.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${id}-CloudFrontDomainName`
    });
    
    // Add WebSocket URL output if Speech-to-Speech is enabled
    if (this.speechToSpeechStack) {
      // Create WebSocket URL using CloudFront domain and WebSocket path
      new cdk.CfnOutput(this, 'WebSocketURL', {
        value: `wss://${this.storageDistStack.distribution.distributionDomainName}/ws/speech-to-speech`,
        description: 'WebSocket URL for Speech-to-Speech service',
        exportName: `${id}-WebSocketURL`
      });
    }
  
    // Add permissions for authenticated users to invoke the retrieval function
    this.authStack.authenticatedRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [this.processingStack.retrievalFunction.functionArn]
      })
    );
    
    // Add permissions for authenticated users to upload to media bucket
    this.authStack.authenticatedRole.addToPolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          's3:GetObject',
          's3:ListBucket',
          's3:PutObject'
        ],
        resources: [
          this.storageDistStack.mediaBucket.bucketArn,
          `${this.storageDistStack.mediaBucket.bucketArn}/*`
        ]
      })
    );
  }

  // CloudFront access policies are now handled in the separate CloudFront stack
}
