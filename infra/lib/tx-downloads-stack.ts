import * as cdk from "aws-cdk-lib";
import { Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as targets from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

type TxDownloadsStackProps = StackProps & {
  domainName: string;
};

export class TxDownloadsStack extends Stack {
  constructor(scope: Construct, id: string, props: TxDownloadsStackProps) {
    super(scope, id, props);

    if (props.env?.region && props.env.region !== "us-east-1") {
      throw new Error(
        "Deploy gx-downloads in us-east-1 because CloudFront ACM certificates must be issued there.",
      );
    }

    const zone = route53.HostedZone.fromLookup(this, "HostedZone", {
      domainName: props.domainName,
    });
    const hostName = `download.${props.domainName}`;

    const bucket = new s3.Bucket(this, "DownloadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });

    const certificate = new acm.Certificate(this, "Certificate", {
      domainName: hostName,
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      certificate,
      comment: `TX downloads for ${hostName}`,
      defaultBehavior: {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: "GX-macOS.zip",
      domainNames: [hostName],
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 404,
          responsePagePath: "/404.txt",
          ttl: Duration.minutes(5),
        },
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    new route53.ARecord(this, "DownloadAliasRecord", {
      recordName: "download",
      zone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.AaaaRecord(this, "DownloadAliasIpv6Record", {
      recordName: "download",
      zone,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });

    new cdk.CfnOutput(this, "DownloadBucketName", {
      value: bucket.bucketName,
    });
    new cdk.CfnOutput(this, "DownloadDistributionId", {
      value: distribution.distributionId,
    });
    new cdk.CfnOutput(this, "DownloadUrl", {
      value: `https://${hostName}/TX-macOS.zip`,
    });
  }
}
