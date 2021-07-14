import * as pulumi from '@pulumi/pulumi';
import { cloudwatch } from '../';

export interface CloudherderBounceQueueInstrumentationArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentRegion: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    snsTopicName: pulumi.Input<string>;
    sqsQueueName: pulumi.Input<string>;
}

export class CloudherderBounceQueueInstrumentation extends pulumi.ComponentResource {
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;

    constructor(name: string, instArgs: CloudherderBounceQueueInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:bounceQueueInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.dashboardWidgets = pulumi.all([instArgs]).apply(([args]) => [
            cloudwatch.createSectionHeader(
                `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName} Bounce Queue Metrics`,
                10
            ),
            ...createBounceQueueWidgets({
                y: 11,
                deploymentRegion: args.deploymentRegion,
                snsTopicName: args.snsTopicName,
                sqsQueueName: args.sqsQueueName
            })
        ]);
    }
}

interface bounceQueueWidgetsArgs {
    y: number;
    deploymentRegion: string;
    snsTopicName: string;
    sqsQueueName: string;
}

function createBounceQueueWidgets(args: bounceQueueWidgetsArgs): Array<cloudwatch.DashboardWidget> {
    return [
        new cloudwatch.DashboardWidget({
            height: 3,
            width: 12,
            y: args.y,
            x: 0,
            type: 'metric',
            properties: {
                metrics: [
                    [
                        {
                            expression: 'IF(m1, 100*(m2/m1))',
                            label: 'NotificationFailureRate',
                            id: 'e1',
                            region: args.deploymentRegion
                        }
                    ],
                    ['AWS/SNS', 'NumberOfNotificationsPublished', 'TopicName', args.snsTopicName, { id: 'm1' }],
                    ['.', 'NumberOfMessagesFailed', '.', '.', { id: 'm2' }]
                ],
                view: 'singleValue',
                region: args.deploymentRegion,
                stat: 'Sum',
                period: 900,
                title: 'SNS Publish Metrics'
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 12,
            x: 0,
            y: args.y + 3,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/SNS', 'NumberOfMessagesPublished', 'TopicName', args.snsTopicName, { id: 'm1' }],
                    ['.', 'NumberOfNotificationsFailed', '.', '.', { id: 'm2' }]
                ],
                view: 'timeSeries',
                stacked: false,
                region: args.deploymentRegion,
                stat: 'Sum',
                period: 900,
                title: 'SNS Publish Metrics Graph',
                yAxis: {
                    left: {
                        showUnits: true,
                        min: 0
                    }
                }
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 3,
            width: 12,
            x: 12,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/SQS', 'NumberOfMessagesSent', 'QueueName', args.sqsQueueName],
                    ['.', 'NumberOfMessagesReceived', '.', '.'],
                    ['.', 'NumberOfMessagesDeleted', '.', '.'],
                    ['.', 'ApproximateAgeOfOldestMessage', '.', '.', { stat: 'Average' }]
                ],
                view: 'singleValue',
                region: args.deploymentRegion,
                stat: 'Sum',
                period: 900,
                title: 'SQS Message Metrics'
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 12,
            x: 12,
            y: args.y + 3,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/SQS', 'NumberOfMessagesSent', 'QueueName', args.sqsQueueName],
                    ['.', 'NumberOfMessagesReceived', '.', '.'],
                    ['.', 'NumberOfMessagesDeleted', '.', '.']
                ],
                view: 'timeSeries',
                stacked: false,
                region: args.deploymentRegion,
                stat: 'Sum',
                period: 900,
                title: 'SQS Message Metrics Graph',
                yAxis: {
                    left: {
                        showUnits: true,
                        min: 0
                    }
                }
            }
        })
    ];
}
