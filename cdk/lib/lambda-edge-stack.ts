import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WAF_TAGS } from './constants';

/**
 * Props for the LambdaEdgeStack
 */
export interface LambdaEdgeStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * Cognito User Pool ID (optional - can be set later via SSM Parameter)
   */
  cognitoUserPoolId?: string;
  
  /**
   * Cognito Region (optional - defaults to stack region)
   */
  cognitoRegion?: string;
}

/**
 * Lambda@Edge Stack for multimedia-rag application
 * 
 * IMPORTANT: This stack must be deployed in us-east-1 region as required by Lambda@Edge
 * 
 * This stack provisions:
 * - Lambda@Edge function for JWT validation with Cognito
 * - IAM role for Lambda@Edge
 */
export class LambdaEdgeStack extends cdk.Stack {
  /**
   * Lambda@Edge function
   */
  public readonly edgeFunction: lambda.Function;
  
  /**
   * Lambda@Edge function version ARN
   */
  public readonly edgeFunctionVersionArn: string;
  
  constructor(scope: Construct, id: string, props: LambdaEdgeStackProps) {
    super(scope, id, props);

    // Check if the stack is being deployed in us-east-1
    if (this.region !== 'us-east-1') {
      throw new Error('Lambda@Edge functions must be deployed in us-east-1 region');
    }

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);
    
    // Create IAM role for Lambda@Edge function
    const edgeFunctionRole = new iam.Role(this, 'EdgeFunctionRole', {
      roleName: `cf-edge-lambda-role-${props.resourceSuffix}`,
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com')
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });
    
    // Add permissions to create CloudWatch logs in any region (Lambda@Edge requirement)
    edgeFunctionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents'
        ],
        resources: [
          `arn:aws:logs:*:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/*`
        ]
      })
    );
    
    // Add permissions to read SSM parameters for Cognito configuration
    edgeFunctionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:*:${cdk.Aws.ACCOUNT_ID}:parameter/multimedia-rag/${props.resourceSuffix}/*`
        ]
      })
    );
    
    // Create Lambda@Edge function
    this.edgeFunction = new lambda.Function(this, 'EdgeFunction', {
      functionName: `cf-edge-lambda-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      role: edgeFunctionRole,
      memorySize: 128,
      timeout: cdk.Duration.seconds(5),
      code: lambda.Code.fromInline(`
import json
import base64
import time
import urllib.request
import urllib.parse
import boto3
from json import loads

# Global variables for caching
_cognito_config = None

def get_cognito_config():
    global _cognito_config
    if _cognito_config is None:
        try:
            resource_suffix = '${props.resourceSuffix}'
            target_region = '${props.cognitoRegion || 'us-east-1'}'
            ssm = boto3.client('ssm', region_name=target_region)
            
            # Get Cognito configuration from SSM
            user_pool_id = ssm.get_parameter(
                Name=f'/multimedia-rag/{resource_suffix}/cognito-user-pool-id'
            )['Parameter']['Value']
            
            cognito_region = ssm.get_parameter(
                Name=f'/multimedia-rag/{resource_suffix}/cognito-region'
            )['Parameter']['Value']
            
            _cognito_config = {
                'user_pool_id': user_pool_id,
                'cognito_region': cognito_region,
                'jwks_url': f'https://cognito-idp.{cognito_region}.amazonaws.com/{user_pool_id}/.well-known/jwks.json'
            }
        except Exception as e:
            print(f'Error getting Cognito config from SSM: {str(e)}')
            # Fallback to placeholder values if SSM fails
            _cognito_config = {
                'user_pool_id': 'POOL_ID_PLACEHOLDER',
                'cognito_region': '${props.cognitoRegion || 'us-east-1'}',
                'jwks_url': f'https://cognito-idp.${props.cognitoRegion || 'us-east-1'}.amazonaws.com/POOL_ID_PLACEHOLDER/.well-known/jwks.json'
            }
    
    return _cognito_config
def decode_token_segments(token):
  try:
      # Split token into header, payload, signature
      header_b64, payload_b64, signature = token.split('.')
      
      # Add padding if needed
      def add_padding(b64_str):
          pad_length = 4 - (len(b64_str) % 4)
          if pad_length != 4:
              b64_str += '=' * pad_length
          return b64_str
      
      # Decode header and payload
      header = loads(base64.urlsafe_b64decode(add_padding(header_b64)).decode('utf-8'))
      payload = loads(base64.urlsafe_b64decode(add_padding(payload_b64)).decode('utf-8'))
      
      return header, payload
  except Exception as e:
      raise Exception(f'Invalid token format: {str(e)}')

def verify_token_expiry(payload):
    current_time = int(time.time())
    exp_time = int(payload.get('exp', 0))
    
    if current_time > exp_time:
        raise Exception('Token has expired')
    
    return True

def lambda_handler(event, context):
    request = event['Records'][0]['cf']['request']
    
    # Handle OPTIONS preflight request
    if request.get('method') == 'OPTIONS':
        return {
            'status': '204',
            'statusDescription': 'OK',
            'headers': {
                'access-control-allow-origin': [{
                    'key': 'Access-Control-Allow-Origin',
                    'value': '*'
                }],
                'access-control-allow-methods': [{
                    'key': 'Access-Control-Allow-Methods',
                    'value': 'GET, HEAD, OPTIONS'
                }],
                'access-control-allow-headers': [{
                    'key': 'Access-Control-Allow-Headers',
                    'value': 'Content-Type, Accept'
                }],
                'access-control-max-age': [{
                    'key': 'Access-Control-Max-Age',
                    'value': '86400'
                }]
            }
        }

    # Get query parameters
    query_string = request.get('querystring', '')
    if not query_string:
        return generate_error_response('401', 'No auth token provided')
    
    # Parse query string
    params = {}
    if query_string:
        for param in query_string.split('&'):
            if '=' in param:
                key, value = param.split('=', 1)
                params[key] = urllib.parse.unquote(value)

    token = params.get('auth')
    if not token:
        return generate_error_response('401', 'No auth token provided')

    try:
        # Decode token without verification
        header, payload = decode_token_segments(token)
        
        # Verify expiry
        verify_token_expiry(payload)
        
        # Get Cognito configuration
        config = get_cognito_config()
        
        # Verify issuer (iss) if needed
        expected_issuer = f'https://cognito-idp.{config["cognito_region"]}.amazonaws.com/{config["user_pool_id"]}'
        if payload.get('iss') != expected_issuer:
            raise Exception('Invalid token issuer')
        
        # If all checks pass, return the request
        return request

    except Exception as e:
        return generate_error_response('403', f'Invalid token: {str(e)}')

def generate_error_response(status, message):
    return {
        'status': status,
        'statusDescription': 'Error',
        'headers': {
            'access-control-allow-origin': [{
                'key': 'Access-Control-Allow-Origin',
                'value': '*'
            }],
            'content-type': [{
                'key': 'Content-Type',
                'value': 'application/json'
            }]
        },
        'body': json.dumps({'message': message})
    }
      `)
    });
    
    // Create a version for the Lambda@Edge function
    const version = new lambda.Version(this, 'EdgeFunctionVersion', {
      lambda: this.edgeFunction,
      description: `Version for Lambda@Edge ${props.resourceSuffix}`
    });
    
    // Store the version ARN
    this.edgeFunctionVersionArn = version.functionArn;
    
    // Output the Lambda@Edge function version ARN
    new cdk.CfnOutput(this, 'EdgeFunctionVersionARN', {
      value: this.edgeFunctionVersionArn,
      description: 'Lambda@Edge Function Version ARN (Use this for CloudFront)',
      exportName: `${id}-EdgeFunctionVersionARN`
    });
  }
}
