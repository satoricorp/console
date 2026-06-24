import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

type GxServerStackProps = StackProps & {
  domainName: string;
  environmentName: "staging" | "production";
  recordName: "staging" | "api";
  desiredCount: number;
  maxCapacity: number;
  rdsDeletionProtection: boolean;
  rdsBackupRetentionDays: number;
};

const containerName = "gx-server";
const containerPort = 3201;
const bedrockModelId = "anthropic.claude-sonnet-4-6";
const bedrockInferenceProfileId = "us.anthropic.claude-sonnet-4-6";

export class GxServerStack extends Stack {
  constructor(scope: Construct, id: string, props: GxServerStackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });
    const hostName = `${props.recordName}.${props.domainName}`;

    const repositoryName = `gx-server-${props.environmentName}`;
    const repository = ecr.Repository.fromRepositoryName(
      this,
      "Repository",
      repositoryName,
    );

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: props.environmentName === "production" ? 2 : 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const database = new rds.DatabaseInstance(this, "Database", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      credentials: rds.Credentials.fromGeneratedSecret("gx"),
      databaseName: "gx",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        props.environmentName === "production"
          ? ec2.InstanceSize.SMALL
          : ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: props.environmentName === "production" ? 100 : 20,
      maxAllocatedStorage: props.environmentName === "production" ? 500 : 100,
      backupRetention: Duration.days(props.rdsBackupRetentionDays),
      deletionProtection: props.rdsDeletionProtection,
      multiAz: props.environmentName === "production",
      publiclyAccessible: false,
      storageEncrypted: true,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      removalPolicy:
        props.environmentName === "production"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });

    const appSecret = new secretsmanager.Secret(this, "AppSecret", {
      secretName: `/gx/${props.environmentName}/server`,
      description: `GX ${props.environmentName} server app secrets`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          GX_CLOUD_API_KEY: "replace-me",
          CONVEX_SITE_URL: "replace-me",
          GX_EMBEDDING_OPENAI_API_KEY: "replace-me",
          GITHUB_APP_ID: "replace-me",
          GITHUB_APP_PRIVATE_KEY: "replace-me",
          GITHUB_WEBHOOK_SECRET: "replace-me",
          TURBOPUFFER_API_KEY: "replace-me",
        }),
        generateStringKey: "_generated",
        excludePunctuation: true,
      },
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: `gx-server-${props.environmentName}`,
      vpc,
      containerInsights: true,
    });

    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/ecs/gx-server-${props.environmentName}`,
      retention:
        props.environmentName === "production"
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_WEEK,
      removalPolicy:
        props.environmentName === "production"
          ? RemovalPolicy.RETAIN
          : RemovalPolicy.DESTROY,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: hostName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const service =
      new ecsPatterns.ApplicationLoadBalancedFargateService(this, "Service", {
        cluster,
        serviceName: `gx-server-${props.environmentName}`,
        publicLoadBalancer: true,
        cpu: props.environmentName === "production" ? 1024 : 512,
        memoryLimitMiB: props.environmentName === "production" ? 2048 : 1024,
        desiredCount: props.desiredCount,
        assignPublicIp: false,
        taskSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        circuitBreaker: {
          rollback: true,
        },
        redirectHTTP: true,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificate,
        domainName: hostName,
        domainZone: zone,
        taskImageOptions: {
          containerName,
          containerPort,
          image: ecs.ContainerImage.fromEcrRepository(
            repository,
            props.environmentName,
          ),
          environment: {
            AWS_REGION: Stack.of(this).region,
            NODE_ENV: "production",
            PGDATABASE: "gx",
            PGSSLMODE: "require",
            PORT: String(containerPort),
          },
          secrets: {
            PGHOST: ecs.Secret.fromSecretsManager(database.secret!, "host"),
            PGPORT: ecs.Secret.fromSecretsManager(database.secret!, "port"),
            PGUSER: ecs.Secret.fromSecretsManager(database.secret!, "username"),
            PGPASSWORD: ecs.Secret.fromSecretsManager(database.secret!, "password"),
            GX_CLOUD_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "GX_CLOUD_API_KEY",
            ),
            CONVEX_SITE_URL: ecs.Secret.fromSecretsManager(
              appSecret,
              "CONVEX_SITE_URL",
            ),
            GX_EMBEDDING_OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "GX_EMBEDDING_OPENAI_API_KEY",
            ),
            GITHUB_APP_ID: ecs.Secret.fromSecretsManager(
              appSecret,
              "GITHUB_APP_ID",
            ),
            GITHUB_APP_PRIVATE_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "GITHUB_APP_PRIVATE_KEY",
            ),
            GITHUB_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(
              appSecret,
              "GITHUB_WEBHOOK_SECRET",
            ),
            TURBOPUFFER_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "TURBOPUFFER_API_KEY",
            ),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: containerName,
            logGroup,
          }),
        },
      });

    service.targetGroup.configureHealthCheck({
      path: "/health",
      healthyHttpCodes: "200",
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
    });

    database.connections.allowDefaultPortFrom(service.service);
    database.secret?.grantRead(service.taskDefinition.executionRole!);
    appSecret.grantRead(service.taskDefinition.executionRole!);

    service.taskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:${Stack.of(this).partition}:bedrock:*::foundation-model/${bedrockModelId}`,
          `arn:${Stack.of(this).partition}:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:inference-profile/${bedrockInferenceProfileId}`,
          `arn:${Stack.of(this).partition}:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:application-inference-profile/*`,
        ],
      }),
    );

    service.service.autoScaleTaskCount({
      minCapacity: props.desiredCount,
      maxCapacity: props.maxCapacity,
    }).scaleOnCpuUtilization("CpuScaling", {
      targetUtilizationPercent: 60,
    });

    const privateSubnetIds = vpc.privateSubnets.map((subnet) => subnet.subnetId);
    const serviceSecurityGroupIds = service.service.connections.securityGroups.map(
      (securityGroup) => securityGroup.securityGroupId,
    );

    new cdk.CfnOutput(this, "Url", {
      value: `https://${hostName}`,
    });
    new cdk.CfnOutput(this, "RepositoryUri", {
      value: `${Stack.of(this).account}.dkr.ecr.${Stack.of(this).region}.${Stack.of(this).urlSuffix}/${repositoryName}`,
    });
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });
    new cdk.CfnOutput(this, "ServiceName", {
      value: service.service.serviceName,
    });
    new cdk.CfnOutput(this, "TaskDefinitionFamily", {
      value: service.taskDefinition.family,
    });
    new cdk.CfnOutput(this, "ContainerName", {
      value: containerName,
    });
    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: cdk.Fn.join(",", privateSubnetIds),
    });
    new cdk.CfnOutput(this, "ServiceSecurityGroupIds", {
      value: cdk.Fn.join(",", serviceSecurityGroupIds),
    });
    new cdk.CfnOutput(this, "AppSecretName", {
      value: appSecret.secretName,
    });
    new cdk.CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret!.secretArn,
    });
  }
}
