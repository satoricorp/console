#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { GxServerStack } from "../lib/gx-server-stack.js";

const app = new cdk.App();
const domainName = app.node.tryGetContext("domainName");

if (!domainName || typeof domainName !== "string") {
  throw new Error("Pass -c domainName=<domain> when running cdk");
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
};

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
  desiredCount: 2,
  maxCapacity: 6,
  rdsDeletionProtection: true,
  rdsBackupRetentionDays: 14,
});
