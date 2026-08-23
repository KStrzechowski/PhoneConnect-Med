#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();
new InfraStack(app, 'PhoneConnect-Med-InfraStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-central-1' },
  tags: { Project: 'PhoneConnect-Med' },
});
cdk.Tags.of(app).add('Project', 'PhoneConnect-Med');
