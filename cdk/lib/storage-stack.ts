import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ResourceConfig, WAF_TAGS } from './constants';

/**
 * Props for the StorageStack
 */
export interface StorageStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
}

/**
 * Storage Stack for multimedia-rag application
 * 
 * This stack provisions the S3 buckets needed for:
 * - Media files (source files uploaded by users)
 * - Organized files (processed transcriptions and extracted text)
 * - Multimodal files (for Bedrock Knowledge Base)
 * - Application hosting (React frontend files)
 */
export class StorageStack extends cdk.Stack {
  /**
   * S3 bucket for media file uploads
   */
  public readonly mediaBucket: s3.Bucket;
  
  /**
   * S3 bucket for organized processed files
   */
  public readonly organizedBucket: s3.Bucket;
  
  /**
   * S3 bucket for multimodal data
   */
  public readonly multimodalBucket: s3.Bucket;
  
  /**
   * S3 bucket for hosting the React application
   */
  public readonly applicationHostBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);

    // Create the Media bucket for source files
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      bucketName: `${cdk.Aws.ACCOUNT_ID}-media-bucket-${cdk.Aws.STACK_NAME}-${props.resourceSuffix}`,
      eventBridgeEnabled: true, // Enable EventBridge notifications
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, // Enable SSE for security
      enforceSSL: true, // Enforce SSL for security
      cors: [
        {
          allowedHeaders: ['*'],
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE
          ],
          allowedOrigins: ['*'],
          exposedHeaders: ['ETag']
        }
      ]
    });

    // Create the Organized bucket for processed files
    this.organizedBucket = new s3.Bucket(this, 'OrganizedBucket', {
      bucketName: `${cdk.Aws.ACCOUNT_ID}-organized-bucket-${cdk.Aws.STACK_NAME}-${props.resourceSuffix}`,
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [  // Cost optimization: transition objects to cheaper storage
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            }
          ]
        }
      ]
    });

    // Create the Multimodal bucket
    this.multimodalBucket = new s3.Bucket(this, 'MultimodalBucket', {
      bucketName: `${cdk.Aws.ACCOUNT_ID}-multimodal-bucket-${cdk.Aws.STACK_NAME}-${props.resourceSuffix}`,
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true
    });

    // Create the Application Host bucket for the React frontend
    this.applicationHostBucket = new s3.Bucket(this, 'ApplicationHostBucket', {
      bucketName: `${cdk.Aws.ACCOUNT_ID}-app-host-bucket-${cdk.Aws.STACK_NAME}-${props.resourceSuffix}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For easier cleanup during development
      autoDeleteObjects: true // For easier cleanup during development
    });

    // Output the bucket names and ARNs
    new cdk.CfnOutput(this, 'MediaBucketName', {
      value: this.mediaBucket.bucketName,
      description: 'Media bucket name',
      exportName: `${id}-MediaBucketName`
    });

    new cdk.CfnOutput(this, 'OrganizedBucketName', {
      value: this.organizedBucket.bucketName,
      description: 'Organized bucket name',
      exportName: `${id}-OrganizedBucketName`
    });

    new cdk.CfnOutput(this, 'MultimodalBucketName', {
      value: this.multimodalBucket.bucketName,
      description: 'Multimodal bucket name',
      exportName: `${id}-MultimodalBucketName`
    });

    new cdk.CfnOutput(this, 'ApplicationHostBucketName', {
      value: this.applicationHostBucket.bucketName,
      description: 'Application host bucket name',
      exportName: `${id}-ApplicationHostBucketName`
    });
  }
}
