import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sns_subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Duration } from 'aws-cdk-lib';

export interface MonitoringAlarmsProps {
  stackName: string;
  environment: string;
  operationsEmail: string;

  // Resources to monitor
  api: apigateway.RestApi;
  lambdaFunctions: lambda.Function[];
  jobsTable: dynamodb.Table;
  usersTable: dynamodb.Table;
  attestationsTable: dynamodb.Table;
  rateLimitBucketsTable: dynamodb.Table;
  translationStateMachine: stepfunctions.StateMachine;
}

/**
 * Monitoring Alarms Construct
 *
 * Creates CloudWatch alarms for critical infrastructure components:
 * - Lambda error rate alarms (>5% error rate)
 * - API Gateway 5xx alarm (>1% error rate)
 * - DynamoDB throttling alarms (>10 throttled requests)
 * - Step Functions failure alarms (>3 failures in 1 hour)
 *
 * All alarms publish to an SNS topic subscribed by operations email.
 */
export class MonitoringAlarms extends Construct {
  public readonly alarmTopic: sns.Topic;
  public readonly lambdaErrorAlarms: cloudwatch.Alarm[];
  public readonly apiGateway5xxAlarm: cloudwatch.Alarm;
  public readonly dynamoDbThrottlingAlarms: cloudwatch.Alarm[];
  public readonly stepFunctionsFailureAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: MonitoringAlarmsProps) {
    super(scope, id);

    const { stackName, environment, operationsEmail, api, lambdaFunctions,
            jobsTable, usersTable, attestationsTable, rateLimitBucketsTable,
            translationStateMachine } = props;

    // 1. Create SNS topic for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `lfmt-alarms-${stackName}`,
      displayName: `LFMT Alarms - ${environment}`,
    });

    // Subscribe operations email to alarm topic
    this.alarmTopic.addSubscription(
      new sns_subscriptions.EmailSubscription(operationsEmail)
    );

    // 2. Create Lambda error rate alarms
    this.lambdaErrorAlarms = this.createLambdaErrorAlarms(
      lambdaFunctions,
      this.alarmTopic
    );

    // 3. Create API Gateway 5xx alarm
    this.apiGateway5xxAlarm = this.createApiGateway5xxAlarm(
      api,
      this.alarmTopic
    );

    // 4. Create DynamoDB throttling alarms
    this.dynamoDbThrottlingAlarms = this.createDynamoDbThrottlingAlarms(
      [jobsTable, usersTable, attestationsTable, rateLimitBucketsTable],
      this.alarmTopic
    );

    // 5. Create Step Functions failure alarm
    this.stepFunctionsFailureAlarm = this.createStepFunctionsFailureAlarm(
      translationStateMachine,
      this.alarmTopic
    );
  }

  private createLambdaErrorAlarms(
    lambdaFunctions: lambda.Function[],
    alarmTopic: sns.Topic
  ): cloudwatch.Alarm[] {
    const alarms: cloudwatch.Alarm[] = [];

    lambdaFunctions.forEach((fn) => {
      // Calculate error rate: (Errors / Invocations) * 100
      const errorRate = new cloudwatch.MathExpression({
        expression: '(errors / invocations) * 100',
        usingMetrics: {
          errors: fn.metricErrors({
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
          invocations: fn.metricInvocations({
            statistic: 'Sum',
            period: Duration.minutes(5),
          }),
        },
        label: 'Error Rate (%)',
      });

      const alarm = new cloudwatch.Alarm(this, `${fn.node.id}ErrorAlarm`, {
        alarmName: `${fn.functionName}-error-rate`,
        alarmDescription: `Lambda error rate > 5% for ${fn.functionName}`,
        metric: errorRate,
        threshold: 5, // 5% error rate
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
      alarms.push(alarm);
    });

    return alarms;
  }

  private createApiGateway5xxAlarm(
    api: apigateway.RestApi,
    alarmTopic: sns.Topic
  ): cloudwatch.Alarm {
    // API Gateway 5xx error count
    const serverErrors = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5XXError',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Total requests
    const totalRequests = new cloudwatch.Metric({
      namespace: 'AWS/ApiGateway',
      metricName: 'Count',
      dimensionsMap: {
        ApiName: api.restApiName,
      },
      statistic: 'Sum',
      period: Duration.minutes(5),
    });

    // Calculate 5xx error rate: (5XXError / Count) * 100
    const errorRate = new cloudwatch.MathExpression({
      expression: '(errors / requests) * 100',
      usingMetrics: {
        errors: serverErrors,
        requests: totalRequests,
      },
      label: '5xx Error Rate (%)',
    });

    const alarm = new cloudwatch.Alarm(this, 'ApiGateway5xxAlarm', {
      alarmName: `${api.restApiName}-5xx-error-rate`,
      alarmDescription: `API Gateway 5xx error rate > 1% for ${api.restApiName}`,
      metric: errorRate,
      threshold: 1, // 1% error rate
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
    return alarm;
  }

  private createDynamoDbThrottlingAlarms(
    tables: dynamodb.Table[],
    alarmTopic: sns.Topic
  ): cloudwatch.Alarm[] {
    const alarms: cloudwatch.Alarm[] = [];

    tables.forEach((table) => {
      // Throttled read requests
      const throttledReads = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ReadThrottleEvents',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(1),
      });

      // Throttled write requests
      const throttledWrites = new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'WriteThrottleEvents',
        dimensionsMap: {
          TableName: table.tableName,
        },
        statistic: 'Sum',
        period: Duration.minutes(1),
      });

      // Total throttled requests
      const totalThrottled = new cloudwatch.MathExpression({
        expression: 'reads + writes',
        usingMetrics: {
          reads: throttledReads,
          writes: throttledWrites,
        },
        label: 'Total Throttled Requests',
      });

      const alarm = new cloudwatch.Alarm(this, `${table.node.id}ThrottlingAlarm`, {
        alarmName: `${table.tableName}-throttling`,
        alarmDescription: `DynamoDB throttled requests > 10 for ${table.tableName}`,
        metric: totalThrottled,
        threshold: 10,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
      alarms.push(alarm);
    });

    return alarms;
  }

  private createStepFunctionsFailureAlarm(
    stateMachine: stepfunctions.StateMachine,
    alarmTopic: sns.Topic
  ): cloudwatch.Alarm {
    // Failed executions
    const executionsFailed = new cloudwatch.Metric({
      namespace: 'AWS/States',
      metricName: 'ExecutionsFailed',
      dimensionsMap: {
        StateMachineArn: stateMachine.stateMachineArn,
      },
      statistic: 'Sum',
      period: Duration.minutes(60), // 1 hour
    });

    const alarm = new cloudwatch.Alarm(this, 'StepFunctionsFailureAlarm', {
      alarmName: `${stateMachine.stateMachineName}-failures`,
      alarmDescription: `Step Functions failures > 3 in 1 hour for ${stateMachine.stateMachineName}`,
      metric: executionsFailed,
      threshold: 3,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    alarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
    return alarm;
  }
}
