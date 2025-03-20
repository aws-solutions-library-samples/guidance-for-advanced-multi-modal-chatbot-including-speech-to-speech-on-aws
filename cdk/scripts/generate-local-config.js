const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { program } = require('commander');

// Parse command line arguments
program
  .option('-e, --env <environment>', 'Environment name', 'dev')
  .option('-r, --region <region>', 'AWS region', process.env.AWS_REGION || 'us-east-1')
  .option('-p, --profile <profile>', 'AWS profile', 'default')
  .parse(process.argv);

const options = program.opts();
const env = options.env;
const region = options.region;
const profile = options.profile;

console.log(`Generating local development configuration for ${env} environment in ${region} region using AWS profile '${profile}'...`);

// Function to get CloudFormation output with retries
function getCloudFormationOutput(stackName) {
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    try {
      const result = execSync(
        `aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --profile ${profile} --query "Stacks[0].Outputs" --output json`,
        { encoding: 'utf-8' }
      );
      return JSON.parse(result);
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) {
        console.error(`Failed to get outputs for stack ${stackName}: ${error.message}`);
        throw error;
      }
      console.log(`Retrying (${attempts}/${maxAttempts}) to get stack outputs...`);
      // Sleep for a second before retrying
      execSync('sleep 1');
    }
  }
}

try {
  // Get outputs from all stacks
  const mainStackName = `MultimediaRagStack`;
  const mainStackOutputs = getCloudFormationOutput(mainStackName);
  
  // Function to find output value by export name
  function findOutputValue(outputs, key) {
    const output = outputs.find(o => o.ExportName === key || o.OutputKey === key);
    if (!output) {
      console.warn(`Warning: Output with key ${key} not found`);
      return '';
    }
    return output.OutputValue;
  }
  
  // Extract required values
  const userPoolId = findOutputValue(mainStackOutputs, `MultimediaRagStack-CognitoUserPoolId`);
  const userPoolClientId = findOutputValue(mainStackOutputs, `MultimediaRagStack-CognitoUserPoolClientId`);
  const identityPoolId = findOutputValue(mainStackOutputs, `MultimediaRagStack-CognitoIdentityPoolId`);
  const mediaBucket = findOutputValue(mainStackOutputs, `StorageStack-MediaBucketName`);
  const retrievalFunction = findOutputValue(mainStackOutputs, `ProcessingStack-RetrievalFunctionName`);
  const cloudfrontDomain = findOutputValue(mainStackOutputs, `CloudFrontStack-CloudFrontDomainName`);
  
  // Generate .env file content
  const envContent = `
REACT_APP_AWS_REGION=${region}
REACT_APP_USER_POOL_ID=${userPoolId}
REACT_APP_USER_POOL_CLIENT_ID=${userPoolClientId}
REACT_APP_IDENTITY_POOL_ID=${identityPoolId}
REACT_APP_S3_SOURCE=${mediaBucket}
REACT_APP_CLOUDFRONT_DOMAIN_NAME=${cloudfrontDomain}
REACT_APP_LAMBDA_FUNCTION_NAME=${retrievalFunction}
`.trim();

  // Write to .env.local file
  const envFile = path.join(__dirname, '../../chatbot-react/.env.local');
  fs.writeFileSync(envFile, envContent);
  
  console.log(`Local configuration successfully written to ${envFile}`);
  console.log('\nTo run the React app locally:');
  console.log('  cd chatbot-react');
  console.log('  npm start');
  
} catch (error) {
  console.error('Failed to generate local configuration:', error);
  process.exit(1);
}
