import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as opensearchserverless from 'aws-cdk-lib/aws-opensearchserverless';
import { WAF_TAGS } from './constants';

/**
 * Props for the OpenSearchStack
 */
export interface OpenSearchStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names
   */
  resourceSuffix: string;

  /**
   * Organized bucket for storing processed data
   */
  organizedBucket: s3.Bucket;
}

/**
 * OpenSearch Stack for multimedia-rag application
 * 
 * This stack provisions the OpenSearch Serverless resources:
 * - OpenSearch Serverless Collection for vector storage
 * - Security Policies: encryption, network, data access
 * - Custom resource for index creation
 */
export class OpenSearchStack extends cdk.NestedStack {
  /**
   * OpenSearch Serverless Collection
   */
  public readonly collection: opensearchserverless.CfnCollection;

  /**
   * OpenSearch Collection Endpoint for accessing the OpenSearch API
   */
  public readonly collectionEndpoint: string;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props);

    // Add Well-Architected Framework tags to stack
    Object.entries(WAF_TAGS).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
    
    // Add environment tag
    cdk.Tags.of(this).add('Environment', props.resourceSuffix);

    // Create encryption policy for OpenSearch collection
    // Use shorter names to avoid AWS validation errors (max 32 chars)
    const encryptionPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchEncryptionPolicy', {
      name: `kb-encrypt-${props.resourceSuffix}`,
      type: 'encryption',
      description: 'Encryption policy for Knowledge Base collection',
      policy: JSON.stringify({
        Rules: [
          {
            ResourceType: 'collection',
            Resource: [`collection/kb-coll-${props.resourceSuffix}`]
          }
        ],
        AWSOwnedKey: true
      })
    });

    // Create OpenSearch Serverless Collection
    this.collection = new opensearchserverless.CfnCollection(this, 'OpenSearchCollection', {
      name: `kb-coll-${props.resourceSuffix}`,
      description: 'Collection for Amazon Bedrock Knowledge Base',
      type: 'VECTORSEARCH',
      standbyReplicas: 'DISABLED'
    });
    
    // Ensure the encryption policy is created first
    this.collection.addDependency(encryptionPolicy);

    // Store collection endpoint for later use
    this.collectionEndpoint = cdk.Fn.select(1, cdk.Fn.split('https://', this.collection.attrCollectionEndpoint));
    
    // Create index creation function role
    const openSearchIndexFunctionRole = new iam.Role(this, 'OpenSearchIndexFunctionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ],
      inlinePolicies: {
        OpenSearchAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'aoss:CreateIndex',
                'aoss:DeleteIndex',
                'aoss:UpdateIndex',
                'aoss:DescribeIndex',
                'aoss:ListIndices',
                'aoss:BatchGetIndex',
                'aoss:SearchIndex',
                'aoss:BatchGetDocument',
                'aoss:CreateDocument',
                'aoss:DeleteDocument',
                'aoss:UpdateDocument',
                'aoss:APIAccessAll'
              ],
              resources: [
                this.collection.attrArn,
                `arn:aws:aoss:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:collection/kb-coll-${props.resourceSuffix}`
              ]
            })
          ]
        })
      }
    });

    // Create Lambda function to create OpenSearch indexes
    const indexCreatorFunction = new lambda.Function(this, 'OpenSearchIndexFunction', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import cfnresponse
import time
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth
import re

def get_aws_auth(region):
    credentials = boto3.Session().get_credentials()
    return AWS4Auth(
        credentials.access_key,
        credentials.secret_key,
        region,
        'aoss',
        session_token=credentials.token
    )

def clean_endpoint(endpoint):
    # Remove 'https://' if present
    if endpoint.startswith('https://'):
        endpoint = endpoint[8:]
    # Remove any square brackets
    endpoint = endpoint.replace('[', '').replace(']', '')
    return endpoint

def create_index(host, index_name, region, client):
    
    index_body = {
        "settings": {
            "index": {
                "knn": True,
                "knn.algo_param.ef_search": 512
            }
        },
        "mappings": {
            "properties": {
                "transcripts-field": {
                    "type": "knn_vector",
                    "dimension": 1024,
                    "method": {
                        "engine": "faiss",
                        "name": "hnsw",
                        "space_type": "l2"
                    }
                },
                "docs-field": {
                    "type": "knn_vector",
                    "dimension": 1024,
                    "method": {
                        "engine": "faiss",
                        "name": "hnsw",
                        "space_type": "l2"
                    }
                },
                "transcripts-chunk": {
                    "type": "text"
                },
                "docs-chunk": {
                    "type": "text"
                },
                "transcripts-metadata": {
                    "type": "text",
                    "index": False
                },
                "docs-metadata": {
                    "type": "text",
                    "index": False
                }
            }
        }
    }

    try:
        print(f"Creating index {index_name} on host")
        response = client.indices.create(index=index_name, body=index_body)
        print(f"Index {index_name} created successfully")
        time.sleep(30)  # Wait for index to be fully created
        return True
    except Exception as e:
        print(f"Error creating index {index_name}: {str(e)}")
        return False

def handler(event, context):
    try:
        if event['RequestType'] in ['Create', 'Update']:
            collection_endpoint = event['ResourceProperties']['CollectionEndpoint']
            region = event['ResourceProperties']['Region']
            access_policy = event['ResourceProperties']['AccessPolicy']
            
            print(f"Collection endpoint: {collection_endpoint}")
            
            # Wait for access policy to be ready
            time.sleep(30)

            #Create OS client
            clean_host = clean_endpoint(collection_endpoint)
            
            client = OpenSearch(
                hosts=[{'host': clean_host, 'port': 443}],
                http_auth=get_aws_auth(region),
                use_ssl=True,
                verify_certs=True,
                connection_class=RequestsHttpConnection,
                timeout=300
            )
            # Create indices with retry logic
            success_docs = False
            max_retries = 3
            retry_delay = 10

            retries = 0
            while retries < max_retries and not success_docs:
                try:
                    success_docs = create_index(collection_endpoint, 'docs-index', region, client)
                    if not success_docs:
                        print("Failed to create docs-index")
                except Exception as e:
                    print(f"Attempt {retries + 1} for docs-index failed: {str(e)}")
                    retries += 1
                    if retries < max_retries:
                        time.sleep(retry_delay)

            if success_docs:
                cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
            else:
                cfnresponse.send(event, context, cfnresponse.FAILED, {})
        else:
            cfnresponse.send(event, context, cfnresponse.SUCCESS, {})
    except Exception as e:
        print(f"Error: {str(e)}")
        cfnresponse.send(event, context, cfnresponse.FAILED, {})
      `),
      role: openSearchIndexFunctionRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 512,
      layers: [
        this.createDependencyLayer()
      ]
    });

    // Create access policy for OpenSearch collection
    const accessPolicy = new opensearchserverless.CfnAccessPolicy(this, 'OpenSearchAccessPolicy', {
      name: `kb-access-${props.resourceSuffix}`,
      type: 'data',
      description: 'Access policy for Knowledge Base collection',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/kb-coll-${props.resourceSuffix}`],
              Permission: [
                'aoss:*'
              ]
            },
            {
              ResourceType: 'index',
              Resource: [`index/kb-coll-${props.resourceSuffix}/*`],
              Permission: [
                'aoss:*'
              ]
            }
          ],
          Principal: [
            `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/${openSearchIndexFunctionRole.roleName}`,
            // Add Bedrock Knowledge Base role
            `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/kb-role-${props.resourceSuffix}`
          ]
        }
      ])
    });
    
    // Ensure the collection is created first
    accessPolicy.addDependency(this.collection);

    // Create network policy for OpenSearch collection
    const networkPolicy = new opensearchserverless.CfnSecurityPolicy(this, 'OpenSearchNetworkPolicy', {
      name: `kb-network-${props.resourceSuffix}`,
      type: 'network',
      description: 'Network policy for Knowledge Base collection',
      policy: JSON.stringify([
        {
          Rules: [
            {
              ResourceType: 'collection',
              Resource: [`collection/kb-coll-${props.resourceSuffix}`]
            },
            {
              ResourceType: 'dashboard',
              Resource: [`collection/kb-coll-${props.resourceSuffix}`]
            }
          ],
          AllowFromPublic: true
        }
      ])
    });
    
    // Ensure the collection is created first
    networkPolicy.addDependency(this.collection);

    // Create OpenSearch indexes using a Custom Resource
    const createIndexesProvider = new cr.Provider(this, 'CreateIndexesProvider', {
      onEventHandler: indexCreatorFunction,
    });

    const createIndexes = new cdk.CustomResource(this, 'CreateOpenSearchIndexes', {
      serviceToken: createIndexesProvider.serviceToken,
      properties: {
        CollectionEndpoint: this.collection.attrCollectionEndpoint,
        Region: cdk.Aws.REGION,
        AccessPolicy: accessPolicy.ref
      }
    });
    
    // Ensure the access policy is created first
    createIndexes.node.addDependency(accessPolicy);

    // Output the OpenSearch collection ARN and endpoint
    new cdk.CfnOutput(this, 'OpenSearchCollectionArn', {
      value: this.collection.attrArn,
      description: 'OpenSearch Serverless Collection ARN',
      exportName: `${id}-OpenSearchCollectionArn`
    });

    new cdk.CfnOutput(this, 'OpenSearchCollectionEndpoint', {
      value: this.collection.attrCollectionEndpoint,
      description: 'OpenSearch Serverless Collection Endpoint',
      exportName: `${id}-OpenSearchCollectionEndpoint`
    });
  }

  /**
   * Create a Lambda layer with required dependencies
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
                actions: [
                  's3:PutObject'
                ],
                resources: [
                  layerBucket.arnForObjects('*')
                ]
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
      properties: {
        Bucket: layerBucket.bucketName
      }
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
}
