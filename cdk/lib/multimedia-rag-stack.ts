import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
import { AuthStack } from './auth-stack';
import { OpenSearchStack } from './opensearch-stack';
import { ProcessingStack } from './processing-stack';
import { CloudFrontStack } from './cloudfront-stack';
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
 * - Storage Stack: S3 buckets for media, processed content and static hosting
 * - Auth Stack: Cognito resources for authentication
 * - OpenSearch Stack: OpenSearch Serverless resources for vector search
 * - Processing Stack: Lambda functions and Bedrock resources
 * - CloudFront Stack: CDN for content delivery
 */
export class MultimediaRagStack extends cdk.Stack {
  /**
   * Storage Stack
   */
  public readonly storageStack: StorageStack;
  
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
   * CloudFront Stack
   */
  public readonly cloudFrontStack: CloudFrontStack;

  constructor(scope: Construct, id: string, props: MultimediaRagStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceConfig.resourceSuffix);

    // Deploy Storage Stack
    this.storageStack = new StorageStack(this, 'StorageStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix
    });

    // Deploy Auth Stack
    this.authStack = new AuthStack(this, 'AuthStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix
    });

    // Deploy OpenSearch Stack
    this.openSearchStack = new OpenSearchStack(this, 'OpenSearchStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      organizedBucket: this.storageStack.organizedBucket
    });

    // Deploy Processing Stack
    this.processingStack = new ProcessingStack(this, 'ProcessingStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      modelId: props.modelId,
      embeddingModelId: props.embeddingModelId,
      mediaBucket: this.storageStack.mediaBucket,
      organizedBucket: this.storageStack.organizedBucket,
      multimodalBucket: this.storageStack.multimodalBucket,
      opensearchCollection: this.openSearchStack.collection
    });

    // Deploy CloudFront Stack
    this.cloudFrontStack = new CloudFrontStack(this, 'CloudFrontStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      mediaBucket: this.storageStack.mediaBucket,
      applicationHostBucket: this.storageStack.applicationHostBucket,
      edgeLambdaVersionArn: props.edgeLambdaVersionArn
    });
    
    // Output key information for cross-stack references
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: this.authStack.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${id}-CognitoUserPoolId`
    });
    
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', {
      value: this.authStack.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${id}-CognitoUserPoolClientId` 
    });
    
    new cdk.CfnOutput(this, 'CognitoIdentityPoolId', {
      value: this.authStack.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${id}-CognitoIdentityPoolId`
    });
    
    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.cloudFrontStack.distribution.distributionDomainName,
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
          this.storageStack.mediaBucket.bucketArn,
          `${this.storageStack.mediaBucket.bucketArn}/*`
        ]
      })
    );
  }
}
