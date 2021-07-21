import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as config from '../../config';
import * as utils from '../../utils';
import { cloudwatch } from '..';

export interface AppLoadbalancerInstrumentationArgs {
    serviceId?: string;
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
        const resourcePrefix = utils.buildResourcePrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            instArgs.serviceId
        );

        this.dashboardWidgets = pulumi
            .all([instArgs.targetGroupId, instArgs.loadbalancerId])
            .apply(([targetGroupId, loadbalancerId]) => [
                cloudwatch.createSectionHeader(`${resourcePrefix} ALB Metrics`),
                ...createAlbPerformanceMetricsWidget({
                    x: 0,
                    y: 1,
                    resourcePrefix: resourcePrefix,
                    serviceId: instArgs.serviceId,
                    targetGroupId: targetGroupId,
                    loadbalancerId: loadbalancerId
                })
            ]);

        if (instArgs.createDashboard) {
            this.dashboard = pulumi.all([this.dashboardWidgets]).apply(
                ([widgets]) =>
                    new aws.cloudwatch.Dashboard(
                        `${config.cloudherder.deploymentName}${utils.insertServiceId(
                            instArgs.serviceId
                        )}-alb-cw-dashboard`,
                        {
                            dashboardName: `${resourcePrefix}-alb-dashboard`,
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
    resourcePrefix: string;
    serviceId?: string;
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
                region: config.caller.region,
                stat: 'Sum',
                period: 900,
                title: `${args.resourcePrefix} Target Group Health`
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
                region: config.caller.region,
                stat: 'Minimum',
                period: 300
            }
        })
    ];
}
