#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultimediaRagStack } from '../lib/multimedia-rag-stack';
import { LambdaEdgeStack } from '../lib/lambda-edge-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { DEFAULT_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID } from '../lib/constants';

const app = new cdk.App();

// Get environment information
const account = process.env.CDK_DEFAULT_ACCOUNT!;
const region = process.env.CDK_DEFAULT_REGION!;
const resourceSuffix = app.node.tryGetContext('resourceSuffix') || 'dev';

// Deploy the main stack
const mainStack = new MultimediaRagStack(app, 'MultimediaRagStack', {
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

// Deploy the Lambda@Edge stack (must be in us-east-1)
const edgeRegion = 'us-east-1';
let edgeLambdaVersionArn: string | undefined;

// Only deploy if explicitly requested via context
if (app.node.tryGetContext('deployEdgeLambda') === 'true') {
  const edgeStack = new LambdaEdgeStack(app, 'LambdaEdgeStack', {
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

// Deploy the Frontend stack
const frontendStack = new FrontendStack(app, 'FrontendStack', {
  resourceSuffix: resourceSuffix,
  applicationHostBucket: mainStack.storageStack.applicationHostBucket,
  distribution: mainStack.cloudFrontStack.distribution,
  userPoolId: mainStack.authStack.userPool.userPoolId,
  userPoolClientId: mainStack.authStack.userPoolClient.userPoolClientId,
  identityPoolId: mainStack.authStack.identityPool.ref,
  mediaBucket: mainStack.storageStack.mediaBucket.bucketName,
  retrievalFunction: mainStack.processingStack.retrievalFunction.functionName,
  edgeLambdaVersionArn: edgeLambdaVersionArn,
  region: region,
  env: { 
    account: account, 
    region: region 
  },
  description: 'Frontend deployment for the Multimedia RAG Chat Assistant'
});

// Add dependency to ensure main stack is deployed first
frontendStack.addDependency(mainStack);
