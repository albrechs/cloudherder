import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as config from '../../config';
import * as utils from '../../utils';
import { cloudwatch } from '..';

export interface SESDomainInstrumentationArgs {
    serviceId?: string;
    bounceQueueWidgets: pulumi.Input<cloudwatch.DashboardWidget[]>;
    createDashboard?: boolean;
}

export class SESDomainInstrumentation extends pulumi.ComponentResource {
    readonly configurationSet: aws.ses.ConfigurationSet;
    readonly eventDestination: aws.ses.EventDestination;
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;
    readonly dashboard?: pulumi.Output<aws.cloudwatch.Dashboard>;

    constructor(name: string, instArgs: SESDomainInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESDomainInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            instArgs.serviceId
        );

        this.configurationSet = new aws.ses.ConfigurationSet(
            'ses-monitoring-config-set',
            {
                name: `${resourcePrefix}-ses-config-set`
            },
            defaultResourceOptions
        );
        this.eventDestination = new aws.ses.EventDestination(
            'ses-monitoring-event-dest',
            {
                configurationSetName: this.configurationSet.name,
                enabled: true,
                matchingTypes: ['bounce', 'complaint', 'delivery', 'reject', 'send'],
                cloudwatchDestinations: [
                    {
                        defaultValue: 'default',
                        dimensionName: 'X-SES-CONFIGURATION-SET',
                        valueSource: 'emailHeader'
                    }
                ]
            },
            { parent: this.configurationSet }
        );

        this.dashboardWidgets = pulumi.all([instArgs.bounceQueueWidgets]).apply(([bounceQueueWidgets]) => [
            cloudwatch.createSectionHeader(`${resourcePrefix} SES Metrics`),
            ...createSesPerformanceMetricsWidgets({
                y: 1,
                configSetName: this.configurationSet.name
            }),
            ...bounceQueueWidgets
        ]);

        if (instArgs.createDashboard) {
            this.dashboard = pulumi.all([this.dashboardWidgets]).apply(
                ([widgets]) =>
                    new aws.cloudwatch.Dashboard(
                        'ses-cw-dashboard',
                        {
                            dashboardName: `${resourcePrefix}-ses-dashboard`,
                            dashboardBody: JSON.stringify({
                                widgets: widgets
                            })
                        },
                        defaultResourceOptions
                    )
            );
        }
    }
}

interface sesPerformanceMetricsArgs {
    y: number;
    configSetName: pulumi.Input<string>;
}

function createSesPerformanceMetricsWidgets(args: sesPerformanceMetricsArgs): Array<cloudwatch.DashboardWidget> {
    return [
        new cloudwatch.DashboardWidget({
            height: 3,
            width: 24,
            x: 0,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/SES', 'Send', 'X-SES-CONFIGURATION-SET', args.configSetName, { label: 'Sent' }],
                    ['.', 'Delivery', '.', '.', { label: 'Delivered' }],
                    ['.', 'Bounce', '.', '.', { label: 'Bounced' }],
                    ['.', 'Reject', '.', '.', { label: 'Rejected' }],
                    ['.', 'Complaint', '.', '.', { label: 'Complaint' }]
                ],
                view: 'singleValue',
                region: config.caller.region,
                stat: 'Sum',
                period: 3600,
                title: `${args.configSetName} SES Config Set Send Statistics`
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 24,
            x: 0,
            y: args.y + 3,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/SES', 'Send', 'X-SES-CONFIGURATION-SET', args.configSetName, { label: 'Sent' }],
                    ['.', 'Delivery', '.', '.', { label: 'Delivered' }],
                    ['.', 'Bounce', '.', '.', { label: 'Bounced' }],
                    ['.', 'Reject', '.', '.', { label: 'Rejected' }],
                    ['.', 'Complaint', '.', '.', { label: 'Complaint' }]
                ],
                view: 'timeSeries',
                region: config.caller.region,
                stat: 'Sum',
                period: 300,
                title: `${args.configSetName} SES Config Set Send Statistics`,
                stacked: false,
                yAxis: {
                    left: {
                        showUnits: true,
                        min: 0
                    }
                },
                legend: {
                    position: 'right'
                },
                liveData: false
            }
        })
    ];
}
