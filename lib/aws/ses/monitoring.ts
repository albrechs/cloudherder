import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { cloudwatch } from '../';

export interface CloudherderSESInstrumentationArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentRegion: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    bounceQueueWidgets: pulumi.Input<cloudwatch.DashboardWidget[]>;
    createDashboard?: boolean;
}

export class CloudherderSESInstrumentation extends pulumi.ComponentResource {
    readonly configurationSet: aws.ses.ConfigurationSet;
    readonly eventDestination: aws.ses.EventDestination;
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;
    readonly dashboard?: pulumi.Output<aws.cloudwatch.Dashboard>;

    constructor(name: string, instArgs: CloudherderSESInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:sesInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.configurationSet = new aws.ses.ConfigurationSet(
            'ses-monitoring-config-set',
            {
                name: `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName}-ses-config-set`
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
            cloudwatch.createSectionHeader(`pu-${instArgs.deploymentEnv}-${instArgs.deploymentName} SES Metrics`),
            ...createSesPerformanceMetricsWidgets({
                y: 1,
                configSetName: this.configurationSet.name,
                region: instArgs.deploymentRegion
            }),
            ...bounceQueueWidgets
        ]);

        if (instArgs.createDashboard) {
            this.dashboard = pulumi.all([this.dashboardWidgets]).apply(
                ([widgets]) =>
                    new aws.cloudwatch.Dashboard(
                        'ses-cw-dashboard',
                        {
                            dashboardName: `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName}-ses-dashboard`,
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
    region: pulumi.Input<string>;
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
                region: args.region,
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
                region: args.region,
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
