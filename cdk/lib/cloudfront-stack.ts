import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WAF_TAGS } from './constants';

/**
 * Props for the CloudFrontStack
 */
export interface CloudFrontStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * S3 bucket for media files
   */
  mediaBucket: s3.Bucket;
  
  /**
   * S3 bucket for hosting React application
   */
  applicationHostBucket: s3.Bucket;
  
  /**
   * Edge lambda function ARN (Optional - can be added later)
   */
  edgeLambdaVersionArn?: string;
}

/**
 * CloudFront Stack for multimedia-rag application
 * 
 * This stack provisions:
 * - CloudFront distribution for delivering web content
 * - Origin access control for S3 buckets
 * - Request policies for query string forwarding
 */
export class CloudFrontStack extends cdk.Stack {
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
  
  constructor(scope: Construct, id: string, props: CloudFrontStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);
    
    // Create Origin Access Control for S3 buckets
    this.originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'MediaBucketCloudFrontOAC', {
      originAccessControlConfig: {
        name: `${cdk.Aws.STACK_NAME}-media-bucket-oac-${props.resourceSuffix}`,
        description: 'Origin Access Control for Media Bucket',
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
    
    // Define origins
    const mediaBucketOrigin = new origins.S3Origin(props.mediaBucket);
    const appBucketOrigin = new origins.S3Origin(props.applicationHostBucket);
    
    // Define default cache behavior with or without Lambda@Edge
    const defaultBehavior: cloudfront.BehaviorOptions = {
      origin: mediaBucketOrigin,
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
          origin: appBucketOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          compress: true
        },
        '*.js': {
          origin: appBucketOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT_AND_SECURITY_HEADERS,
          compress: true
        },
        '*.css': {
          origin: appBucketOrigin,
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
    
    // Create S3 bucket policies to allow access from CloudFront
    this.addBucketPolicy(props.mediaBucket);
    this.addBucketPolicy(props.applicationHostBucket);
    
    // Output the CloudFront domain name
    new cdk.CfnOutput(this, 'CloudFrontDomainName', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${id}-CloudFrontDomainName`
    });
    
    // Output just the ID portion of the domain name
    new cdk.CfnOutput(this, 'CloudFrontDomainNameId', {
      value: this.distribution.distributionDomainName.split('.cloudfront.net')[0],
      description: 'CloudFront Domain Name (ID only)',
      exportName: `${id}-CloudFrontDomainNameId`
    });
  }
  
  /**
   * Add bucket policy to allow CloudFront access
   */
  private addBucketPolicy(bucket: s3.Bucket): void {
    // Create bucket policy to allow CloudFront access
    const bucketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('*')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${cdk.Aws.ACCOUNT_ID}:distribution/${this.distribution.distributionId}`
        }
      }
    });
    
    // Add the policy to the bucket
    bucket.addToResourcePolicy(bucketPolicy);
  }
}
