import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Duration } from 'aws-cdk-lib';

export interface MonitoringDashboardsProps {
  stackName: string;
  environment: string;

  // Resources to monitor
  api: apigateway.RestApi;
  lambdaFunctions: lambda.Function[];
  jobsTable: dynamodb.Table;
  usersTable: dynamodb.Table;
  attestationsTable: dynamodb.Table;
  rateLimitBucketsTable: dynamodb.Table;
  documentBucket: s3.Bucket;
  resultsBucket: s3.Bucket;
  frontendBucket: s3.Bucket;
  translationStateMachine: stepfunctions.StateMachine;
}

/**
 * Monitoring Dashboards Construct
 *
 * Creates comprehensive CloudWatch dashboards for all infrastructure components:
 * - API Gateway metrics (requests, errors, latency)
 * - Lambda metrics (invocations, errors, duration, throttles, concurrency)
 * - DynamoDB metrics (consumed capacity, throttled requests)
 * - S3 metrics (bucket size, requests, errors)
 * - Step Functions metrics (executions, success/failure rate, duration)
 * - Overview dashboard (combined key metrics)
 */
export class MonitoringDashboards extends Construct {
  public readonly apiDashboard: cloudwatch.Dashboard;
  public readonly lambdaDashboard: cloudwatch.Dashboard;
  public readonly dynamoDbDashboard: cloudwatch.Dashboard;
  public readonly s3Dashboard: cloudwatch.Dashboard;
  public readonly stepFunctionsDashboard: cloudwatch.Dashboard;
  public readonly overviewDashboard: cloudwatch.Dashboard;

  constructor(scope: Construct, id: string, props: MonitoringDashboardsProps) {
    super(scope, id);

    const { stackName, environment, api, lambdaFunctions, jobsTable, usersTable,
            attestationsTable, rateLimitBucketsTable, documentBucket, resultsBucket,
            frontendBucket, translationStateMachine } = props;

    // 1. API Gateway Dashboard
    this.apiDashboard = this.createApiGatewayDashboard(stackName, api);

    // 2. Lambda Dashboard
    this.lambdaDashboard = this.createLambdaDashboard(stackName, lambdaFunctions);

    // 3. DynamoDB Dashboard
    this.dynamoDbDashboard = this.createDynamoDbDashboard(stackName, {
      jobsTable,
      usersTable,
      attestationsTable,
      rateLimitBucketsTable,
    });

    // 4. S3 Dashboard
    this.s3Dashboard = this.createS3Dashboard(stackName, {
      documentBucket,
      resultsBucket,
      frontendBucket,
    });

    // 5. Step Functions Dashboard
    this.stepFunctionsDashboard = this.createStepFunctionsDashboard(stackName, translationStateMachine);

    // 6. Overview Dashboard (combined key metrics)
    this.overviewDashboard = this.createOverviewDashboard(stackName, {
      api,
      lambdaFunctions,
      jobsTable,
      translationStateMachine,
    });
  }

  private createApiGatewayDashboard(stackName: string, api: apigateway.RestApi): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'ApiGatewayDashboard', {
      dashboardName: `${stackName}-api-gateway`,
    });

    // Request count metric
    const requestCount = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // 4xx errors
    const clientErrors = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '4XXError',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // 5xx errors
    const serverErrors = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Latency (p50, p90, p99)
    const latencyP50 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'p50',
      period: Duration.minutes(5),
    });

    const latencyP90 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'p90',
      period: Duration.minutes(5),
    });

    const latencyP99 = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Latency',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'p99',
      period: Duration.minutes(5),
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'API Gateway Request Count',
        left: [requestCount],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Errors',
        left: [clientErrors, serverErrors],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API Gateway Latency (p50, p90, p99)',
        left: [latencyP50, latencyP90, latencyP99],
        width: 24,
        height: 6,
      })
    );

    return dashboard;
  }

  private createLambdaDashboard(stackName: string, lambdaFunctions: lambda.Function[]): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'LambdaDashboard', {
      dashboardName: `${stackName}-lambda`,
    });

    // Create metrics for each Lambda function
    lambdaFunctions.forEach((fn, index) => {
      const invocations = fn.metricInvocations({
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      const errors = fn.metricErrors({
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      const duration = fn.metricDuration({
        statistic: 'Average',
        period: Duration.minutes(5),
      });

      const throttles = fn.metricThrottles({
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // Concurrent executions metric (manual creation)
      const concurrentExecutions = new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'ConcurrentExecutions',
        dimensionsMap: {
          FunctionName: fn.functionName,
        },
        statistic: 'Maximum',
        period: Duration.minutes(5),
      });

      // Add 2 widgets per function (invocations+errors in first row, duration+throttles+concurrency in second row)
      if (index % 2 === 0) {
        dashboard.addWidgets(
          new cloudwatch.GraphWidget({
            title: `${fn.functionName} - Invocations & Errors`,
            left: [invocations],
            right: [errors],
            width: 12,
            height: 6,
          }),
          new cloudwatch.GraphWidget({
            title: `${fn.functionName} - Duration, Throttles & Concurrency`,
            left: [duration],
            right: [throttles, concurrentExecutions],
            width: 12,
            height: 6,
          })
        );
      } else {
        // Continue adding to the same row
        dashboard.addWidgets(
          new cloudwatch.GraphWidget({
            title: `${fn.functionName} - Invocations & Errors`,
            left: [invocations],
            right: [errors],
            width: 12,
            height: 6,
          }),
          new cloudwatch.GraphWidget({
            title: `${fn.functionName} - Duration, Throttles & Concurrency`,
            left: [duration],
            right: [throttles, concurrentExecutions],
            width: 12,
            height: 6,
          })
        );
      }
    });

    return dashboard;
  }

  private createDynamoDbDashboard(
    stackName: string,
    tables: {
      jobsTable: dynamodb.Table;
      usersTable: dynamodb.Table;
      attestationsTable: dynamodb.Table;
      rateLimitBucketsTable: dynamodb.Table;
    }
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'DynamoDbDashboard', {
      dashboardName: `${stackName}-dynamodb`,
    });

    const allTables = [
      tables.jobsTable,
      tables.usersTable,
      tables.attestationsTable,
      tables.rateLimitBucketsTable,
    ];

    allTables.forEach((table) => {
      // Consumed read capacity
      const consumedReadCapacity = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedReadCapacityUnits',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // Consumed write capacity
      const consumedWriteCapacity = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ConsumedWriteCapacityUnits',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // Throttled read requests
      const throttledReads = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ReadThrottleEvents',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // Throttled write requests
      const throttledWrites = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'WriteThrottleEvents',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${table.tableName} - Consumed Capacity`,
          left: [consumedReadCapacity, consumedWriteCapacity],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `${table.tableName} - Throttled Requests`,
          left: [throttledReads, throttledWrites],
          width: 12,
          height: 6,
        })
      );
    });

    return dashboard;
  }

  private createS3Dashboard(
    stackName: string,
    buckets: {
      documentBucket: s3.Bucket;
      resultsBucket: s3.Bucket;
      frontendBucket: s3.Bucket;
    }
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'S3Dashboard', {
      dashboardName: `${stackName}-s3`,
    });

    const allBuckets = [
      buckets.documentBucket,
      buckets.resultsBucket,
      buckets.frontendBucket,
    ];

    allBuckets.forEach((bucket) => {
      // Bucket size
      const bucketSize = new cloudwatch.Metric({
        namespace: 'AWS/S3',
        metricName: 'BucketSizeBytes',
        dimensionsMap: {
          BucketName: bucket.bucketName,
          StorageType: 'StandardStorage',
        },
        statistic: 'Average',
        period: Duration.days(1),
      });

      // Number of objects
      const numberOfObjects = new cloudwatch.Metric({
        namespace: 'AWS/S3',
        metricName: 'NumberOfObjects',
        dimensionsMap: {
          BucketName: bucket.bucketName,
          StorageType: 'AllStorageTypes',
        },
        statistic: 'Average',
        period: Duration.days(1),
      });

      // All requests
      const allRequests = new cloudwatch.Metric({
        namespace: 'AWS/S3',
        metricName: 'AllRequests',
        dimensionsMap: {
          BucketName: bucket.bucketName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // 4xx errors
      const clientErrors = new cloudwatch.Metric({
        namespace: 'AWS/S3',
        metricName: '4xxErrors',
        dimensionsMap: {
          BucketName: bucket.bucketName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      // 5xx errors
      const serverErrors = new cloudwatch.Metric({
        namespace: 'AWS/S3',
        metricName: '5xxErrors',
        dimensionsMap: {
          BucketName: bucket.bucketName,
        },
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

      dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: `${bucket.bucketName} - Size & Objects`,
          left: [bucketSize],
          right: [numberOfObjects],
          width: 12,
          height: 6,
        }),
        new cloudwatch.GraphWidget({
          title: `${bucket.bucketName} - Requests & Errors`,
          left: [allRequests],
          right: [clientErrors, serverErrors],
          width: 12,
          height: 6,
        })
      );
    });

    return dashboard;
  }

  private createStepFunctionsDashboard(
    stackName: string,
    stateMachine: stepfunctions.StateMachine
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'StepFunctionsDashboard', {
      dashboardName: `${stackName}-step-functions`,
    });

    // Execution count
    const executionsStarted = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsStarted',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Succeeded executions
    const executionsSucceeded = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsSucceeded',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Failed executions
    const executionsFailed = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsFailed',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Timed out executions
    const executionsTimedOut = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsTimedOut',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Execution duration
    const executionTime = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionTime',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Average',
      period: Duration.minutes(5),
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Step Functions - Execution Count',
        left: [executionsStarted],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Step Functions - Success vs Failure',
        left: [executionsSucceeded, executionsFailed, executionsTimedOut],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Step Functions - Execution Duration',
        left: [executionTime],
        width: 24,
        height: 6,
      })
    );

    return dashboard;
  }

  private createOverviewDashboard(
    stackName: string,
    resources: {
      api: apigateway.RestApi;
      lambdaFunctions: lambda.Function[];
      jobsTable: dynamodb.Table;
      translationStateMachine: stepfunctions.StateMachine;
    }
  ): cloudwatch.Dashboard {
    const dashboard = new cloudwatch.Dashboard(this, 'OverviewDashboard', {
      dashboardName: `${stackName}-overview`,
    });

    // API Gateway metrics
    const apiRequests = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: {
        ApiName: resources.api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    const api5xxErrors = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: resources.api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Lambda aggregate metrics
    const totalLambdaInvocations = new cloudwatch.MathExpression({
      expression: resources.lambdaFunctions.map((_, i) => `m${i}`).join(' + '),
      usingMetrics: Object.fromEntries(
        resources.lambdaFunctions.map((fn, i) => [
          `m${i}`,
          fn.metricInvocations({ period: Duration.minutes(5) }),
        ])
      ),
      label: 'Total Lambda Invocations',
    });

    const totalLambdaErrors = new cloudwatch.MathExpression({
      expression: resources.lambdaFunctions.map((_, i) => `e${i}`).join(' + '),
      usingMetrics: Object.fromEntries(
        resources.lambdaFunctions.map((fn, i) => [
          `e${i}`,
          fn.metricErrors({ period: Duration.minutes(5) }),
        ])
      ),
      label: 'Total Lambda Errors',
    });

    // Step Functions metrics
    const sfExecutionsStarted = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsStarted',
      dimensionsMap: {
        StateMachineArn: resources.translationStateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    const sfExecutionsFailed = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsFailed',
      dimensionsMap: {
        StateMachineArn: resources.translationStateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Overall System Health',
        left: [apiRequests, totalLambdaInvocations, sfExecutionsStarted],
        width: 24,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Overall System Errors',
        left: [api5xxErrors, totalLambdaErrors, sfExecutionsFailed],
        width: 24,
        height: 6,
      })
    );

    return dashboard;
  }
}
