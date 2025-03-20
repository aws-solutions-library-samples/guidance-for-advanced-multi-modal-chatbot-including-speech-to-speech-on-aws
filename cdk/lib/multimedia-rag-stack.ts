import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { StorageStack } from './storage-stack';
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
  

  constructor(scope: Construct, id: string, props: MultimediaRagStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceConfig.resourceSuffix);

    // Deploy Storage Stack as a NestedStack with this parent's scope
    this.storageStack = new StorageStack(this, 'StorageStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix
    });

    // Deploy Auth Stack as a NestedStack
    this.authStack = new AuthStack(this, 'AuthStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix
    });

    // Deploy OpenSearch Stack as a NestedStack
    this.openSearchStack = new OpenSearchStack(this, 'OpenSearchStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      organizedBucket: this.storageStack.organizedBucket
    });

    // Deploy Processing Stack as a NestedStack
    this.processingStack = new ProcessingStack(this, 'ProcessingStack', {
      resourceSuffix: props.resourceConfig.resourceSuffix,
      modelId: props.modelId,
      embeddingModelId: props.embeddingModelId,
      mediaBucket: this.storageStack.mediaBucket,
      organizedBucket: this.storageStack.organizedBucket,
      multimodalBucket: this.storageStack.multimodalBucket,
      opensearchCollection: this.openSearchStack.collection
    });

    // CloudFront stack is now created separately to avoid circular dependencies
    
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
    
    // CloudFront domain name is now output from the separate CloudFront stack
    
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

  // CloudFront access policies are now handled in the separate CloudFront stack
}
