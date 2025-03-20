#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultimediaRagStack } from '../lib/multimedia-rag-stack';
import { LambdaEdgeStack } from '../lib/lambda-edge-stack';
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
}
