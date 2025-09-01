#!/usr/bin/env node
import 'source-map-support/register';
import { App, Tags } from 'aws-cdk-lib';
import { LfmtInfrastructureStack } from './lfmt-infrastructure-stack';

const app = new App();

// Environment configuration
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

// Get environment from context or default to 'dev'
const envName = app.node.tryGetContext('environment') || 'dev';

// Stack configuration
const stackConfig = {
  dev: {
    stackName: 'LfmtPocDev',
    description: 'LFMT POC Development Environment',
    enableLogging: true,
    retainData: false,
  },
  staging: {
    stackName: 'LfmtPocStaging', 
    description: 'LFMT POC Staging Environment',
    enableLogging: true,
    retainData: true,
  },
  prod: {
    stackName: 'LfmtPocProd',
    description: 'LFMT POC Production Environment',
    enableLogging: true,
    retainData: true,
  }
};

const config = stackConfig[envName as keyof typeof stackConfig] || stackConfig.dev;

// Create the main infrastructure stack
const infrastructureStack = new LfmtInfrastructureStack(app, config.stackName, {
  env,
  description: config.description,
  stackName: config.stackName,
  environment: envName,
  enableLogging: config.enableLogging,
  retainData: config.retainData,
});

// Add common tags
Tags.of(app).add('Project', 'LFMT-POC');
Tags.of(app).add('Environment', envName);
Tags.of(app).add('Owner', 'LFMT-Team');
Tags.of(app).add('CostCenter', 'Engineering');

// Output stack information
console.log(`🚀 Deploying LFMT Infrastructure:`);
console.log(`   Environment: ${envName}`);
console.log(`   Stack Name: ${config.stackName}`);
console.log(`   Region: ${env.region}`);
console.log(`   Account: ${env.account}`);

app.synth();