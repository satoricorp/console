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

/**
 * Every Bedrock model the task role may invoke: the server's own summary model
 * plus the three the /gx/bedrock/fight passthrough allows (two Opus reviewers
 * and the Sonnet judge). Keep in sync with BEDROCK_FIGHT_MODELS in
 * server/src/routes/bedrock.ts — an ID allowed by the route but missing here is
 * an AccessDeniedException in production and a green test suite locally.
 *
 * These are `us.` cross-region inference profiles. Invoking one needs BOTH the
 * profile ARN in this region and the underlying foundation model in every region
 * the profile can route to, hence the region-wildcard foundation-model ARN.
 */
export const bedrockInferenceProfileIds = [
  "us.anthropic.claude-sonnet-4-6",
  "us.anthropic.claude-opus-4-6-v1",
  "us.anthropic.claude-opus-4-5-20251101-v1:0",
  // The CLI's default first reviewer leg. Added after the drift this file's
  // comment warned about actually happened: the route allowed Haiku, this list
  // did not, and every default-configuration review failed in production while
  // every test passed locally.
  "us.anthropic.claude-haiku-4-5-20251001-v1:0",
];

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
      description: `gx ${props.environmentName} server app secrets`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          GX_CLOUD_API_KEY: "replace-me",
          CONVEX_SITE_URL: "replace-me",
          GITHUB_APP_ID: "replace-me",
          GITHUB_APP_PRIVATE_KEY: "replace-me",
          GITHUB_WEBHOOK_SECRET: "replace-me",
          GITHUB_CLIENT_ID: "replace-me",
          GITHUB_CLIENT_SECRET: "replace-me",
          OPENAI_API_KEY: "replace-me",
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
        /**
         * A review's judge call is a flagship model reading a large brief, and
         * every layer of that path is already sized for it: the CLI's cloud
         * client waits 5 minutes (cloud.defaultBedrockTimeout) and
         * /gx/bedrock/fight bounds its own Bedrock call at the same 300s
         * (defaultTimeoutMs). The load balancer in between was the one hop
         * nobody set, so it sat on the ELB default of 60 seconds and cut the
         * judge off mid-call — the client saw a 504 and an HTML error page
         * instead of a review, which reads like an outage rather than a
         * timeout.
         *
         * 330s is deliberately just above the 300s the client and the route
         * allow, not equal to it: whichever timer fires first decides the error
         * the user gets, and the application's own deadline produces a typed,
         * actionable failure while the balancer's produces opaque HTML. Kept
         * strictly greater so the ALB is never the one to answer.
         */
        idleTimeout: Duration.seconds(330),
        // Allows `aws ecs execute-command` shells and SSM port forwarding
        // to RDS through the task (scripts/rds.sh).
        enableExecuteCommand: true,
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
            GX_CONTEXT_BROKER: "1",
            ...(props.environmentName === "production"
              ? { GX_SITE_URL: "https://gx.run" }
              : {}),
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
            // OAuth client credentials for GitHub's check-token API, which is
            // how a raw GitHub bearer is shown to have been issued for gx
            // rather than for some other application. Without them no such
            // token verifies, and that auth path refuses everything.
            //
            // ECS will not start a task whose referenced secret JSON key is
            // absent, so both must exist in the secret before this deploys.
            GITHUB_CLIENT_ID: ecs.Secret.fromSecretsManager(
              appSecret,
              "GITHUB_CLIENT_ID",
            ),
            GITHUB_CLIENT_SECRET: ecs.Secret.fromSecretsManager(
              appSecret,
              "GITHUB_CLIENT_SECRET",
            ),
            OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "OPENAI_API_KEY",
            ),
            TURBOPUFFER_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "TURBOPUFFER_API_KEY",
            ),
            GX_POSTHOG_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "GX_POSTHOG_KEY",
            ),
            GX_POSTHOG_HOST: ecs.Secret.fromSecretsManager(
              appSecret,
              "GX_POSTHOG_HOST",
            ),
            // Same key as OPENAI_API_KEY: createLLMProvider prefers Bedrock
            // whenever AWS creds exist unless GX_OPENAI_API_KEY is set, and
            // Bedrock invokes currently fail in this account.
            GX_OPENAI_API_KEY: ecs.Secret.fromSecretsManager(
              appSecret,
              "OPENAI_API_KEY",
            ),
          },
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: containerName,
            logGroup,
          }),
        },
      });

    // Serve the gx.run hostnames (api.gx.run / staging.gx.run)
    // alongside the gx.run cert via SNI. gx.run DNS lives on Vercel, so
    // this cert was issued outside CDK and its CNAMEs are managed there too.
    const totalityCertificate = acm.Certificate.fromCertificateArn(
      this,
      "TotalityCertificate",
      "arn:aws:acm:us-east-1:088950452464:certificate/8d88c72c-5254-40c8-bdd9-994b1066fc16",
    );
    service.listener.addCertificates("TotalityCertificate", [
      totalityCertificate,
    ]);

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
          ...bedrockInferenceProfileIds.flatMap((profileId) => [
            `arn:${Stack.of(this).partition}:bedrock:*::foundation-model/${profileId.replace(/^us\./, "")}`,
            `arn:${Stack.of(this).partition}:bedrock:${Stack.of(this).region}:${Stack.of(this).account}:inference-profile/${profileId}`,
          ]),
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
