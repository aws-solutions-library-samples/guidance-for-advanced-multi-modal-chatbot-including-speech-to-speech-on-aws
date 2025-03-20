import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { WAF_TAGS } from './constants';

/**
 * Props for the FrontendStack
 */
export interface FrontendStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * S3 bucket for hosting the React application
   */
  applicationHostBucket: s3.Bucket;
  
  /**
   * CloudFront distribution for content delivery
   */
  distribution: cloudfront.Distribution;
  
  /**
   * Cognito User Pool ID
   */
  userPoolId: string;
  
  /**
   * Cognito User Pool Client ID
   */
  userPoolClientId: string;
  
  /**
   * Cognito Identity Pool ID
   */
  identityPoolId: string;
  
  /**
   * Media bucket name
   */
  mediaBucket: string;
  
  /**
   * Retrieval Lambda function name
   */
  retrievalFunction: string;
  
  /**
   * AWS Region
   */
  region?: string;
  
  /**
   * Lambda@Edge function version ARN (optional)
   * Used for CloudFront JWT validation
   */
  edgeLambdaVersionArn?: string;
}

/**
 * Frontend Stack for multimedia-rag application
 * 
 * This stack provisions:
 * - React app building and deployment to S3
 * - Environment configuration for the React app
 * - CloudFront invalidation after deployment
 */
export class FrontendStack extends cdk.Stack {
  /**
   * Path to local development config file
   */
  public readonly localConfigPath: string;
  
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);
    
    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);
    
    // Determine region to use
    const region = props.region || cdk.Stack.of(this).region;
    
    // Create environment variables for React build
    const reactEnv = {
      REACT_APP_AWS_REGION: region,
      REACT_APP_USER_POOL_ID: props.userPoolId,
      REACT_APP_USER_POOL_CLIENT_ID: props.userPoolClientId,
      REACT_APP_IDENTITY_POOL_ID: props.identityPoolId,
      REACT_APP_S3_SOURCE: props.mediaBucket,
      REACT_APP_CLOUDFRONT_DOMAIN_NAME: props.distribution.distributionDomainName,
      REACT_APP_LAMBDA_FUNCTION_NAME: props.retrievalFunction
    };
    
    // Build React app using custom resource
    const reactBuild = this.createReactBuild(reactEnv);
    
    // Create S3 deployment for React app built assets
    const frontendDeployment = new s3deploy.BucketDeployment(this, 'ReactAppDeployment', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../chatbot-react/build'))],
      destinationBucket: props.applicationHostBucket,
      distribution: props.distribution,
      distributionPaths: ['/*']
    });
    
    // Ensure S3 deployment happens after React build
    frontendDeployment.node.addDependency(reactBuild);
    
    // Generate local development configuration
    this.localConfigPath = this.generateLocalConfig(reactEnv);
    
    // Output local configuration path
    new cdk.CfnOutput(this, 'LocalConfigPath', {
      value: this.localConfigPath,
      description: 'Path to local development configuration file',
      exportName: `${id}-LocalConfigPath`
    });
  }
  
  /**
   * Create a custom resource to build the React app
   */
  private createReactBuild(environment: Record<string, string>): cr.AwsCustomResource {
    // Create role for React build custom resource
    const reactBuildRole = new iam.Role(this, 'ReactBuildRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    
    // Convert environment variables to environment string
    const envString = Object.entries(environment)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    
    // Create React build custom resource
    const reactBuild = new cr.AwsCustomResource(this, 'ReactBuild', {
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: this.createBuildFunction().functionName,
          Payload: JSON.stringify({
            environment
          })
        },
        physicalResourceId: cr.PhysicalResourceId.of(`ReactBuild-${Date.now()}`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      }),
      role: reactBuildRole
    });
    
    return reactBuild;
  }
  
  /**
   * Create a Lambda function to build the React app
   */
  private createBuildFunction(): lambda.Function {
    // Create execution role for build Lambda
    const executionRole = new iam.Role(this, 'BuildFunctionExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    
    // Create build function
    const buildFunction = new lambda.Function(this, 'BuildFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

exports.handler = async function(event) {
  console.log('Building React application...');
  console.log('Event: ' + JSON.stringify(event));
  
  // Extract environment variables
  const environment = event.environment || {};
  
  // Create .env file for React build
  const envContent = Object.entries(environment)
    .map(([key, value]) => \`\${key}=\${value}\`)
    .join('\\n');
  
  // Set up working directory
  const workDir = '/tmp/react-build';
  fs.mkdirSync(workDir, { recursive: true });
  
  // Copy React app to working directory
  execSync(\`cp -r /var/task/chatbot-react/* \${workDir}/\`);
  
  // Write environment variables to .env file
  fs.writeFileSync(\`\${workDir}/.env\`, envContent);
  
  // Install dependencies and build
  process.chdir(workDir);
  console.log('Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });
  console.log('Building application...');
  execSync('npm run build', { 
    stdio: 'inherit',
    env: { ...process.env, ...environment }
  });
  
  // Copy build artifacts to Lambda function's task directory
  execSync('cp -r build/* /var/task/chatbot-react/build/');
  
  console.log('Build complete');
  return { statusCode: 200, body: 'Build successful' };
};
      `),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      role: executionRole,
    });
    
    return buildFunction;
  }
  
  /**
   * Generate local development configuration
   */
  private generateLocalConfig(environment: Record<string, string>): string {
    // Path to local development configuration file
    const localConfigPath = path.join(__dirname, '../../chatbot-react/.env.local');
    
    // Create local config generator Lambda
    const localConfigFunction = new lambda.Function(this, 'LocalConfigFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
const fs = require('fs');
const path = require('path');

exports.handler = async function(event) {
  console.log('Generating local development configuration...');
  console.log('Event: ' + JSON.stringify(event));
  
  // Extract environment variables
  const environment = event.environment || {};
  
  // Create .env.local content
  const envContent = Object.entries(environment)
    .map(([key, value]) => \`\${key}=\${value}\`)
    .join('\\n');
  
  // Write to file
  const configPath = path.join('/tmp', '.env.local');
  fs.writeFileSync(configPath, envContent);
  
  console.log('Configuration generated successfully');
  return { statusCode: 200, body: 'Configuration generated', path: configPath };
};
      `),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512
    });
    
    // Create custom resource to generate local config
    const localConfigResource = new cr.AwsCustomResource(this, 'LocalConfigGenerator', {
      onUpdate: {
        service: 'Lambda',
        action: 'invoke',
        parameters: {
          FunctionName: localConfigFunction.functionName,
          Payload: JSON.stringify({
            environment
          })
        },
        physicalResourceId: cr.PhysicalResourceId.of(`LocalConfig-${Date.now()}`)
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE
      })
    });
    
    return localConfigPath;
  }
}
