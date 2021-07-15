import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as utils from '../../utils';
import { ServiceAccount } from '../identity';
import { accountId, region } from '../caller';

export interface SESFromEmailArgs {
    deploymentEnv: string;
    deploymentName: string;
    fromAccount: pulumi.Input<string>;
    domainIdentity: pulumi.Input<string>;
    createSmtpServiceAccount?: boolean;
    kmsKeyArn?: pulumi.Input<string>;
}

export class SESFromEmail extends pulumi.ComponentResource {
    readonly address: pulumi.Output<string>;
    readonly sendMailPolicy: pulumi.Output<aws.iam.Policy>;
    readonly smtpServiceAccount?: pulumi.Output<ServiceAccount>;

    constructor(name: string, mailArgs: SESFromEmailArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESFromEmail', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.address = pulumi.interpolate`${mailArgs.fromAccount}@${mailArgs.domainIdentity}`;

        this.sendMailPolicy = createSESSendMailPolicy({
            deploymentEnv: mailArgs.deploymentEnv,
            deploymentName: mailArgs.deploymentName,
            fromAddress: this.address,
            fromDomain: mailArgs.domainIdentity
        });

        if (mailArgs.createSmtpServiceAccount) {
            this.smtpServiceAccount = this.address.apply(
                (address) =>
                    new ServiceAccount('', {
                        deploymentEnv: mailArgs.deploymentEnv,
                        deploymentName: mailArgs.deploymentName,
                        serviceId: address.replace('@', '-'),
                        kmsKeyArn: mailArgs.kmsKeyArn,
                        createSmtpPassword: true
                    })
            );
        }
    }
}

interface SESFromEmailPolicyArgs {
    deploymentEnv: string;
    deploymentName: string;
    fromAddress: pulumi.Input<string>;
    fromDomain: pulumi.Input<string>;
}

function createSESSendMailPolicy(args: SESFromEmailPolicyArgs): pulumi.Output<aws.iam.Policy> {
    return pulumi
        .all([accountId, region, args.fromAddress, args.fromDomain])
        .apply(([accountId, region, fromAddress, fromDomain]) => {
            let sanitizedFromAddress = fromAddress.replace('@', '-');
            let policyAddressValue: string = '';
            if (fromAddress.charAt(0) === '*') {
                policyAddressValue = '*';
            } else {
                policyAddressValue = fromAddress;
            }
            const resourcePrefix = utils.buildResourcePrefix(
                args.deploymentEnv,
                args.deploymentName,
                sanitizedFromAddress
            );

            return new aws.iam.Policy(`ses-${sanitizedFromAddress}-send-raw-policy`, {
                name: `${resourcePrefix}-ses-send-policy`,
                path: '/',
                description: `${resourcePrefix} deployment SES SendMail permissions`,
                policy: {
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Sid: 'AllowSesSendPermission',
                            Effect: 'Allow',
                            Action: 'ses:SendRawEmail',
                            Resource: `arn:aws:ses:${region}:${accountId}:identity/${fromDomain}`,
                            Condition: {
                                'ForAnyValue:StringEquals': {
                                    'ses:FromAddress': policyAddressValue
                                }
                            }
                        }
                    ]
                },
                tags: {
                    Name: `${resourcePrefix}-ses-send-policy`,
                    pulumi: 'true'
                }
            });
        });
}
