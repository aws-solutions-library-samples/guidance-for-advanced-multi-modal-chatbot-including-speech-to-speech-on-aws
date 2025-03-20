#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultimediaRagStack } from '../lib/multimedia-rag-stack';
import { LambdaEdgeStack } from '../lib/lambda-edge-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { CloudFrontStack } from '../lib/cloudfront-stack';
import { DEFAULT_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID } from '../lib/constants';

const app = new cdk.App();

// Get environment information
let account = process.env.CDK_DEFAULT_ACCOUNT || '123456789012'; // placeholder that will be replaced during deployment
let region = process.env.CDK_DEFAULT_REGION || 'us-east-1'; // default region, will be replaced during deployment

// If CDK_DEFAULT_ACCOUNT or CDK_DEFAULT_REGION is not set, they will be determined during deployment
// using the AWS profile specified with --profile when running cdk deploy
if (!process.env.CDK_DEFAULT_ACCOUNT || !process.env.CDK_DEFAULT_REGION) {
  console.log('CDK_DEFAULT_ACCOUNT or CDK_DEFAULT_REGION not set. They will be determined from the AWS profile used during deployment.');
}

const resourceSuffix = app.node.tryGetContext('resourceSuffix') || 'dev';

// Deploy the main infrastructure stack (without CloudFront)
const mainStack = new MultimediaRagStack(app, `MultimediaRagStack-${resourceSuffix}`, {
  resourceConfig: {
    resourceSuffix: resourceSuffix
  },
  modelId: DEFAULT_MODEL_ID,
  embeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  useBedrockDataAutomation: true,
  env: { 
    account: account, 
    region: region 
  },
  description: 'Multimedia RAG solution for deploying a chatbot that can interact with documents, images, audio, and video'
});

// Get bucket names from the main stack outputs
const mediaBucketName = mainStack.storageStack.mediaBucket.bucketName;
const applicationHostBucketName = mainStack.storageStack.applicationHostBucket.bucketName;

// Deploy separate CloudFront stack
let cloudFrontStack: CloudFrontStack | undefined;
if (app.node.tryGetContext('skipCloudFront') !== 'true') {
  cloudFrontStack = new CloudFrontStack(app, 'CloudFrontStack', {
    resourceSuffix: resourceSuffix,
    mediaBucketName: mediaBucketName,
    applicationHostBucketName: applicationHostBucketName,
    env: { 
      account: account, 
      region: region 
    },
    description: 'CloudFront distribution for multimedia-rag chat assistant'
  });
  
  // Add a clear dependency
  cloudFrontStack.addDependency(mainStack);
}

// Deploy the Lambda@Edge stack (must be in us-east-1)
const edgeRegion = 'us-east-1';
let edgeLambdaVersionArn: string | undefined;

// Only deploy if explicitly requested via context
if (app.node.tryGetContext('deployEdgeLambda') === 'true' && cloudFrontStack) {
  const edgeStack = new LambdaEdgeStack(app, `LambdaEdgeStack-${resourceSuffix}`, {
    resourceSuffix: resourceSuffix,
    cognitoUserPoolId: mainStack.authStack.userPool.userPoolId,
    cognitoRegion: region,
    env: {
      account: account,
      region: edgeRegion
    },
    description: 'Lambda@Edge function for JWT validation with Cognito'
  });
  
  edgeLambdaVersionArn = edgeStack.edgeFunctionVersionArn;
}

// Deploy the Frontend stack only if requested
if (app.node.tryGetContext('deployFrontend') === 'true' && cloudFrontStack) {
  const frontendStack = new FrontendStack(app, `FrontendStack-${resourceSuffix}`, {
    resourceSuffix: resourceSuffix,
    applicationHostBucket: mainStack.storageStack.applicationHostBucket,
    distribution: cloudFrontStack.distribution,
    userPoolId: mainStack.authStack.userPool.userPoolId,
    userPoolClientId: mainStack.authStack.userPoolClient.userPoolClientId,
    identityPoolId: mainStack.authStack.identityPool.ref,
    mediaBucket: mediaBucketName,
    retrievalFunction: mainStack.processingStack.retrievalFunction.functionName,
    edgeLambdaVersionArn: edgeLambdaVersionArn,
    region: region,
    env: { 
      account: account, 
      region: region 
    },
    description: 'Frontend deployment for the Multimedia RAG Chat Assistant'
  });

  // Add dependency to ensure both stacks are deployed first
  frontendStack.addDependency(mainStack);
  frontendStack.addDependency(cloudFrontStack);
}
