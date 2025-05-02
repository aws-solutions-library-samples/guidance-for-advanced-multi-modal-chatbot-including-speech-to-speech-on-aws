import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WAF_TAGS } from './constants';

/**
 * Props for the StorageDistStack
 */
export interface StorageDistStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * Edge lambda function ARN (Optional - required for Auth)
   */
  edgeLambdaVersionArn?: string;
}

/**
 * Storage and Distribution Stack for multimedia-rag application
 * 
 * This combined stack provisions:
 * - S3 buckets for media files, organized content, multimodal data, and application hosting
 * - CloudFront distribution for delivering web content
 * - Origin access control for S3 buckets
 * - Request policies for query string forwarding
 * 
 * Grouping these together eliminates circular dependencies and creates a logical unit
 * that handles both storage and content distribution.
 */
export class StorageDistStack extends cdk.NestedStack {
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

  /**
   * CloudFront distribution
   */
  public readonly distribution: cloudfront.Distribution;
  
  /**
   * Origin request policy
   */
  public readonly edgeRequestPolicy: cloudfront.OriginRequestPolicy;
  
  /**
   * Origin access control for S3 buckets
   */
  public readonly originAccessControl: cloudfront.CfnOriginAccessControl;
  
  constructor(scope: Construct, id: string, props: StorageDistStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);
    
    // ======== STORAGE PART ========
    // Create the Media bucket for source files 
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
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
      eventBridgeEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true
    });

    // Create the Application Host bucket for the React frontend
    this.applicationHostBucket = new s3.Bucket(this, 'ApplicationHostBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For easier cleanup during development
      autoDeleteObjects: true // For easier cleanup during development
    });

    // ======== DISTRIBUTION PART ========
    // Create Origin Access Control for S3 buckets
    this.originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'CloudFrontOAC', {
      originAccessControlConfig: {
        name: `multimedia-rag-bucket-oac-${props.resourceSuffix}`,
        description: 'Origin Access Control for S3 Buckets',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
        originAccessControlOriginType: 's3'
      }
    });
    
    // Create Edge Request Policy for auth query parameter
    this.edgeRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'EdgeRequestPolicy', {
      originRequestPolicyName: `EdgeRequest-${props.resourceSuffix}`,
      comment: 'Origin request policy to forward auth query string',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.none(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.allowList('auth'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none()
    });
    
    // Create S3 origins
    const mediaBucketS3Origin = new origins.S3Origin(this.mediaBucket);
    const appBucketS3Origin = new origins.S3Origin(this.applicationHostBucket);
    
    // Define default cache behavior with or without Lambda@Edge
    const defaultBehavior: cloudfront.BehaviorOptions = {
      origin: mediaBucketS3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: this.edgeRequestPolicy,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
      ...(props.edgeLambdaVersionArn ? {
        edgeLambdas: [
          {
            functionVersion: lambda.Version.fromVersionArn(
              this, 
              'EdgeFunction', 
              props.edgeLambdaVersionArn
            ),
            eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST
          }
        ]
      } : {})
    };
    
    // Create CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultRootObject: 'index.html',
      comment: `Distribution for ${cdk.Aws.ACCOUNT_ID} media and application buckets`,
      defaultBehavior,
      additionalBehaviors: {
        '*.html': {
          origin: appBucketS3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          compress: true
        },
        '*.js': {
          origin: appBucketS3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          compress: true
        },
        '*.css': {
          origin: appBucketS3Origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          compress: true
        }
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      enableIpv6: true
    });
    
    // Apply Origin Access Control to S3 origins by modifying the CloudFront Distribution's CfnResource
    const cfnDistribution = this.distribution.node.defaultChild as cloudfront.CfnDistribution;
    
    // Get distribution config and apply OAC to S3 origins
    if (cfnDistribution.distributionConfig && typeof cfnDistribution.distributionConfig === 'object') {
      const cfnDistConfig = cfnDistribution.distributionConfig as any;
      
      if (Array.isArray(cfnDistConfig.origins)) {
        // Apply OAC to all S3 origins
        cfnDistConfig.origins.forEach((origin: any) => {
          if (origin.s3OriginConfig) {
            origin.originAccessControlId = this.originAccessControl.attrId;
            // Remove access identity reference if present
            delete origin.s3OriginConfig.originAccessIdentity;
          }
        });
      }
    }
    
    // Add bucket policies to allow CloudFront access using CDK's native methods
    this.mediaBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [this.mediaBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${this.distribution.distributionId}`
          }
        }
      })
    );
    
    this.applicationHostBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [this.applicationHostBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${this.distribution.distributionId}`
          }
        }
      })
    );

    // ======== OUTPUTS ========
    // Storage bucket outputs

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
    
    // Distribution outputs
    new cdk.CfnOutput(this, 'CloudFrontDistributionArn', {
      value: `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${this.distribution.distributionId}`,
      description: 'CloudFront Distribution ARN',
      exportName: `${id}-CloudFrontDistributionArn`
    });
    
  }
}
