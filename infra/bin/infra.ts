#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

const connectInstanceArn = process.env.CONNECT_INSTANCE_ARN;
if (connectInstanceArn && !app.node.tryGetContext('connectInstanceArn')) {
  app.node.setContext('connectInstanceArn', connectInstanceArn);
}

const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' };
new InfraStack(app, 'PhoneConnect-Med-InfraStack', {
  env,
  tags: { Project: 'PhoneConnect-Med' },
});
cdk.Tags.of(app).add('Project', 'PhoneConnect-Med');
