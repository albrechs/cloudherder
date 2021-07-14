import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { cloudwatch } from '../';
import * as utils from '../../utils';

export interface CloudherderRedirectRuleArgs {
    url: pulumi.Input<string>;
    pathPattern: Array<string>;
}

export interface CloudherderTargetGroupArgs {
    port: pulumi.Input<number>;
    healthCheckPath: pulumi.Input<string>;
    healthyThreshold: pulumi.Input<number>;
    unhealthyThreshold: pulumi.Input<number>;
    redirectRule?: CloudherderRedirectRuleArgs;
}

export interface CloudherderALBArgs {
    url: pulumi.Input<string>;
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    serviceId?: pulumi.Input<string>;
    region: pulumi.Input<string>;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<Array<string>>;
    internal?: boolean;
    enableLogging: boolean;
    loggingBucketId?: pulumi.Input<string>;
    route53ZoneId: Promise<string>;
    target: CloudherderTargetGroupArgs;
    createDashboard?: boolean;
}

export class CloudherderALB extends pulumi.ComponentResource {
    readonly securityGroup: aws.ec2.SecurityGroup;
    readonly loadBalancer: aws.lb.LoadBalancer;
    readonly targetGroup: aws.lb.TargetGroup;
    readonly route53Record: aws.route53.Record;
    readonly instrumentation: CloudherderALBInstrumentation;

    /**
     * @param name The unique name of the resource
     * @param albArgs The arguments to configure the load balancer resources
     * @param opts Pulumi opts
     */
    constructor(name: string, albArgs: CloudherderALBArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:alb', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        let accessLogSettings: aws.types.input.lb.LoadBalancerAccessLogs | undefined = {
            bucket: ''
        } as aws.types.input.lb.LoadBalancerAccessLogs;

        if (albArgs.loggingBucketId) {
            accessLogSettings.bucket = albArgs.loggingBucketId;
            accessLogSettings.prefix = albArgs.deploymentName;
            accessLogSettings.enabled = true;
        } else {
            accessLogSettings = undefined;
        }

        this.securityGroup = new aws.ec2.SecurityGroup(
            `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-sg`,
            {
                description: 'Security group for the the cloudherder-web pulumi deployment ALB',
                vpcId: albArgs.vpcId,
                tags: {
                    Name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}-alb-sg`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.loadBalancer = new aws.lb.LoadBalancer(
            `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb`,
            {
                name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-${
                    albArgs.deploymentName
                }`,
                internal: albArgs.internal,
                loadBalancerType: 'application',
                securityGroups: [this.securityGroup.id],
                subnets: albArgs.subnetIds,
                enableDeletionProtection: false,
                accessLogs: accessLogSettings,
                tags: {
                    Name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}${insertServiceId(
                        albArgs.serviceId
                    )}-alb-${albArgs.deploymentName}`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.targetGroup = new aws.lb.TargetGroup(
            `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-target-group`,
            {
                port: albArgs.target.port,
                protocol: 'HTTP',
                vpcId: albArgs.vpcId,
                targetType: 'ip',
                healthCheck: {
                    enabled: true,
                    path: albArgs.target.healthCheckPath,
                    healthyThreshold: 5,
                    unhealthyThreshold: 2
                }
            },
            { parent: this.loadBalancer }
        );

        const listenerHttpRedirect = new aws.lb.Listener(
            `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-http-redirect`,
            {
                loadBalancerArn: this.loadBalancer.arn,
                port: 80,
                protocol: 'HTTP',
                defaultActions: [
                    {
                        type: 'redirect',
                        redirect: {
                            port: '443',
                            protocol: 'HTTPS',
                            statusCode: 'HTTP_301'
                        }
                    }
                ]
            },
            { parent: this.loadBalancer }
        );

        const loadBalancerCertificate = new aws.acm.Certificate(
            `${albArgs.url}-alb-certificate`,
            {
                domainName: albArgs.url,
                validationMethod: 'DNS',
                tags: {
                    Name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}-${albArgs.url}-cert`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        const listenerHttps = new aws.lb.Listener(
            `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-https-listener`,
            {
                loadBalancerArn: this.loadBalancer.arn,
                port: 443,
                protocol: 'HTTPS',
                sslPolicy: 'ELBSecurityPolicy-2016-08',
                certificateArn: loadBalancerCertificate.arn,
                defaultActions: [
                    {
                        type: 'forward',
                        targetGroupArn: this.targetGroup.arn
                    }
                ]
            },
            { parent: this.loadBalancer }
        );

        const certificateValidationRecords = new aws.route53.Record(
            `${albArgs.url}-alb-cert-validation-records`,
            {
                name: loadBalancerCertificate.domainValidationOptions[0].resourceRecordName,
                type: loadBalancerCertificate.domainValidationOptions[0].resourceRecordType,
                zoneId: albArgs.route53ZoneId,
                records: [loadBalancerCertificate.domainValidationOptions[0].resourceRecordValue],
                ttl: 60
            },
            { parent: loadBalancerCertificate, dependsOn: loadBalancerCertificate }
        );

        const certificateValidation = new aws.acm.CertificateValidation(
            `${albArgs.url}-alb-cert-validation`,
            {
                certificateArn: loadBalancerCertificate.arn,
                validationRecordFqdns: [certificateValidationRecords.fqdn]
            },
            { parent: loadBalancerCertificate }
        );

        this.route53Record = new aws.route53.Record(
            `${albArgs.url}-alb-rt53-record`,
            {
                name: albArgs.url,
                zoneId: albArgs.route53ZoneId,
                type: 'A',
                aliases: [
                    {
                        name: this.loadBalancer.dnsName,
                        zoneId: this.loadBalancer.zoneId,
                        evaluateTargetHealth: true
                    }
                ]
            },
            defaultResourceOptions
        );

        if (albArgs.target.redirectRule) {
            const redirectRule = new aws.lb.ListenerRule(
                `${albArgs.deploymentName}${insertServiceId(albArgs.serviceId)}-alb-redirect`,
                {
                    listenerArn: listenerHttps.arn,
                    priority: 100,
                    actions: [
                        {
                            type: 'redirect',
                            redirect: {
                                statusCode: 'HTTP_301',
                                host: albArgs.target.redirectRule.url
                            }
                        }
                    ],
                    conditions: [
                        {
                            pathPattern: {
                                values: albArgs.target.redirectRule.pathPattern
                            }
                        }
                    ]
                },
                { parent: this.loadBalancer }
            );
        }

        this.instrumentation = new CloudherderALBInstrumentation(
            `${albArgs.deploymentName}-alb-instrumentation`,
            {
                deploymentEnv: albArgs.deploymentEnv,
                deploymentName: albArgs.deploymentName,
                region: albArgs.region,
                serviceId: albArgs.serviceId,
                targetGroupId: this.targetGroup.arnSuffix,
                loadbalancerId: this.loadBalancer.arnSuffix,
                createDashboard: albArgs.createDashboard
            },
            defaultResourceOptions
        );
    }
}

interface CloudherderALBInstrumentationArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    region: pulumi.Input<string>;
    serviceId?: pulumi.Input<string>;
    targetGroupId: pulumi.Input<string>;
    loadbalancerId: pulumi.Input<string>;
    createDashboard?: boolean;
}

class CloudherderALBInstrumentation extends pulumi.ComponentResource {
    readonly dashboardWidgets: pulumi.Output<cloudwatch.DashboardWidget[]>;
    readonly dashboard?: pulumi.Output<aws.cloudwatch.Dashboard>;

    /**
     * a
     * s
     * d
     */
    constructor(name: string, instArgs: CloudherderALBInstrumentationArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:albInstrumentation', name, {}, opts);
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
                        `${instArgs.deploymentName}${insertServiceId(instArgs.serviceId)}-alb-cw-dashboard`,
                        {
                            dashboardName: `pu-${instArgs.deploymentEnv}-${instArgs.deploymentName}${insertServiceId(
                                instArgs.serviceId
                            )}-alb-dashboard`,
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

function insertServiceId(serviceId: pulumi.Input<string> | undefined): pulumi.Input<string> | undefined {
    if (serviceId != undefined) {
        return `-${serviceId}`;
    } else {
        return undefined;
    }
}
