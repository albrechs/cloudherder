import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { cloudwatch } from '..';
import * as utils from '../../utils';

export interface AppLoadbalancerInstrumentationArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    region: pulumi.Input<string>;
    serviceId?: pulumi.Input<string>;
    targetGroupId: pulumi.Input<string>;
    loadbalancerId: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class AppLoadbalancerInstrumentation extends pulumi.ComponentResource {
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;
    readonly dashboard?: pulumi.Output<aws.cloudwatch.Dashboard>;

    /**
     * a
     * s
     * d
     */
    constructor(name: string, instArgs: AppLoadbalancerInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:AppLoadbalancerInstrumentation', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.dashboardWidgets = pulumi
            .all([instArgs.targetGroupId, instArgs.loadbalancerId])
            .apply(([targetGroupId, loadbalancerId]) => [
                cloudwatch.createSectionHeader(
                    `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName} ${
                        instArgs.serviceId != undefined ? utils.capitalizeWord(instArgs.serviceId) : ''
                    } ALB Metrics`
                ),
                ...createAlbPerformanceMetricsWidget({
                    x: 0,
                    y: 1,
                    region: instArgs.region,
                    deploymentName: instArgs.deploymentName,
                    serviceId: instArgs.serviceId,
                    targetGroupId: targetGroupId,
                    loadbalancerId: loadbalancerId
                })
            ]);

        if (instArgs.createDashboard) {
            this.dashboard = pulumi.all([this.dashboardWidgets]).apply(
                ([widgets]) =>
                    new aws.cloudwatch.Dashboard(
                        `${instArgs.deploymentName}${utils.insertServiceId(instArgs.serviceId)}-alb-cw-dashboard`,
                        {
                            dashboardName: `pu-${instArgs.deploymentEnv}-${
                                instArgs.deploymentName
                            }${utils.insertServiceId(instArgs.serviceId)}-alb-dashboard`,
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

interface ALBPerformanceMetricsWidgetArgs {
    x: number;
    y: number;
    region: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    serviceId?: pulumi.Input<string>;
    targetGroupId: pulumi.Input<string>;
    loadbalancerId: pulumi.Input<string>;
}

function createAlbPerformanceMetricsWidget(args: ALBPerformanceMetricsWidgetArgs): Array<cloudwatch.DashboardWidget> {
    return [
        new cloudwatch.DashboardWidget({
            height: 3,
            width: 24,
            x: args.x,
            y: args.y,
            type: 'metric',
            properties: {
                metrics: [
                    [
                        'AWS/ApplicationELB',
                        'RequestCount',
                        'TargetGroup',
                        args.targetGroupId,
                        'LoadBalancer',
                        args.loadbalancerId
                    ],
                    ['.', 'HTTPCode_Target_2XX_Count', '.', '.', '.', '.'],
                    ['.', 'HTTPCode_Target_3XX_Count', '.', '.', '.', '.'],
                    ['.', 'HTTPCode_Target_4XX_Count', '.', '.', '.', '.'],
                    ['.', 'TargetResponseTime', '.', '.', '.', '.', { stat: 'Average' }]
                ],
                view: 'singleValue',
                region: args.region,
                stat: 'Sum',
                period: 900,
                title: `${args.deploymentName} ${args.serviceId != undefined ? args.serviceId : ''} Target Group Health`
            }
        }),
        new cloudwatch.DashboardWidget({
            height: 6,
            width: 24,
            x: args.x,
            y: args.y + 6,
            type: 'metric',
            properties: {
                metrics: [
                    [
                        'AWS/ApplicationELB',
                        'HealthyHostCount',
                        'TargetGroup',
                        args.targetGroupId,
                        'LoadBalancer',
                        args.loadbalancerId
                    ]
                ],
                view: 'timeSeries',
                stacked: false,
                region: args.region,
                stat: 'Minimum',
                period: 300
            }
        })
    ];
}
