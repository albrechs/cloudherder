import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as monitoring from './monitoring';
import * as utils from '../../utils';

export interface RedirectRuleArgs {
    url: pulumi.Input<string>;
    pathPattern: Array<string>;
}

export interface TargetGroupArgs {
    port: pulumi.Input<number>;
    healthCheckPath: pulumi.Input<string>;
    healthyThreshold: pulumi.Input<number>;
    unhealthyThreshold: pulumi.Input<number>;
    redirectRule?: RedirectRuleArgs;
}

export interface AppLoadbalancerArgs {
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
    target: TargetGroupArgs;
    createDashboard?: boolean;
}

export class AppLoadbalancer extends pulumi.ComponentResource {
    readonly securityGroup: aws.ec2.SecurityGroup;
    readonly loadBalancer: aws.lb.LoadBalancer;
    readonly targetGroup: aws.lb.TargetGroup;
    readonly route53Record: aws.route53.Record;
    readonly instrumentation: monitoring.AppLoadbalancerInstrumentation;

    /**
     * @param name The unique name of the resource
     * @param albArgs The arguments to configure the load balancer resources
     * @param opts Pulumi opts
     */
    constructor(name: string, albArgs: AppLoadbalancerArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:AppLoadbalancer', name, {}, opts);
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
            `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb-sg`,
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
            `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb`,
            {
                name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}${utils.insertServiceId(
                    albArgs.serviceId
                )}-alb-${albArgs.deploymentName}`,
                internal: albArgs.internal,
                loadBalancerType: 'application',
                securityGroups: [this.securityGroup.id],
                subnets: albArgs.subnetIds,
                enableDeletionProtection: false,
                accessLogs: accessLogSettings,
                tags: {
                    Name: `pu-${albArgs.deploymentEnv}-${albArgs.deploymentName}${utils.insertServiceId(
                        albArgs.serviceId
                    )}-alb-${albArgs.deploymentName}`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.targetGroup = new aws.lb.TargetGroup(
            `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb-target-group`,
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
            `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb-http-redirect`,
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
            `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb-https-listener`,
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
                `${albArgs.deploymentName}${utils.insertServiceId(albArgs.serviceId)}-alb-redirect`,
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

        this.instrumentation = new monitoring.AppLoadbalancerInstrumentation(
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
