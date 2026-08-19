#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfoliniaStack } from '../lib/infolinia-stack';

const app = new cdk.App();

new InfoliniaStack(app, 'InfoliniaStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-central-1',
  },
  description: 'Inteligentna infolinia medyczna - Amazon Connect + Lex V2 PoC',
});
