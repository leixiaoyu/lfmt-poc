import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Duration, Stack } from 'aws-cdk-lib';

export interface CostMonitoringProps {
  stackName: string;
  environment: string;
  operationsEmail: string;
  monthlyBudgetLimit: number; // In USD
}

/**
 * Cost Monitoring Construct
 *
 * Creates AWS Budgets and cost monitoring alarms:
 * - Monthly budget with 80% and 100% alerts
 * - Daily spend alarm (detects unusual spikes)
 * - SNS notifications to operations email
 *
 * Note: AWS Cost Anomaly Detection must be configured manually via AWS Console
 * (see docs/runbooks/cost-monitoring-setup.md for instructions)
 */
export class CostMonitoring extends Construct {
  public readonly costAlarmTopic: sns.Topic;
  public readonly monthlyBudget: budgets.CfnBudget;
  public readonly dailySpendAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: CostMonitoringProps) {
    super(scope, id);

    const { stackName, environment, operationsEmail, monthlyBudgetLimit } = props;

    // Emit warning during CDK synth about tag filter risk
    console.warn('\n⚠️  [CostMonitoring] Budget tag filter is set to "user:Project$lfmt"');
    console.warn('   If NO resources have this tag, the budget will track ALL account costs!');
    console.warn('   Verify tag coverage: aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=lfmt\n');

    // 1. Create SNS topic for cost alerts
    this.costAlarmTopic = new sns.Topic(this, 'CostAlarmTopic', {
      topicName: `lfmt-cost-alarms-${stackName}`,
      displayName: `LFMT Cost Alarms - ${environment}`,
    });

    // Note: Email subscription requires manual confirmation
    // The operations team will receive an email to confirm subscription

    // 2. Create monthly budget with 80% and 100% alerts
    //
    // ⚠️ CRITICAL WARNING: Tag Filter Behavior
    // The costFilter below uses `user:Project$lfmt` to track only LFMT resources.
    // HOWEVER, if NO resources have this tag, AWS Budgets will SILENTLY track ALL
    // account costs instead of tracking nothing or erroring.
    //
    // Risk Mitigation:
    // 1. Ensure ALL resources are tagged with "Project: lfmt" (see CDK tagging below)
    // 2. Periodically verify tags: aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=lfmt
    // 3. Check AWS Cost Explorer to confirm budget is tracking correct resources
    // 4. If budget unexpectedly exceeds limit, verify tag coverage FIRST
    //
    // See: backend/infrastructure/bin/infrastructure.ts for stack-level tagging
    this.monthlyBudget = new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `lfmt-monthly-budget-${stackName}`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyBudgetLimit,
          unit: 'USD',
        },
        costFilters: {
          // Filter by project tags (requires tagging all resources)
          // ⚠️ See warning above about tag filter behavior
          TagKeyValue: [`user:Project$lfmt`],
        },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 80, // 80% of budget
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: operationsEmail,
            },
            {
              subscriptionType: 'SNS',
              address: this.costAlarmTopic.topicArn,
            },
          ],
        },
        {
          notification: {
            notificationType: 'ACTUAL',
            comparisonOperator: 'GREATER_THAN',
            threshold: 100, // 100% of budget
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              subscriptionType: 'EMAIL',
              address: operationsEmail,
            },
            {
              subscriptionType: 'SNS',
              address: this.costAlarmTopic.topicArn,
            },
          ],
        },
      ],
    });

    // 3. Create daily spend alarm (CloudWatch metric from AWS Billing)
    // Note: This requires AWS Cost and Usage Reports to be enabled
    // The metric is published by AWS to CloudWatch under the 'AWS/Billing' namespace
    const estimatedCharges = new cloudwatch.Metric({
      namespace: 'AWS/Billing',
      metricName: 'EstimatedCharges',
      dimensionsMap: {
        Currency: 'USD',
      },
      statistic: 'Maximum',
      period: Duration.hours(6), // Check every 6 hours
    });

    // Create alarm for daily spend > $5 (unusual spike)
    // This is a rough estimate: monthly budget / 30 days * 3 (3x daily average = spike)
    const dailySpendThreshold = (monthlyBudgetLimit / 30) * 3;

    this.dailySpendAlarm = new cloudwatch.Alarm(this, 'DailySpendAlarm', {
      alarmName: `${stackName}-daily-spend-spike`,
      alarmDescription: `Daily AWS spend spike detected (>${dailySpendThreshold.toFixed(2)} USD in 6 hours)`,
      metric: estimatedCharges,
      threshold: dailySpendThreshold,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    this.dailySpendAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.costAlarmTopic));
  }
}
