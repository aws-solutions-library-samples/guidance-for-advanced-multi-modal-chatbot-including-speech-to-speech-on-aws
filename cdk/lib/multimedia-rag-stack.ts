import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageDistStack } from './storage-dist-stack';
import { AuthStack } from './auth-stack';
import { OpenSearchStack } from './opensearch-stack';
import { ProcessingStack } from './processing-stack';
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
  

  constructor(scope: Construct, id: string, props: MultimediaRagStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceConfig.resourceSuffix);

    // Deploy Storage and Distribution stack
    this.storageDistStack = new StorageDistStack(this, 'StorageDistStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      edgeLambdaVersionArn: props.edgeLambdaVersionArn
    });
    
    // Deploy OpenSearch Stack as a NestedStack
    this.openSearchStack = new OpenSearchStack(this, 'OpenSearchStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      organizedBucket: this.storageDistStack.organizedBucket
    });

    // Deploy Processing Stack as a NestedStack first to get the retrieval function
    this.processingStack = new ProcessingStack(this, 'ProcessingStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      modelId: props.modelId,
      embeddingModelId: props.embeddingModelId,
      mediaBucket: this.storageDistStack.mediaBucket,
      organizedBucket: this.storageDistStack.organizedBucket,
      multimodalBucket: this.storageDistStack.multimodalBucket,
      opensearchCollection: this.openSearchStack.collection
    });
    
    // Deploy Auth Stack as a NestedStack with the retrieval function and media bucket
    this.authStack = new AuthStack(this, 'AuthStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      mediaBucket: this.storageDistStack.mediaBucket,
      retrievalFunction: this.processingStack.retrievalFunction
    });
    
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
