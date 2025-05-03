import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { WAF_TAGS } from './constants';

/**
 * Props for the AuthStack
 */
export interface AuthStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * Email address for the admin user
   */
  adminEmail?: string;

  /**
   * Media bucket for source files
   */
  mediaBucket?: s3.Bucket;

  /**
   * Retrieval function
   */
  retrievalFunction?: lambda.Function;
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
export class AuthStack extends cdk.NestedStack {
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

    // Create Authenticated Role with all required permissions from chatbot.yaml
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
      // Add all policies as defined in chatbot.yaml
      inlinePolicies: {
        // Policy 1: CognitoAccess
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-identity:GetCredentialsForIdentity',
              ],
              resources: [
                `arn:aws:cognito-identity:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identitypool/${this.identityPool.ref}`
              ]
            })
          ]
        }),
        
        // Policy 2: LambdaInvokePolicy - Allow invoking the retrieval function
        LambdaInvokePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'lambda:InvokeFunction'
              ],
              resources: props.retrievalFunction ? 
                [props.retrievalFunction.functionArn] : 
                [`arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:*-retrieval-fn-*`]
            })
          ]
        }),
        
        // Policy 3: AdditionalServicesPolicy - Cognito operations and S3 access
        AdditionalServicesPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-identity:GetId',
                'cognito-identity:GetCredentialsForIdentity'
              ],
              resources: ['*']
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject'
              ],
              resources: props.mediaBucket ? 
                [props.mediaBucket.bucketArn, `${props.mediaBucket.bucketArn}/*`] :
                [
                  `arn:aws:s3:::*-media-bucket-*`,
                  `arn:aws:s3:::*-media-bucket-*/*`
                ]
            })
          ]
        }),
        
        // Policy 4: BedrockAccess - For Bedrock operations
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:StartIngestionJob',
                'bedrock:ListIngestionJobs'
              ],
              resources: [
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/*`
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
    
    // Create admin user if email is provided
    if (props.adminEmail) {
      // Create admin group
      const adminGroup = new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
        userPoolId: this.userPool.userPoolId,
        groupName: 'Administrators',
        description: 'Administrators group with full access',
      });
      
      // Create admin user with custom resource to trigger after the user pool is created
      const adminUserCreator = new cdk.CustomResource(this, 'AdminUserCreator', {
        serviceToken: this.createAdminUserLambda().serviceToken,
        properties: {
          UserPoolId: this.userPool.userPoolId,
          Email: props.adminEmail,
          GroupName: adminGroup.groupName,
          TemporaryPassword: this.generateTemporaryPassword()
        }
      });
      
      // Ensure the admin user is created after the group
      adminUserCreator.node.addDependency(adminGroup);
      
      new cdk.CfnOutput(this, 'AdminEmail', {
        value: props.adminEmail,
        description: 'Admin user email address'
      });
    }
  }
  
  /**
   * Create custom resource provider to create admin user
   */
  private createAdminUserLambda(): cr.Provider {
    // Create Lambda function for admin user creation
    const adminUserCreatorFunction = new cdk.aws_lambda.Function(this, 'AdminUserCreatorFunction', {
      runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: cdk.aws_lambda.Code.fromInline(`
const { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const response = require('cfn-response');

exports.handler = async (event, context) => {
  try {
    // Only process create and update events
    if (event.RequestType === 'Delete') {
      await response.send(event, context, response.SUCCESS, {});
      return;
    }
    
    const { UserPoolId, Email, GroupName, TemporaryPassword } = event.ResourceProperties;
    
    if (!UserPoolId || !Email || !GroupName || !TemporaryPassword) {
      throw new Error('Missing required parameters');
    }
    
    const cognitoClient = new CognitoIdentityProviderClient();
    
    // Create the user
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId,
      Username: Email,
      UserAttributes: [
        { Name: 'email', Value: Email },
        { Name: 'email_verified', Value: 'true' }
      ],
      TemporaryPassword,
      MessageAction: 'SUPPRESS' // We'll use custom email, not Cognito's template
    });
    
    const createUserResult = await cognitoClient.send(createUserCommand);
    console.log('User created:', createUserResult.User.Username);
    
    // Add user to admin group
    const addToGroupCommand = new AdminAddUserToGroupCommand({
      UserPoolId,
      Username: Email,
      GroupName
    });
    
    await cognitoClient.send(addToGroupCommand);
    console.log('User added to group:', GroupName);
    
    await response.send(event, context, response.SUCCESS, {
      UserName: Email,
      Group: GroupName
    });
  } catch (error) {
    console.error('Error creating admin user:', error);
    await response.send(event, context, response.FAILED, { Error: error.message });
  }
};
      `),
      timeout: cdk.Duration.minutes(2),
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'cognito-idp:AdminCreateUser',
            'cognito-idp:AdminAddUserToGroup'
          ],
          resources: [this.userPool.userPoolArn]
        })
      ]
    });
    
    // Create custom resource provider using the proper cr.Provider constructor
    return new cr.Provider(this, 'AdminUserCreatorProvider', {
      onEventHandler: adminUserCreatorFunction
    });
  }
  
  /**
   * Generate a secure temporary password
   */
  private generateTemporaryPassword(): string {
    // Simple function to generate a secure random password
    const length = 12;
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+';
    let password = '';
    
    // Use crypto module for better randomness in a real implementation
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    return password;
  }
}
