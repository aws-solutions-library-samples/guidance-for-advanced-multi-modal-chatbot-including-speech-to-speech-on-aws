#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { NovaSonicStack } from './lib/nova-sonic-stack';

const app = new cdk.App();

// Deploy the ECS stack
new NovaSonicStack(app, 'NovaSonicBackendStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: 'us-east-1'  // Hardcoded to us-east-1 to ensure consistent deployment
  }
});
