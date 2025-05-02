import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import { DEFAULT_MODEL_ID, DEFAULT_EMBEDDING_MODEL_ID, WAF_TAGS } from './constants';

/**
 * Props for the ProcessingStack
 */
export interface ProcessingStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;
  
  /**
   * The Bedrock model ID to use for inference
   */
  modelId?: string;
  
  /**
   * The Bedrock embedding model ID to use for vector embeddings
   */
  embeddingModelId?: string;
  
  /**
   * Media bucket for source files
   */
  mediaBucket: s3.Bucket;
  
  /**
   * Organized bucket for processed files
   */
  organizedBucket: s3.Bucket;
  
  /**
   * Multimodal bucket for Bedrock Knowledge Base
   */
  multimodalBucket: s3.Bucket;

  /**
   * OpenSearch Serverless Collection
   */
  opensearchCollection: opensearchserverless.CfnCollection;
}

/**
 * Processing Stack for multimedia-rag application
 * 
 * This stack provisions the Lambda functions and Bedrock resources:
 * - BDA Project Creator function
 * - BDA Processing function
 * - Initial Processing function
 * - Retrieval function
 * - Bedrock Knowledge Base and Data Source
 */
export class ProcessingStack extends cdk.NestedStack {
  /**
   * Dependency Layer for Lambda functions
   */
  public readonly dependencyLayer: lambda.LayerVersion;
  
  /**
   * BDA Project ARN
   */
  public readonly bdaProjectArn: string;
  
  /**
   * Retrieval Lambda function
   */
  public readonly retrievalFunction: lambda.Function;
  
  /**
   * Bedrock Knowledge Base
   */
  public readonly knowledgeBase: bedrock.CfnKnowledgeBase;
  
  /**
   * Bedrock Knowledge Base Data Source
   */
  public readonly dataSource: bedrock.CfnDataSource;
  
  /**
   * Bedrock Knowledge Base ID
   */
  public readonly knowledgeBaseId: string;
  
  /**
   * Bedrock Knowledge Base ARN
   */
  public readonly knowledgeBaseArn: string;
  
  /**
   * Bedrock Knowledge Base Data Source ID
   */
  public readonly dataSourceId: string;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);

    // Use provided model IDs or defaults
    const modelId = props.modelId || DEFAULT_MODEL_ID;
    const embeddingModelId = props.embeddingModelId || DEFAULT_EMBEDDING_MODEL_ID;

    // Create dependency layer for Lambda functions
    this.dependencyLayer = this.createDependencyLayer();

    // Create BDA (Bedrock Data Automation) resources
    const bdaResources = this.createBdaResources(props);
    this.bdaProjectArn = bdaResources.bdaProjectArn;
    
    // Create Initial Processing Lambda to handle new uploads
    const { initialProcessingFunction } = this.createInitialProcessingFunction(
      props,
      bdaResources.bdaProjectArn,
      bdaResources.bdaProcessingFunction
    );

    // Create file processing rule with shorter name to trigger Initial Processing Lambda
    const fileProcessingRule = new events.Rule(this, 'FileProcessingRule', {
      ruleName: `file-proc-rule-${props.resourceSuffix}`,
      description: 'Rule to process media and non-media files',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [props.mediaBucket.bucketName]
          }
        }
      }
    });
    
    fileProcessingRule.addTarget(new targets.LambdaFunction(initialProcessingFunction));
    
    // Create Retrieval Lambda function
    this.retrievalFunction = this.createRetrievalFunction(props, modelId);

    // Create Bedrock Knowledge Base resources
    const bedrockResources = this.createBedrockKnowledgeBaseResources(props, embeddingModelId);
    this.knowledgeBase = bedrockResources.knowledgeBase;
    this.dataSource = bedrockResources.dataSource;
    this.knowledgeBaseId = bedrockResources.knowledgeBaseId;
    this.knowledgeBaseArn = bedrockResources.knowledgeBaseArn;
    this.dataSourceId = bedrockResources.dataSourceId;

    // Output resources for cross-stack references
    new cdk.CfnOutput(this, 'RetrievalFunctionArn', {
      value: this.retrievalFunction.functionArn,
      description: 'Retrieval Lambda Function ARN',
      exportName: `${id}-RetrievalFunctionArn`
    });
  }

  /**
   * Create the dependency layer for Lambda functions
   */
  private createDependencyLayer(): lambda.LayerVersion {
    // Create a bucket for storing layer code
    const layerBucket = new s3.Bucket(this, 'LayerBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true
    });

    // Create layer creator Lambda function
    const layerCreatorFunction = new lambda.Function(this, 'LayerCreatorFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import os
import subprocess
import shutil
import zipfile

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            # Get properties
            bucket = event['ResourceProperties']['Bucket']
            key = 'layer.zip'
            
            # Create working directory
            os.makedirs('/tmp/python/lib/python3.12/site-packages', exist_ok=True)
            
            # Install packages with --upgrade to ensure latest versions
            subprocess.check_call([
                'pip', 'install',
                '--platform', 'manylinux2014_x86_64',
                '--implementation', 'cp',
                '--only-binary=:all:',
                '--upgrade',  # This flag ensures we get the latest versions
                '--target', '/tmp/python/lib/python3.12/site-packages',
                'boto3',
                'botocore',
                'opensearch-py',
                'requests-aws4auth'
            ])
            
            # Create ZIP file
            shutil.make_archive('/tmp/layer', 'zip', '/tmp')
            
            # Upload to S3
            s3 = boto3.client('s3')
            s3.upload_file('/tmp/layer.zip', bucket, key)
            
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                'Bucket': bucket,
                'Key': key
            })
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      timeout: cdk.Duration.minutes(15),
      role: new iam.Role(this, 'LayerCreatorRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        ],
        inlinePolicies: {
          S3Access: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['s3:PutObject'],
                resources: [layerBucket.arnForObjects('*')]
              })
            ]
          })
        }
      })
    });

    // Create the layer using a Custom Resource
    const layerCreatorProvider = new cr.Provider(this, 'LayerCreatorProvider', {
      onEventHandler: layerCreatorFunction
    });

    const createLayer = new cdk.CustomResource(this, 'CreateLayer', {
      serviceToken: layerCreatorProvider.serviceToken,
      properties: { Bucket: layerBucket.bucketName }
    });

    // Create the Lambda layer using the zip file in the S3 bucket
    const dependencyLayer = new lambda.LayerVersion(this, 'DependencyLayer', {
      code: lambda.Code.fromBucket(layerBucket, 'layer.zip'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'Layer for dependencies'
    });
    
    // Ensure the layer is created after the zip file is uploaded
    dependencyLayer.node.addDependency(createLayer);

    return dependencyLayer;
  }

  /**
   * Create Bedrock Data Automation resources
   */
  private createBdaResources(props: ProcessingStackProps): {
    bdaProjectArn: string;
    bdaProcessingFunction: lambda.Function;
  } {
    // Create BDA Project Creator role with appropriate permissions
    const bdaProjectCreatorRole = new iam.Role(this, 'BDAProjectCreatorRole', {
      roleName: `bda-creator-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        BDAAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['bedrock:CreateDataAutomationProject'],
              resources: [`arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:data-automation-project/*`]
            })
          ]
        })
      }
    });

    // Create BDA Project Creator function based on chatbot.yaml implementation
    const bdaProjectCreatorFunction = new lambda.Function(this, 'BDAProjectCreatorFunction', {
      functionName: `bda-project-creator-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import os
from botocore.exceptions import ClientError

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            # Get stack name and resource suffix from environment variables
            stack_name = os.environ.get('STACK_NAME')
            resource_suffix = os.environ.get('RESOURCE_SUFFIX')
            region = os.environ.get('REGION')
            project_name = f"{stack_name}-bda-project-{resource_suffix}"
            
            # Create Bedrock Data Automation client
            bda_client = boto3.client('bedrock-data-automation', region)
            
            # Define standard output configuration
            standard_output_config = {
                "document": {
                    "extraction": {
                        "granularity": {
                            "types": [
                                "PAGE",
                                "ELEMENT",
                                "WORD"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED"
                    },
                    "outputFormat": {
                        "textFormat": {
                            "types": [
                                "PLAIN_TEXT"
                            ]
                        },
                        "additionalFileFormat": {
                            "state": "ENABLED"
                        }
                    }
                },
                "image": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TEXT_DETECTION",
                                "CONTENT_MODERATION"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "IMAGE_SUMMARY",
                            "IAB"
                        ]
                    }
                },
                "video": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TRANSCRIPT",
                                "TEXT_DETECTION",
                                "CONTENT_MODERATION"
                            ]
                        },
                        "boundingBox": {
                            "state": "ENABLED"
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "VIDEO_SUMMARY",
                            "CHAPTER_SUMMARY",
                            "IAB"
                        ]
                    }
                },
                "audio": {
                    "extraction": {
                        "category": {
                            "state": "ENABLED",
                            "types": [
                                "TRANSCRIPT",
                                "AUDIO_CONTENT_MODERATION"
                            ]
                        }
                    },
                    "generativeField": {
                        "state": "ENABLED",
                        "types": [
                            "AUDIO_SUMMARY",
                            "TOPIC_SUMMARY"
                        ]
                    }
                }
            }
            
            try:
                # Create the project
                response = bda_client.create_data_automation_project(
                    projectName=project_name,
                    projectDescription=f"Data automation project for {project_name}",
                    projectStage='LIVE',
                    standardOutputConfiguration=standard_output_config,
                    overrideConfiguration={
                        'document': {
                            'splitter': {
                                'state': 'ENABLED'
                            }
                        }
                    }
                )
                
                print(f"Project created successfully with ARN: {response['projectArn']}")
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {
                    'ProjectArn': response['projectArn'],
                    'ProjectName': project_name
                })
            except ClientError as e:
                print(f"Error: {str(e)}")
                cfnresponse.send(event, context, cfnresponse.FAILED, {
                    'Error': str(e)
                })
        else:
            # Handle DELETE request
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      role: bdaProjectCreatorRole,
      layers: [this.dependencyLayer],
      environment: {
        STACK_NAME: cdk.Aws.STACK_NAME,
        RESOURCE_SUFFIX: props.resourceSuffix,
        REGION: cdk.Aws.REGION
      }
    });
    
    // Create a lambda-backed custom resource directly instead of using a provider
    const bdaProjectCreator = new cdk.CustomResource(this, 'BDAProjectCreator', {
      serviceToken: bdaProjectCreatorFunction.functionArn,
      properties: {
        Name: `bda-project-${props.resourceSuffix}`
      }
    });
    
    // Get the project ARN from the custom resource
    const bdaProjectArn = bdaProjectCreator.getAttString('ProjectArn');

    // Create BDA Processing Function Role
    const bdaProcessingFunctionRole = new iam.Role(this, 'BDAProcessingFunctionRole', {
      roleName: `BDAProcessingFunctionRole-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:PutObject',
                's3:GetObject',
                's3:ListBucket'
              ],
              resources: [
                props.organizedBucket.bucketArn,
                `${props.organizedBucket.bucketArn}/*`
              ]
            })
          ]
        })
      }
    });

    // Create BDA Processing Lambda function
    const bdaProcessingFunction = new lambda.Function(this, 'BDAProcessingFunction', {
      functionName: `bda-processor-${props.resourceSuffix}`,
      layers: [this.dependencyLayer],
      handler: 'index.lambda_handler',
      role: bdaProcessingFunctionRole,
      code: lambda.Code.fromAsset('lambda/bda-processing'),
      runtime: lambda.Runtime.PYTHON_3_12,
      timeout: cdk.Duration.minutes(15),
      memorySize: 256,
      environment: {
        ORGANIZED_BUCKET: props.organizedBucket.bucketName,
        CHUNK_SIZE_MS: '60000'
      }
    });

    // Create BDA Event Rule
    const bdaEventRule = new events.Rule(this, 'BDAEventRule', {
      ruleName: `bda-async-rule-${props.resourceSuffix}`,
      description: 'Rule for BDA async API calls',
      eventPattern: {
        source: [
          'aws.bedrock',
          'aws.bedrock-test'
        ],
        detailType: [
          'Bedrock Data Automation Job Succeeded',
          'Bedrock Data Automation Job Failed With Client Error',
          'Bedrock Data Automation Job Failed With Service Error'
        ]
      }
    });
    
    // Add target to the event rule
    bdaEventRule.addTarget(new targets.LambdaFunction(bdaProcessingFunction));

    // Add permission for EventBridge to invoke the Lambda function
    bdaProcessingFunction.addPermission('BDAProcessingFunctionLambdaPermission', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: bdaEventRule.ruleArn
    });

    return { bdaProjectArn, bdaProcessingFunction };
  }

  /**
   * Create Initial Processing Lambda function
   */
  private createInitialProcessingFunction(
    props: ProcessingStackProps,
    bdaProjectArn: string,
    bdaProcessingFunction: lambda.Function
  ): {
    initialProcessingFunction: lambda.Function;
  } {
    // Create Initial Processing Role with shorter name
    const initialProcessingRole = new iam.Role(this, 'InitialProcessingRole', {
      roleName: `init-proc-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:DeleteObject'],
              resources: [`${props.mediaBucket.bucketArn}/*`]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:PutObject'],
              resources: [`${props.organizedBucket.bucketArn}/*`]
            })
          ]
        }),
        TranscribeAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['transcribe:StartTranscriptionJob'],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Use a condition to add BDA invoke permissions after the project ARN is available
    const bdaInvokePolicy = new iam.Policy(this, 'BDAInvokePolicy', {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['bedrock:InvokeDataAutomationAsync'],
          resources: [
            bdaProjectArn,
            `arn:aws:bedrock:us-east-1:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-east-2:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-west-1:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`,
            `arn:aws:bedrock:us-west-2:${cdk.Aws.ACCOUNT_ID}:data-automation-profile/us.data-automation-v1`
          ]
        })
      ]
    });
    
    // Attach the policy to the role
    bdaInvokePolicy.attachToRole(initialProcessingRole);

    // Create Initial Processing Lambda function with shorter name
    const initialProcessingFunction = new lambda.Function(this, 'InitialProcessingFunction', {
      functionName: `init-processing-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromInline(`
import json
import boto3
import os
from datetime import datetime

region = os.environ['AWS_REGION']
s3 = boto3.client('s3')
transcribe = boto3.client('transcribe')
bedrock_data_automation = boto3.client('bedrock-data-automation-runtime', region_name=region)
MEDIA_EXTENSIONS = ['.mp3', '.mp4', '.wav', '.flac', '.ogg', '.amr', '.webm']

def lambda_handler(event, context):
    print('Received event:', json.dumps(event, indent=2))
    account_id = context.invoked_function_arn.split(':')[4]
    print('PROCESSING REGION:', region)
    source_bucket = event['detail']['bucket']['name']
    key = event['detail']['object']['key']
    target_bucket = os.environ['ORGANIZED_BUCKET']
    is_bedrock_data_automation = os.environ.get('IS_BEDROCK_DATA_AUTOMATION', 'false').lower() == 'true'
    
    file_extension = os.path.splitext(key)[1].lower()
    file_name = os.path.splitext(os.path.basename(key))[0]
    file_name_with_extension = f"{file_name}_{file_extension[1:]}"

    if is_bedrock_data_automation:
        # Processing with Bedrock Data Automation
        print("Processing with Bedrock Data Automation")
        try:
            response = bedrock_data_automation.invoke_data_automation_async(
                inputConfiguration={
                    's3Uri': f's3://{source_bucket}/{key}'
                },
                outputConfiguration={
                    's3Uri': f's3://{target_bucket}/bda-output/{file_name_with_extension}/'
                },
                dataAutomationConfiguration={
                    'dataAutomationProjectArn': os.environ['BDA_AUTOMATION_ARN'],
                    'stage': 'LIVE'
                },
                notificationConfiguration={
                    'eventBridgeConfiguration': {
                        'eventBridgeEnabled': True
                    }
                },
                dataAutomationProfileArn = f'arn:aws:bedrock:{region}:{account_id}:data-automation-profile/us.data-automation-v1'
            )
            
            print(f"BDA processing started: {response}")
            return {
                'statusCode': 200,
                'body': json.dumps({
                    'message': 'BDA processing started',
                    'response': response
                })
            }
        except Exception as e:
            print(f"Error processing with BDA: {str(e)}")
            raise
    else:
        # Processing logic for non-BDA case
        if file_extension in MEDIA_EXTENSIONS:
            print(f"Media file detected: {key}")
            transcription_job_name = f"{file_name_with_extension}-{int(datetime.now().timestamp())}"
            media_file_uri = f"s3://{source_bucket}/{key}"
            output_key = f"raw-transcripts/{file_name_with_extension}.json"
            transcription_params = {
                'TranscriptionJobName': transcription_job_name,
                'LanguageCode': 'en-US',
                'MediaFormat': file_extension[1:],
                'Media': {'MediaFileUri': media_file_uri},
                'OutputBucketName': target_bucket,
                'OutputKey': output_key
            }
            try:
                transcribe.start_transcription_job(**transcription_params)
                print(f"Transcription job started: {transcription_job_name}")
                return {
                    'statusCode': 200,
                    'body': json.dumps({
                        'message': 'Transcription job started',
                        'jobName': transcription_job_name
                    })
                }
            except Exception as e:
                print(f"Error starting transcription job: {str(e)}")
                raise
        else:
            print(f"Non-media file detected: {key}")
            new_key = f"Documents/{file_name_with_extension}{file_extension}"
            try:
                s3.copy_object(
                    Bucket=target_bucket,
                    CopySource=f"/{source_bucket}/{key}",
                    Key=new_key
                )
                print(f"File moved to: {new_key}")
                return {
                    'statusCode': 200,
                    'body': json.dumps('File processed successfully')
                }
            except Exception as e:
                print(f"Error processing file: {str(e)}")
                raise
      `),
      role: initialProcessingRole,
      layers: [this.dependencyLayer],
      timeout: cdk.Duration.minutes(15),
      environment: {
        ORGANIZED_BUCKET: props.organizedBucket.bucketName,
        IS_BEDROCK_DATA_AUTOMATION: 'true',
        BDA_AUTOMATION_ARN: bdaProjectArn
      }
    });

    return { initialProcessingFunction };
  }

  /**
   * Create Retrieval Lambda function
   */
  private createRetrievalFunction(props: ProcessingStackProps, modelId: string): lambda.Function {
    // Create Retrieval Function Role
    const retrievalFunctionRole = new iam.Role(this, 'RetrievalFunctionRole', {
      roleName: `retrieval-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        BedrockAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                'bedrock:RetrieveAndGenerate', 
                'bedrock-agent-runtime:Retrieve',
                'bedrock-agent-runtime:RetrieveAndGenerate',
                'bedrock-runtime:InvokeModel',
                'bedrock:ApplyGuardrail'
              ],
              resources: ['*']
            })
          ]
        }),
        CloudWatchLogsAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup', 
                'logs:CreateLogStream', 
                'logs:PutLogEvents'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    // Create Retrieval Lambda function with adequate permissions
    const retrievalFunction = new lambda.Function(this, 'RetrievalFunction', {
      functionName: `retrieval-fn-${props.resourceSuffix}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.lambda_handler',
      code: lambda.Code.fromAsset('lambda/retrieval'),
      role: retrievalFunctionRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      environment: {
        MODEL_ID: modelId
        // OPS_KNOWLEDGE_BASE_ID will be added after creating the Knowledge Base
      }
    });

    return retrievalFunction;
  }

  /**
   * Create Bedrock Knowledge Base resources
   */
  private createBedrockKnowledgeBaseResources(
    props: ProcessingStackProps,
    embeddingModelId: string
  ): {
    knowledgeBase: bedrock.CfnKnowledgeBase;
    dataSource: bedrock.CfnDataSource;
    knowledgeBaseId: string;
    knowledgeBaseArn: string;
    dataSourceId: string;
  } {
    // Create Bedrock Knowledge Base Role with enhanced permissions
    const bedrockKnowledgeBaseRole = new iam.Role(this, 'BedrockKnowledgeBaseRole', {
      roleName: `kb-role-${props.resourceSuffix}`,
      assumedBy: new iam.ServicePrincipal('bedrock.amazonaws.com'),
      inlinePolicies: {
        BedrockKBAccess: new iam.PolicyDocument({
          statements: [
            // OpenSearch Serverless comprehensive permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:APIAccessAll'
              ],
              resources: [
                props.opensearchCollection.attrArn,
                `${props.opensearchCollection.attrArn}/*`,
                `arn:aws:aoss:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:collection/*`
              ]
            }),
            // S3 permissions for organized bucket
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject',
                's3:DeleteObject',
                's3:GetBucketLocation'
              ],
              resources: [
                props.organizedBucket.bucketArn,
                `${props.organizedBucket.bucketArn}/*`
              ]
            }),
            // S3 permissions for multimodal bucket
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:ListBucket',
                's3:PutObject',
                's3:DeleteObject',
                's3:GetBucketLocation'
              ],
              resources: [
                props.multimodalBucket.bucketArn,
                `${props.multimodalBucket.bucketArn}/*`
              ]
            }),
            // Bedrock model permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'bedrock:ListFoundationModels',
                'bedrock:GetFoundationModel',
                'bedrock:InvokeModel',
                'bedrock:Retrieve',
                'bedrock-agent:*',
                'bedrock-agent-runtime:*'
              ],
              resources: [
                `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:custom-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:provisioned-model/*`,
                `arn:aws:bedrock:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:knowledge-base/*`
              ]
            })
          ]
        })
      }
    });

    // Create a delay function to allow OpenSearch collection to fully initialize
    const openSearchDelayFunction = new lambda.Function(this, 'OpenSearchDelayFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import time
import cfnresponse

def handler(event, context):
  try:
    # Sleep for 30 seconds to allow OpenSearch collection to be fully ready
    time.sleep(30)
    cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
  except Exception as e:
    print(f"Error: {str(e)}")
    cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      timeout: cdk.Duration.minutes(1),
      role: new iam.Role(this, 'OpenSearchDelayFunctionRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
        ]
      })
    });
    
    // Create a custom resource for the delay
    const openSearchDelayProvider = new cr.Provider(this, 'OpenSearchDelayProvider', {
      onEventHandler: openSearchDelayFunction
    });
    
    const openSearchDelayResource = new cdk.CustomResource(this, 'OpenSearchDelay', {
      serviceToken: openSearchDelayProvider.serviceToken,
      properties: {
        CollectionArn: props.opensearchCollection.attrArn,
        Timestamp: Date.now().toString() // To force this to run on every deployment
      }
    });
    
    // Create Bedrock Knowledge Base using L1 construct
    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, 'BedrockDocsKnowledgeBase', {
      name: `docs-kb-${props.resourceSuffix}`,
      description: 'Knowledge base for documents',
      knowledgeBaseConfiguration: {
        type: 'VECTOR',
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/${embeddingModelId}`,
          supplementalDataStorageConfiguration: {
            supplementalDataStorageLocations: [
              {
                supplementalDataStorageLocationType: 'S3',
                s3Location: {
                  uri: `s3://${props.multimodalBucket.bucketName}`
                }
              }
            ]
          }
        }
      },
      storageConfiguration: {
        type: 'OPENSEARCH_SERVERLESS',
        opensearchServerlessConfiguration: {
          collectionArn: props.opensearchCollection.attrArn,
          fieldMapping: {
            vectorField: 'docs-field',
            textField: 'docs-chunk',
            metadataField: 'docs-metadata'
          },
          vectorIndexName: 'docs-index'
        }
      },
      roleArn: bedrockKnowledgeBaseRole.roleArn
    });
    
    // Add explicit dependencies to ensure resources are created in the correct order
    knowledgeBase.node.addDependency(bedrockKnowledgeBaseRole);
    knowledgeBase.node.addDependency(props.opensearchCollection);
    knowledgeBase.node.addDependency(openSearchDelayResource); // Ensure we wait for OpenSearch to be ready

    knowledgeBase.node.addDependency(bedrockKnowledgeBaseRole);
    knowledgeBase.node.addDependency(props.opensearchCollection);
    // Create Bedrock Data Source using L1 construct
    const dataSource = new bedrock.CfnDataSource(this, 'BedrockDocsDataSource', {
      name: `docs-ds-${props.resourceSuffix}`,
      description: 'Data source for documents',
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: 'S3',
        s3Configuration: {
          bucketArn: props.organizedBucket.bucketArn,
          inclusionPrefixes: ['Documents/']
        }
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: 'HIERARCHICAL',
          hierarchicalChunkingConfiguration: {
            levelConfigurations: [
              { maxTokens: 1000 },
              { maxTokens: 300 }
            ],
            overlapTokens: 60
          }
        }
      }
    });

    // Use the actual Knowledge Base ID and ARN
    const knowledgeBaseId = knowledgeBase.attrKnowledgeBaseId;
    const knowledgeBaseArn = knowledgeBase.attrKnowledgeBaseArn;
    const dataSourceId = dataSource.attrDataSourceId;

    // Add Knowledge Base ID to Retrieval function
    this.retrievalFunction.addEnvironment('OPS_KNOWLEDGE_BASE_ID', knowledgeBaseId);

    return {
      knowledgeBase,
      dataSource,
      knowledgeBaseId,
      knowledgeBaseArn,
      dataSourceId
    };
  }
}
