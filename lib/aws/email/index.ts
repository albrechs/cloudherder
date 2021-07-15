import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as utils from '../../utils';
import * as monitoring from './monitoring';
import * as iam from './iam';
import { accountId, region } from '../caller';
import { SESBounceQueue } from './bounce-queue';

export interface SESDomainArgs {
    deploymentEnv: string;
    deploymentName: string;
    serviceId?: string;
    route53ZoneId: pulumi.Input<string>;
    mailFromDomainName: pulumi.Input<string>;
    mailFromAccounts: Array<string>;
    createSMTPServiceAccounts: boolean;
    kmsKeyId?: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class SESDomain extends pulumi.ComponentResource {
    readonly domainIdentity: aws.ses.DomainIdentity;
    readonly fromEmails?: Array<iam.SESFromEmail>;
    readonly bounceQueue: SESBounceQueue;
    readonly instrumentation: monitoring.SESDomainInstrumentation;

    constructor(name: string, sesArgs: SESDomainArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESDomain', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            sesArgs.deploymentEnv,
            sesArgs.deploymentName,
            sesArgs.serviceId
        );

        this.domainIdentity = new aws.ses.DomainIdentity(
            'ses-domain-identity',
            {
                domain: sesArgs.mailFromDomainName
            },
            defaultResourceOptions
        );

        if (sesArgs.mailFromAccounts.length > 0) {
            this.fromEmails = [];
            for (let i = 0; i < sesArgs.mailFromAccounts.length; i++) {
                this.fromEmails.push(
                    new iam.SESFromEmail(`ses-${sesArgs.mailFromAccounts[i]}-from-email-configuration`, {
                        deploymentEnv: sesArgs.deploymentEnv,
                        deploymentName: sesArgs.deploymentName,
                        fromAccount: sesArgs.mailFromAccounts[i],
                        domainIdentity: this.domainIdentity.domain,
                        createSmtpServiceAccount: sesArgs.createSMTPServiceAccounts,
                        kmsKeyArn: sesArgs.kmsKeyId
                    })
                );
            }
        }

        this.bounceQueue = new SESBounceQueue(
            `ses-${sesArgs.mailFromDomainName}-bounce-queue`,
            {
                deploymentEnv: sesArgs.deploymentEnv,
                deploymentName: sesArgs.deploymentName,
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

        this.instrumentation = new monitoring.SESDomainInstrumentation(
            'ses-instrumentation',
            {
                deploymentEnv: sesArgs.deploymentEnv,
                deploymentName: sesArgs.deploymentName,
                bounceQueueWidgets: this.bounceQueue.instrumentation.dashboardWidgets,
                createDashboard: sesArgs.createDashboard
            },
            defaultResourceOptions
        );
    }
}
