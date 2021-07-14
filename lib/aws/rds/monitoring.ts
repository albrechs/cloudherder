import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { cloudwatch } from '../';

export interface CloudherderRDSInstrumentationArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    deploymentRegion: pulumi.Input<string>;
    logQueries: cloudwatch.CloudherderQueryArgs[];
    rdsInstanceName: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class CloudherderRDSInstrumentation extends pulumi.ComponentResource {
    readonly logQueries: aws.cloudwatch.QueryDefinition[];
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;
    readonly dashboard?: pulumi.Output<aws.cloudwatch.Dashboard>;

    constructor(name: string, instArgs: CloudherderRDSInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:rdsInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.logQueries = [];
        for (let i = 0; i < instArgs.logQueries.length; i++) {
            this.logQueries.push(
                new aws.cloudwatch.QueryDefinition(
                    `rds-log-query-${i}`,
                    {
                        name: instArgs.logQueries[i].name,
                        logGroupNames: [instArgs.logQueries[i].logGroupName],
                        queryString: `fields @timestamp, @message
    | ${instArgs.logQueries[i].query}
    `
                    },
                    defaultResourceOptions
                )
            );
        }

        this.dashboardWidgets = pulumi
            .all([instArgs.logQueries, instArgs.rdsInstanceName])
            .apply(([logQueries, rdsInstanceName]) => [
                cloudwatch.createSectionHeader(`pu-${instArgs.deploymentEnv}-${instArgs.deploymentName} RDS Metrics`),
                ...createRdsMonitoringWidgets({
                    y: 1,
                    deploymentRegion: instArgs.deploymentRegion,
                    instanceName: rdsInstanceName
                }),
                ...cloudwatch.createLogWidgets({
                    y: 13,
                    queries: logQueries,
                    deploymentRegion: instArgs.deploymentRegion
                })
            ]);

        if (instArgs.createDashboard) {
            this.dashboard = pulumi.all([this.dashboardWidgets]).apply(
                ([widgets]) =>
                    new aws.cloudwatch.Dashboard(
                        'rds-cw-dashboard',
                        {
                            dashboardName: `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName}-rds-dashboard`,
                            dashboardBody: JSON.stringify({
                                widgets: widgets
                            })
                        },
                        defaultResourceOptions
                    )
            );
        } else {
            this.dashboard = undefined;
        }
    }
}

interface rdsMonitorWidgetArgs {
    y: number;
    deploymentRegion: pulumi.Input<string>;
    instanceName: pulumi.Input<string>;
}

function createRdsMonitoringWidgets(args: rdsMonitorWidgetArgs): Array<cloudwatch.DashboardWidget> {
    return [
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 6,
            x: 0,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/RDS', 'DatabaseConnections', 'DBInstanceIdentifier', args.instanceName],
                    ['...', `${args.instanceName}-replica`]
                ],
                view: 'timeSeries',
                deploymentRegion: args.deploymentRegion,
                title: 'Database Connections',
                stat: 'Sum',
                period: 900,
                stacked: false
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 6,
            x: 6,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/RDS', 'CPUUtilization', 'DBInstanceIdentifier', args.instanceName],
                    ['...', `${args.instanceName}-replica`]
                ],
                view: 'timeSeries',
                stacked: false,
                deploymentRegion: args.deploymentRegion,
                stat: 'Average',
                period: 300
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 6,
            x: 12,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/RDS', 'WriteThroughput', 'DBInstanceIdentifier', args.instanceName],
                    ['...', `${args.instanceName}-replica`]
                ],
                view: 'timeSeries',
                stacked: false,
                deploymentRegion: args.deploymentRegion,
                stat: 'Average',
                period: 300
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 6,
            x: 18,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/RDS', 'ReadThroughput', 'DBInstanceIdentifier', args.instanceName],
                    ['...', `${args.instanceName}-replica`]
                ],
                view: 'timeSeries',
                stacked: false,
                deploymentRegion: args.deploymentRegion,
                stat: 'Average',
                period: 300
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 24,
            x: 0,
            y: args.y + 6,
            type: 'metric',
            properties: {
                metrics: [
                    ['AWS/RDS', 'NetworkReceiveThroughput', 'DBInstanceIdentifier', args.instanceName],
                    ['...', `${args.instanceName}-replica`, { color: '#2ca02c' }],
                    ['.', 'NetworkTransmitThroughput', '.', args.instanceName, { color: '#ff7f0e' }],
                    ['...', `${args.instanceName}-replica`]
                ],
                view: 'timeSeries',
                deploymentRegion: args.deploymentRegion,
                title: 'Network Traffic',
                stat: 'Sum',
                period: 3600,
                stacked: false
            }
        })
    ];
}
