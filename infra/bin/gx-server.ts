#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GxDownloadsStack } from "../lib/gx-downloads-stack.js";
import { GxServerStack } from "../lib/gx-server-stack.js";

const app = new cdk.App();
const domainName = app.node.tryGetContext("domainName");
const certificateArn = app.node.tryGetContext("certificateArn");
const extraCertificateArn =
  typeof certificateArn === "string" && certificateArn.trim() !== ""
    ? certificateArn.trim()
    : undefined;

if (!domainName || typeof domainName !== "string") {
  throw new Error("Pass -c domainName=<domain> when running cdk");
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};

new GxDownloadsStack(app, "gx-downloads", {
  env,
  domainName,
});

// Staging stack definition kept so it can be re-created with
// `cdk deploy gx-server-staging -c domainName=...`. Live staging was destroyed
// 2026-09-08 for cost; snapshot gx-staging-pre-destroy-20260908 deleted 2026-09-11.
// ApplicationLoadBalancedFargateService requires desiredCount > 0.
new GxServerStack(app, "gx-server-staging", {
  env,
  domainName,
  environmentName: "staging",
  recordName: "staging",
  desiredCount: 1,
  maxCapacity: 2,
  rdsDeletionProtection: false,
  rdsBackupRetentionDays: 3,
  extraCertificateArn,
});

new GxServerStack(app, "gx-server-production", {
  env,
  domainName,
  environmentName: "production",
  recordName: "api",
  // Cost cut 2026-09-08: single task (was 2).
  // Hibernated 2026-09-11 CDT out-of-band: ECS desired set to 0 (construct cannot be 0),
  // NAT deleted live. Prod RDS DELETED 2026-09-11 (SkipFinalSnapshot + delete
  // automated backups); data retained only in snapshot gx-prod-pre-hibernate-20260911.
  // Keep Database construct for restore-shaped unpark. A naive `cdk deploy` would
  // create an EMPTY new database (CFN drift) — restore from that snapshot first
  // (same identifier if possible), THEN cdk deploy to recreate NAT / ECS desired 1.
  // Keep desiredCount: 1 here — do not set 0.
  desiredCount: 1,
  maxCapacity: 6,
  rdsDeletionProtection: true,
  rdsBackupRetentionDays: 14,
  extraCertificateArn,
});
