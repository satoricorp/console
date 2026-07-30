#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { TxDownloadsStack } from "../lib/tx-downloads-stack.js";
import { TxServerStack } from "../lib/tx-server-stack.js";

const app = new cdk.App();
const domainName = app.node.tryGetContext("domainName");

if (!domainName || typeof domainName !== "string") {
  throw new Error("Pass -c domainName=<domain> when running cdk");
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: "us-east-1",
};

new TxDownloadsStack(app, "gx-downloads", {
  env,
  domainName,
});

new TxServerStack(app, "gx-server-staging", {
  env,
  domainName,
  environmentName: "staging",
  recordName: "staging",
  desiredCount: 1,
  maxCapacity: 2,
  rdsDeletionProtection: false,
  rdsBackupRetentionDays: 3,
});

new TxServerStack(app, "gx-server-production", {
  env,
  domainName,
  environmentName: "production",
  recordName: "api",
  desiredCount: 2,
  maxCapacity: 6,
  rdsDeletionProtection: true,
  rdsBackupRetentionDays: 14,
});
