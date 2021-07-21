import * as pulumi from '@pulumi/pulumi';
import * as config from '../../config';
import * as utils from '../../utils';
import { cloudwatch } from '..';

export interface SESBounceQueueInstrumentationArgs {
    serviceId?: string;
    snsTopicName: pulumi.Input<string>;
    sqsQueueName: pulumi.Input<string>;
}

export class SESBounceQueueInstrumentation extends pulumi.ComponentResource {
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;

    constructor(name: string, instArgs: SESBounceQueueInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESBounceQueueInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            instArgs.serviceId
        );

        this.dashboardWidgets = pulumi.all([instArgs]).apply(([args]) => [
            cloudwatch.createSectionHeader(
                `pu-${config.cloudherder.deploymentEnv}-${config.cloudherder.deploymentName} Bounce Queue Metrics`,
                10
            ),
            ...createSESBounceQueueWidgets({
                y: 11,
                snsTopicName: args.snsTopicName,
                sqsQueueName: args.sqsQueueName
            })
        ]);
    }
}

interface SESBounceQueueWidgetsArgs {
    y: number;
    snsTopicName: string;
    sqsQueueName: string;
}

function createSESBounceQueueWidgets(args: SESBounceQueueWidgetsArgs): Array<cloudwatch.DashboardWidget> {
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
                            region: config.caller.region
                        }
                    ],
                    ['AWS/SNS', 'NumberOfNotificationsPublished', 'TopicName', args.snsTopicName, { id: 'm1' }],
                    ['.', 'NumberOfMessagesFailed', '.', '.', { id: 'm2' }]
                ],
                view: 'singleValue',
                region: config.caller.region,
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
                region: config.caller.region,
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
                region: config.caller.region,
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
                region: config.caller.region,
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
