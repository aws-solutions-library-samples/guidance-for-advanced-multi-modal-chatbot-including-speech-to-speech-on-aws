import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Properties for the SpeechToSpeechStack
 */
export interface SpeechToSpeechStackProps extends cdk.NestedStackProps {
  /**
   * Suffix to append to resource names for uniqueness across deployments
   */
  resourceSuffix: string;
  
  /**
   * Cognito User Pool ID for authentication
   */
  userPoolId?: string;
  
  /**
   * Cognito User Pool Client ID for application authentication
   */
  userPoolClientId?: string;
  
  /**
   * Cognito Identity Pool ID for AWS resource access
   */
  identityPoolId?: string;
  
  /**
   * Bedrock Knowledge Base ID for RAG functionality
   */
  knowledgeBaseId?: string;
  
  /**
   * AWS Region where the Bedrock Knowledge Base is deployed
   */
  kbRegion?: string;
  
  /**
   * Model ARN to use for RAG operations
   */
  ragModelArn?: string;
  
  /**
   * Whether to enable RAG functionality
   */
  useRag?: boolean;
  
  /**
   * ECR Repository name for the container image
   * @default 'speech-to-speech-backend'
   */
  ecrRepositoryName?: string;
  
  /**
   * Memory limit for the Fargate task in MiB
   * @default 2048
   */
  memoryLimitMiB?: number;
  
  /**
   * CPU units for the Fargate task
   * @default 1024
   */
  cpuUnits?: number;
  
  /**
   * Whether to enable debug mode
   * @default false
   */
  debugMode?: boolean;
}

/**
 * Stack that deploys the Speech-to-Speech backend service.
 * This service provides real-time speech-to-speech conversation capabilities
 * through Amazon's Nova Sonic service.
 * 
 * NOTE: Currently, Amazon Nova Sonic service is only available in the us-east-1 region.
 * This stack should only be deployed in that region until the service becomes
 * available in additional regions.
 */
export class SpeechToSpeechStack extends cdk.NestedStack {
  /**
   * DNS name of the Network Load Balancer
   */
  public readonly nlbDnsName: string;
  constructor(scope: Construct, id: string, props: SpeechToSpeechStackProps) {
    super(scope, id, props);

    const resourceSuffix = props.resourceSuffix;
    const ecrRepositoryName = props.ecrRepositoryName || 'speech-to-speech-backend';

    // VPC for the Fargate service
    const vpc = new ec2.Vpc(this, `SpeechBackendVpc-${resourceSuffix}`, {
      maxAzs: 2,
      natGateways: 1
    });

    // Import existing ECR Repository
    const repository = ecr.Repository.fromRepositoryName(
      this,
      `SpeechBackendRepo-${resourceSuffix}`,
      ecrRepositoryName
    );

    // ECS Cluster
    const cluster = new ecs.Cluster(this, `SpeechBackendCluster-${resourceSuffix}`, {
      vpc,
      clusterName: `speech-to-speech-backend-${resourceSuffix}`
    });

    // Task execution role
    const executionRole = new iam.Role(this, `SpeechBackendTaskExecutionRole-${resourceSuffix}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    // Task role with Bedrock permissions
    const taskRole = new iam.Role(this, `SpeechBackendTaskRole-${resourceSuffix}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    
    // Add Bedrock permissions for bidirectional streaming
    // These permissions are required for the Nova Sonic speech-to-speech capabilities
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:InvokeModelWithBidirectionalStream',
        'bedrock:RetrieveAndGenerate',
        'bedrock:GetModelCustomizationJob',
        'bedrock:ListFoundationModels',
        'bedrock:ListModelCustomizationJobs',
        'bedrock:Retrieve'
      ],
      resources: [
        `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*`
      ]
    }));
    
    // Add Bedrock Agent Runtime permissions for knowledge base operations
    // This is needed for cross-region knowledge base access
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock-agent-runtime:Retrieve',
        'bedrock-agent-runtime:RetrieveAndGenerate'
      ],
      resources: [
        '*' // Keep wildcard for cross-region access
      ]
    }));
    
    // Add Cognito permissions for token validation
    // Specific resource ARNs if available
    const cognitoResources = ['*'];
    if (props.userPoolId) {
      cognitoResources.push(
        `arn:aws:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/${props.userPoolId}`
      );
    }
    
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:GetUser',
        'cognito-idp:DescribeUserPool',
        'cognito-idp:DescribeUserPoolClient'
      ],
      resources: cognitoResources
    }));
    
    // Add CloudWatch permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudwatch:PutMetricData'
      ],
      resources: ['*']
    }));

    // Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, `SpeechBackendTaskDef-${resourceSuffix}`, {
      memoryLimitMiB: props.memoryLimitMiB || 2048,
      cpu: props.cpuUnits || 1024,
      executionRole,
      taskRole
    });

    // Add container to task definition
    const container = taskDefinition.addContainer(`SpeechBackendContainer-${resourceSuffix}`, {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `speech-to-speech-backend-${resourceSuffix}` }),
      environment: {
        HOST: '0.0.0.0',
        WS_PORT: '8081',
        HEALTH_PORT: '8082',
        AWS_DEFAULT_REGION: 'us-east-1',  // Nova Sonic is only available in us-east-1 currently
        
        // Knowledge Base integration environment variables
        DOCUMENTS_KB_ID: props.knowledgeBaseId || '',
        KB_REGION: props.kbRegion || 'us-east-1',
        USE_RAG: props.useRag ? 'true' : 'false',
        RAG_MODEL_ARN: props.ragModelArn || 'anthropic.claude-3-haiku-20240307-v1:0',
        
        // Cognito configuration for authentication
        USER_POOL_ID: props.userPoolId || '',
        USER_POOL_CLIENT_ID: props.userPoolClientId || '',
        IDENTITY_POOL_ID: props.identityPoolId || '',
        
        // Debug configuration
        DEBUG: props.debugMode ? 'true' : 'false',
        LOGLEVEL: props.debugMode ? 'DEBUG' : 'INFO'
      },
      portMappings: [
        { containerPort: 8081 },  // Main WebSocket port
        { containerPort: 8082 }   // Health check port
      ]
    });

    // Create a security group for the service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, `SpeechBackendServiceSG-${resourceSuffix}`, {
      vpc,
      description: 'Security group for Speech-to-Speech Backend service',
      allowAllOutbound: true
    });

    // Allow inbound traffic on ports 8081 and 8082
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8081),
      'Allow inbound traffic on port 8081 for WebSocket connections'
    );
    
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(8082),
      'Allow inbound traffic on port 8082 for health checks'
    );

    // Fargate Service with simplified configuration and increased grace period
    const service = new ecs.FargateService(this, `SpeechBackendService-${resourceSuffix}`, {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [serviceSecurityGroup], // Explicitly assign our security group to the tasks
      minHealthyPercent: 0, // Allow the service to go to 0 tasks during deployment
      maxHealthyPercent: 200, // Allow 2 tasks to run during deployment
      healthCheckGracePeriod: cdk.Duration.seconds(600), // 10 minutes grace period
      deploymentController: {
        type: ecs.DeploymentControllerType.ECS // Use rolling deployment
      }
    });

    // Create Network Load Balancer
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, `SpeechBackendNLB-${resourceSuffix}`, {
      vpc,
      internetFacing: true,
      crossZoneEnabled: true
    });

    // Add listener and target group
    const listener = nlb.addListener(`SpeechBackendListener-${resourceSuffix}`, {
      port: 8081,
      protocol: cdk.aws_elasticloadbalancingv2.Protocol.TCP
    });

    // Add target group with HTTP health checks to the main port
    const targetGroup = listener.addTargets(`SpeechBackendTargets-${resourceSuffix}`, {
      port: 8081,  // Traffic goes to main port
      protocol: cdk.aws_elasticloadbalancingv2.Protocol.TCP,
      targets: [service],
      healthCheck: {
        enabled: true,  // Health checks must be enabled for IP-based targets
        port: '8082',   // Health checks use the dedicated health check port
        protocol: cdk.aws_elasticloadbalancingv2.Protocol.HTTP,  // Use HTTP protocol for health checks
        path: '/health',  // Use the health endpoint
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 10,  // Increased to allow more failures before marking unhealthy
        timeout: cdk.Duration.seconds(10),  // Increased timeout for HTTP health checks
        interval: cdk.Duration.seconds(30),  // Less frequent checks to reduce load
        healthyHttpCodes: '200'  // Expect HTTP 200 response
      }
    });
    
    // Set the NLB DNS name property
    this.nlbDnsName = nlb.loadBalancerDnsName;

    // Add CloudWatch dashboard for monitoring
    const dashboard = new cdk.aws_cloudwatch.Dashboard(this, `SpeechBackendDashboard-${resourceSuffix}`, {
      dashboardName: `SpeechToSpeech-Metrics-${resourceSuffix}`
    });
    
    // Add metrics to dashboard
    dashboard.addWidgets(
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'ECS Service CPU and Memory',
        left: [
          service.metricCpuUtilization(),
          service.metricMemoryUtilization()
        ],
        width: 12
      }),
      new cdk.aws_cloudwatch.GraphWidget({
        title: 'Network Load Balancer',
        left: [
          nlb.metrics.activeFlowCount(),
          nlb.metrics.processedBytes()
        ],
        width: 12
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'WebSocketURL', {
      value: `ws://${nlb.loadBalancerDnsName}:8081/ws/speech-to-speech`,
      description: 'WebSocket URL for Speech-to-Speech service',
      exportName: `SpeechToSpeech-WebSocketURL-${resourceSuffix}`
    });
    
    new cdk.CfnOutput(this, 'ECRRepositoryURI', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI for the Speech-to-Speech container image',
      exportName: `SpeechToSpeech-ECRRepositoryURI-${resourceSuffix}`
    });
  }
}
