#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MultimediaRagStack } from '../lib/multimedia-rag-stack';
import { LambdaEdgeStack } from '../lib/lambda-edge-stack';
import { SpeechToSpeechStack } from '../lib/speech-to-speech-stack';
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
let edgeLambdaVersionArn: string | undefined;

// Define resources in dependency order
let edgeStack: LambdaEdgeStack | undefined;

// 1. Deploy Lambda@Edge stack first if requested (must be in us-east-1)
if (app.node.tryGetContext('deployEdgeLambda') === 'true') {
  edgeStack = new LambdaEdgeStack(app, `LambdaEdgeStack-${resourceSuffix}`, {
    resourceSuffix: resourceSuffix,
    // We'll update Cognito params later when we have them
    env: {
      account: account,
      region: 'us-east-1'  // Lambda@Edge must be in us-east-1
    },
    description: 'Lambda@Edge function for JWT validation with Cognito'
  });
  
  edgeLambdaVersionArn = edgeStack.edgeFunctionVersionArn;
  
  // Create an output with the Edge Function ARN for manual configuration
  new cdk.CfnOutput(edgeStack, 'LambdaEdgeVersionArn', {
    value: edgeLambdaVersionArn,
    description: 'Lambda@Edge Function Version ARN (Add this to CloudFront manually)',
    exportName: `LambdaEdge-VersionArn-${resourceSuffix}`
  });
}

// Check if Speech-to-Speech is requested and region is us-east-1
const deploySpeechToSpeech = 
  app.node.tryGetContext('deploySpeechToSpeech') === 'true' && 
  region === 'us-east-1';

// If Speech-to-Speech is enabled, the whole stack must be in us-east-1
if (app.node.tryGetContext('deploySpeechToSpeech') === 'true' && region !== 'us-east-1') {
  console.warn('Warning: Speech-to-Speech features can only be deployed in us-east-1 region.');
  console.warn('Set CDK_DEFAULT_REGION=us-east-1 to deploy with Speech-to-Speech support.');
}

// 2. Deploy main infrastructure stack with Edge ARN if available
const mainStack = new MultimediaRagStack(app, `MultimediaRagStack-${resourceSuffix}`, {
  resourceConfig: {
    resourceSuffix: resourceSuffix
  },
  modelId: DEFAULT_MODEL_ID,
  embeddingModelId: DEFAULT_EMBEDDING_MODEL_ID,
  useBedrockDataAutomation: true,
  edgeLambdaVersionArn: edgeLambdaVersionArn,
  // Pass Speech-to-Speech configuration
  deploySpeechToSpeech: deploySpeechToSpeech,
  speechToSpeechConfig: {
    ecrRepositoryName: `speech-to-speech-backend-${resourceSuffix}`,
    debugMode: app.node.tryGetContext('debugMode') === 'true',
  },
  // Allow specifying an external log bucket for higher security
  externalLogBucketArn: app.node.tryGetContext('externalLogBucketArn'),
  env: { 
    account: account, 
    region: region 
  },
  description: 'Multimedia RAG solution for deploying a chatbot that can interact with documents, images, audio, and video'
});

// Add dependency for proper deployment order
if (app.node.tryGetContext('deployEdgeLambda') === 'true' && edgeStack) {
  // Make the main stack depend on the edge stack for proper deployment order
  mainStack.addDependency(edgeStack);
}
