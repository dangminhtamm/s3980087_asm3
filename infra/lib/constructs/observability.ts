import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';

const metric = (
  prefix: string,
  metricName: string,
  statistic: string,
  dimensions: string,
  label: string,
): cloudwatch.MathExpression =>
  new cloudwatch.MathExpression({
    expression: `SEARCH('{CloudFleet/Observability,${dimensions}} MetricName="${metricName}" Environment="${prefix}"', '${statistic}', 300)`,
    label,
    period: Duration.minutes(5),
  });

const graph = (title: string, metrics: cloudwatch.IMetric[]): cloudwatch.GraphWidget =>
  new cloudwatch.GraphWidget({
    title,
    left: metrics,
    width: 12,
    height: 6,
    leftYAxis: { min: 0 },
    view: cloudwatch.GraphWidgetView.TIME_SERIES,
  });

export class Observability extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;

  public constructor(scope: Construct, id: string, props: { prefix: string }) {
    super(scope, id);
    const search = (name: string, statistic: string, dimensions: string, label: string) =>
      metric(props.prefix, name, statistic, dimensions, label);
    this.dashboard = new cloudwatch.Dashboard(this, 'ObservabilityDashboard', {
      dashboardName: `${props.prefix}-performance`,
      defaultInterval: Duration.hours(3),
    });
    this.dashboard.addWidgets(
      graph('Endpoint latency p95', [
        search('HttpRequestDuration', 'p95', 'Service,Environment,Method,Route', 'p95 latency'),
      ]),
      graph('Endpoint throughput and errors', [
        search('HttpRequestCount', 'Sum', 'Service,Environment,Method,Route', 'requests'),
        search('HttpErrorCount', 'Sum', 'Service,Environment,Method,Route', 'errors'),
        search('HttpErrorRate', 'Average', 'Service,Environment,Method,Route', 'error rate %'),
      ]),
      graph('DynamoDB latency', [
        search(
          'DynamoDBRequestDuration',
          'p95',
          'Service,Environment,Dependency,Operation',
          'p95 DynamoDB',
        ),
      ]),
      graph('DynamoDB consumed capacity', [
        search(
          'DynamoDBConsumedCapacity',
          'Sum',
          'Service,Environment,Dependency,Operation',
          'capacity units',
        ),
        search(
          'DynamoDBScannedItemCount',
          'Sum',
          'Service,Environment,Dependency,Operation',
          'scanned items',
        ),
        search(
          'DynamoDBReturnedItemCount',
          'Sum',
          'Service,Environment,Dependency,Operation',
          'returned items',
        ),
      ]),
      graph('Routing, geocoding and optimization latency', [
        search(
          'RoutingProviderDuration',
          'p95',
          'Service,Environment,Provider,Operation,Outcome',
          'OSRM p95',
        ),
        search(
          'GeocodingDuration',
          'p95',
          'Service,Environment,Provider,Cache,Outcome',
          'geocoding p95',
        ),
        search(
          'RouteOptimizationDuration',
          'p95',
          'Service,Environment,Mode,StopBucket',
          'optimization p95',
        ),
        search(
          'RoutePlanningDuration',
          'p95',
          'Service,Environment,Provider,StopBucket',
          'route plan p95',
        ),
      ]),
      graph('POD upload and registration', [
        search('PodUploadDuration', 'p95', 'Service,Environment,Outcome', 'browser → S3 p95'),
        search('S3ProofVerifyDuration', 'p95', 'Service,Environment,Outcome', 'S3 verify p95'),
        search('ProofRegisterDuration', 'p95', 'Service,Environment,Outcome', 'register p95'),
      ]),
      graph('Push and SMS outcomes', [
        search('PushSuccessCount', 'Sum', 'Service,Environment,Provider,Outcome', 'push success'),
        search('PushFailureCount', 'Sum', 'Service,Environment,Provider,Outcome', 'push failure'),
        search('PushSuccessRate', 'Average', 'Service,Environment,Provider', 'push success %'),
        search('SmsSuccessCount', 'Sum', 'Service,Environment,Provider,Outcome', 'SMS success'),
        search('SmsFailureCount', 'Sum', 'Service,Environment,Provider,Outcome', 'SMS failure'),
        search('SmsSuccessRate', 'Average', 'Service,Environment,Provider', 'SMS success %'),
      ]),
      graph('Frontend Web Vitals p75', [
        search('WebVitalLCP', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'LCP'),
        search('WebVitalINP', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'INP'),
        search('WebVitalCLS', 'p75', 'Service,Environment,Vital,Rating,Page,DeviceType', 'CLS'),
      ]),
      graph('Offline outbox health', [
        search('OfflineOutboxSize', 'Maximum', 'Service,Environment,Event', 'max queue size'),
        search('OfflineOutboxRetryCount', 'Sum', 'Service,Environment,Event', 'retries'),
        search('OfflineOutboxConflictCount', 'Sum', 'Service,Environment,Event', 'conflicts'),
      ]),
    );
  }
}
