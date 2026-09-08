#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GxDownloadsStack } from "../lib/gx-downloads-stack.js";
import { GxServerStack } from "../lib/gx-server-stack.js";

const app = new cdk.App();
const domainName = app.node.tryGetContext("domainName");

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
// 2026-09-08 for cost (snapshot gx-staging-pre-destroy-20260908).
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
});

new GxServerStack(app, "gx-server-production", {
  env,
  domainName,
  environmentName: "production",
  recordName: "api",
  // Cost cut 2026-09-08: single task (was 2).
  desiredCount: 1,
  maxCapacity: 6,
  rdsDeletionProtection: true,
  rdsBackupRetentionDays: 14,
});
