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
   * Cognito User Pool ID
   */
  cognitoUserPoolId: string;
  
  /**
   * Cognito Region
   */
  cognitoRegion: string;
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
    
    // Create Lambda@Edge function
    this.edgeFunction = new lambda.Function(this, 'EdgeFunction', {
      functionName: `cf-edge-lambda-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      role: edgeFunctionRole,
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      code: lambda.Code.fromInline(`
import json
import base64
import time
import urllib.request
import urllib.parse
from json import loads

COGNITO_REGION = '${props.cognitoRegion}'
USER_POOL_ID = '${props.cognitoUserPoolId}'
JWKS_URL = f'https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json'
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
        
        # Verify issuer (iss) if needed
        expected_issuer = f'https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{USER_POOL_ID}'
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
