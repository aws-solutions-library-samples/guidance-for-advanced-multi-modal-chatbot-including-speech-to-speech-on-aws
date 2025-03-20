import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import { WAF_TAGS } from './constants';

/**
 * Props for the AuthStack
 */
export interface AuthStackProps extends cdk.StackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
}

/**
 * Authentication Stack for multimedia-rag application
 * 
 * This stack provisions the authentication resources:
 * - Cognito User Pool for user management and authentication
 * - User Pool Client for application integration
 * - Identity Pool for providing temporary AWS credentials
 * - IAM role for authenticated users
 */
export class AuthStack extends cdk.Stack {
  /**
   * Cognito User Pool for user management
   */
  public readonly userPool: cognito.UserPool;
  
  /**
   * User Pool Client for application integration
   */
  public readonly userPoolClient: cognito.UserPoolClient;
  
  /**
   * Identity Pool for temporary AWS credentials
   */
  public readonly identityPool: cognito.CfnIdentityPool;
  
  /**
   * IAM role for authenticated users
   */
  public readonly authenticatedRole: iam.Role;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);

    // Create Cognito User Pool
    this.userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      signInAliases: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: true
        }
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY // For easier cleanup during development
    });

    // Create User Pool Client
    this.userPoolClient = this.userPool.addClient('ChatbotUserPoolClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true
      },
      oAuth: {
        flows: {
          implicitCodeGrant: true,
          authorizationCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PHONE,
          cognito.OAuthScope.COGNITO_ADMIN
        ],
        callbackUrls: ['https://example.com']
      },
      accessTokenValidity: cdk.Duration.minutes(5),
      idTokenValidity: cdk.Duration.minutes(5),
      refreshTokenValidity: cdk.Duration.days(7)
    });

    // Create Identity Pool
    this.identityPool = new cognito.CfnIdentityPool(this, 'ChatbotIdentityPool', {
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.userPoolClient.userPoolClientId,
          providerName: this.userPool.userPoolProviderName,
          serverSideTokenCheck: true
        }
      ]
    });

    // Create Authenticated Role with limited permissions initially
    // (Additional permissions will be granted by other stacks)
    this.authenticatedRole = new iam.Role(this, 'ChatbotIdentityPoolAuthRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': this.identityPool.ref
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated'
          }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      description: 'Role for authenticated users',
      // Add base policies
      inlinePolicies: {
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-identity:GetCredentialsForIdentity',
                'cognito-identity:GetId'
              ],
              resources: [
                `arn:aws:cognito-identity:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identitypool/${this.identityPool.ref}`
              ]
            })
          ]
        })
      }
    });

    // Attach role to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.identityPool.ref,
      roles: {
        authenticated: this.authenticatedRole.roleArn
      }
    });

    // Output User Pool and Identity Pool IDs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${id}-UserPoolId`
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${id}-UserPoolClientId`
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: this.identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${id}-IdentityPoolId`
    });
  }
}
