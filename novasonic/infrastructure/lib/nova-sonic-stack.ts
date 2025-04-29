import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Construct } from 'constructs';

export class NovaSonicStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC for the Fargate service
    const vpc = new ec2.Vpc(this, 'NovaSonicBackendVpc', {
      maxAzs: 2,
      natGateways: 1
    });

    // Import existing ECR Repository created by deploy.sh script
    const repository = ecr.Repository.fromRepositoryName(
      this,
      'NovaSonicBackendRepo',
      'nova-sonic-backend'
    );

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'NovaSonicBackendCluster', {
      vpc,
      clusterName: 'nova-sonic-backend'
    });

    // Task execution role
    const executionRole = new iam.Role(this, 'NovaSonicBackendTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    // Task role with Bedrock permissions
    const taskRole = new iam.Role(this, 'NovaSonicBackendTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });
    
    // Add Bedrock permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:InvokeModelWithBidirectionalStream'
      ],
      resources: ['*']
    }));
    
    // Add CloudWatch permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cloudwatch:PutMetricData'
      ],
      resources: ['*']
    }));

    // Fargate Task Definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'NovaSonicBackendTaskDef', {
      memoryLimitMiB: 2048,
      cpu: 1024,
      executionRole,
      taskRole
    });

    // Add container to task definition
    const container = taskDefinition.addContainer('NovaSonicBackendContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'nova-sonic-backend' }),
      environment: {
        HOST: '0.0.0.0',
        WS_PORT: '8081',
        HEALTH_PORT: '8082',
        AWS_DEFAULT_REGION: 'us-east-1'  // Explicitly set the region for AWS SDK
      },
      portMappings: [
        { containerPort: 8081 },  // Main WebSocket port
        { containerPort: 8082 }   // Health check port
      ]
    });

    // Create a security group for the service
    const serviceSecurityGroup = new ec2.SecurityGroup(this, 'NovaSonicBackendServiceSG', {
      vpc,
      description: 'Security group for Nova Sonic Backend service',
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
    const service = new ecs.FargateService(this, 'NovaSonicBackendService', {
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
      // Circuit breaker removed to prevent automatic rollbacks
    });

    // Create Network Load Balancer
    const nlb = new cdk.aws_elasticloadbalancingv2.NetworkLoadBalancer(this, 'NovaSonicBackendNLB', {
      vpc,
      internetFacing: true,
      crossZoneEnabled: true
    });

    // Add listener and target group
    const listener = nlb.addListener('NovaSonicBackendListener', {
      port: 8081,
      protocol: cdk.aws_elasticloadbalancingv2.Protocol.TCP
    });

    // Add target group with HTTP health checks to the main port
    const targetGroup = listener.addTargets('NovaSonicBackendTargets', {
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

    // Add CloudWatch dashboard for monitoring
    const dashboard = new cdk.aws_cloudwatch.Dashboard(this, 'NovaSonicBackendDashboard', {
      dashboardName: 'NovaSonicBackend-Metrics'
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
      value: `ws://${nlb.loadBalancerDnsName}:8081/ws/nova-sonic-backend`,
      description: 'WebSocket URL (use ws:// for unencrypted or wss:// for encrypted connections)'
    });
    
    new cdk.CfnOutput(this, 'ECRRepositoryURI', {
      value: repository.repositoryUri,
      description: 'ECR Repository URI'
    });
  }
}