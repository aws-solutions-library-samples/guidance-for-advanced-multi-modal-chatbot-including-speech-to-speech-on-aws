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
  
  /**
   * Network Load Balancer DNS name (Optional - required for WebSocket support)
   */
  nlbDnsName?: string;

  /**
   * Cross-account S3 bucket ARN for access logs (Optional - for higher security)
   * If provided, logs will be sent to this external bucket instead of the local log bucket
   */
  externalLogBucketArn?: string;
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
   * S3 bucket for access logs
   */
  public readonly accessLogBucket: s3.Bucket;

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
    
    // Create a dedicated bucket for access logs with appropriate security settings
    this.accessLogBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true, // Preserve log history
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED, // Ensure bucket owner has full control of logs
      lifecycleRules: [
        {
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30)
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90)
            }
          ],
          expiration: cdk.Duration.days(365) // Retain logs for 1 year
        }
      ]
    });
    
    // Determine which bucket to use for access logging
    let logBucket: s3.IBucket;
    if (props.externalLogBucketArn) {
      // Use external log bucket if ARN is provided (higher security)
      logBucket = s3.Bucket.fromBucketArn(this, 'ExternalLogBucket', props.externalLogBucketArn);
    } else {
      // Use the local log bucket
      logBucket = this.accessLogBucket;
    }
    
    // Create the Media bucket for source files 
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      eventBridgeEnabled: true, // Enable EventBridge notifications
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED, // Enable SSE for security
      enforceSSL: true, // Enforce SSL for security
      serverAccessLogsBucket: logBucket, // Enable access logging
      serverAccessLogsPrefix: 'media-bucket-logs/', // Using prefix to organize logs
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
      serverAccessLogsBucket: logBucket, // Enable access logging
      serverAccessLogsPrefix: 'organized-bucket-logs/', // Using prefix to organize logs
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
      enforceSSL: true,
      serverAccessLogsBucket: logBucket, // Enable access logging
      serverAccessLogsPrefix: 'multimodal-bucket-logs/' // Using prefix to organize logs
    });

    // Create the Application Host bucket for the React frontend
    this.applicationHostBucket = new s3.Bucket(this, 'ApplicationHostBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      serverAccessLogsBucket: logBucket, // Enable access logging
      serverAccessLogsPrefix: 'app-host-bucket-logs/', // Using prefix to organize logs
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
    
    // Create NLB origin if DNS name is provided
    let nlbOrigin: origins.HttpOrigin | undefined;
    
    if (props.nlbDnsName) {
      nlbOrigin = new origins.HttpOrigin(props.nlbDnsName, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        httpPort: 8081,
        readTimeout: cdk.Duration.seconds(60),
        keepaliveTimeout: cdk.Duration.seconds(60)
      });
    }
    
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
    
    // Create additionalBehaviors object with conditional WebSocket behavior
    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {
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
    };
    
    // Add WebSocket behavior if NLB origin is available
    if (nlbOrigin) {
      additionalBehaviors['/ws/*'] = {
        origin: nlbOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        compress: true
      };
    }
    
    // Create CloudFront Distribution
    this.distribution = new cloudfront.Distribution(this, 'CloudFrontDistribution', {
      defaultRootObject: 'index.html',
      comment: `Distribution for ${cdk.Aws.ACCOUNT_ID} media and application buckets`,
      defaultBehavior,
      additionalBehaviors,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2,
      enableIpv6: true,
      
      // Security configurations
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021, // Enforce TLSv1.2 with modern ciphers
      
      // Enable CloudFront logging for security audits and investigations
      enableLogging: true,
      logBucket: this.accessLogBucket,
      logFilePrefix: 'cloudfront-logs/',
      logIncludesCookies: true // Include cookies for comprehensive investigation capability
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
    
    // Access log bucket output
    new cdk.CfnOutput(this, 'AccessLogsBucketName', {
      value: this.accessLogBucket.bucketName,
      description: 'S3 Access Logs Bucket Name',
      exportName: `${id}-AccessLogsBucketName`
    });
  }
}
