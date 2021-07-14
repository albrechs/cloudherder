import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as monitoring from './monitoring';
import { CloudherderBounceQueue } from './bounce-queue';
import { accountId, region } from '../caller';

export interface CloudherderSESArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    route53ZoneId: Promise<string>;
    mailFromDomainName: pulumi.Input<string>;
    mailFromAccounts: Array<string>;
    kmsKeyId?: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class CloudherderSES extends pulumi.ComponentResource {
    readonly domainIdentity: aws.ses.DomainIdentity;
    readonly fromEmails: Array<pulumi.Output<string>>;
    readonly bounceQueue: CloudherderBounceQueue;
    readonly instrumentation: monitoring.CloudherderSESInstrumentation;

    constructor(name: string, sesArgs: CloudherderSESArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:ses', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.domainIdentity = new aws.ses.DomainIdentity(
            'ses-domain-identity',
            {
                domain: sesArgs.mailFromDomainName
            },
            defaultResourceOptions
        );

        this.fromEmails = [];
        pulumi.all([sesArgs.mailFromDomainName]).apply(([domain]) => {
            for (let i = 0; i < sesArgs.mailFromAccounts.length; i++) {
                this.fromEmails.push(pulumi.interpolate`${sesArgs.mailFromAccounts[i]}@${domain}`);
            }
        });

        this.bounceQueue = new CloudherderBounceQueue(
            `${sesArgs.mailFromDomainName}-bounce-queue`,
            {
                deploymentEnv: sesArgs.deploymentEnv,
                deploymentRegion: region,
                deploymentName: sesArgs.deploymentName,
                accountId: accountId,
                kmsKeyId: sesArgs.kmsKeyId
            },
            defaultResourceOptions
        );

        let sesNotificationTypes = ['Bounce', 'Complaint', 'Delivery'];
        const identityNotifications: aws.ses.IdentityNotificationTopic[] = sesNotificationTypes.map(
            (type) =>
                new aws.ses.IdentityNotificationTopic(
                    `ses-${type.toLowerCase()}-notification-topic`,
                    {
                        notificationType: type,
                        topicArn: this.bounceQueue.snsTopic.arn,
                        identity: this.domainIdentity.domain,
                        includeOriginalHeaders: true
                    },
                    { parent: this.domainIdentity }
                )
        );

        const domainDkim = new aws.ses.DomainDkim(
            'ses-domain-dkim',
            {
                domain: this.domainIdentity.domain
            },
            {
                dependsOn: [this.domainIdentity],
                parent: this.domainIdentity
            }
        );

        const dkimRecords = domainDkim.dkimTokens.apply((tokens) => {
            tokens.map((token, index) => {
                new aws.route53.Record(
                    `ses-dkim-record-${index}`,
                    {
                        zoneId: sesArgs.route53ZoneId,
                        name: `${token}._domainkey.${sesArgs.mailFromDomainName}`,
                        type: 'CNAME',
                        ttl: 600,
                        records: [`${token}.dkim.amazonses.com`]
                    },
                    { parent: domainDkim }
                );
            });
        });

        const mxRecord = new aws.route53.Record(
            'ses-mx-record',
            {
                zoneId: sesArgs.route53ZoneId,
                name: sesArgs.mailFromDomainName,
                type: 'MX',
                ttl: 600,
                records: [`10 inbound-smtp.${region}.amazonses.com`, `10 inbound-smtp.${region}.amazonaws.com`]
            },
            { parent: this.domainIdentity }
        );

        const spfRecord = new aws.route53.Record(
            'ses-spf-record',
            {
                zoneId: sesArgs.route53ZoneId,
                name: sesArgs.mailFromDomainName,
                type: 'TXT',
                ttl: 600,
                records: ['v=spf1 include:amazonses.com -all']
            },
            { parent: this.domainIdentity }
        );

        const domainVerificationRecord = new aws.route53.Record(
            'ses-domain-verification-record',
            {
                zoneId: sesArgs.route53ZoneId,
                name: `_amazonses.${sesArgs.mailFromDomainName}`,
                type: 'TXT',
                ttl: 600,
                records: [this.domainIdentity.verificationToken]
            },
            { parent: this.domainIdentity }
        );

        const domainIdentityVerification = new aws.ses.DomainIdentityVerification(
            'ses-domain-identity-verification',
            {
                domain: this.domainIdentity.domain
            },
            {
                dependsOn: [this.domainIdentity, domainVerificationRecord],
                parent: this.domainIdentity
            }
        );

        this.instrumentation = new monitoring.CloudherderSESInstrumentation(
            'ses-instrumentation',
            {
                deploymentEnv: sesArgs.deploymentEnv,
                deploymentName: sesArgs.deploymentName,
                deploymentRegion: region,
                bounceQueueWidgets: this.bounceQueue.instrumentation.dashboardWidgets,
                createDashboard: sesArgs.createDashboard
            },
            defaultResourceOptions
        );
    }
}
