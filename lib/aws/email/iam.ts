import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { ServiceAccount } from '../identity';
import { accountId, region } from '../caller';

export interface SESFromEmailArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    accountId: Promise<string>;
    region: Promise<string>;
    fromAccount: pulumi.Input<string>;
    domainIdentity: pulumi.Input<string>;
    createSmtpServiceAccount?: boolean;
    kmsKeyArn?: pulumi.Input<string>;
}

export class SESFromEmail extends pulumi.ComponentResource {
    readonly address: pulumi.Output<string>;
    readonly sendMailPolicy: pulumi.Output<aws.iam.Policy>;
    readonly smtpServiceAccount?: ServiceAccount;

    constructor(name: string, mailArgs: SESFromEmailArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESFromEmail', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.address = pulumi.interpolate`${mailArgs.fromAccount}@${mailArgs.domainIdentity}`;

        this.sendMailPolicy = createSESSendMailPolicy({
            deploymentEnv: mailArgs.deploymentEnv,
            deploymentName: mailArgs.deploymentName,
            accountId: accountId,
            region: region,
            fromAddress: this.address,
            fromDomain: mailArgs.domainIdentity
        });

        if (mailArgs.createSmtpServiceAccount) {
            this.smtpServiceAccount = new ServiceAccount('', {
                deploymentEnv: mailArgs.deploymentEnv,
                deploymentName: mailArgs.deploymentName,
                serviceId: this.address.apply((address) => address.replace('@', '-')),
                region: region,
                kmsKeyArn: mailArgs.kmsKeyArn,
                createSmtpPassword: true
            });
        }
    }
}

interface SESFromEmailPolicyArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    accountId: Promise<string>;
    region: Promise<string>;
    fromAddress: pulumi.Input<string>;
    fromDomain: pulumi.Input<string>;
}

function createSESSendMailPolicy(args: SESFromEmailPolicyArgs): pulumi.Output<aws.iam.Policy> {
    return pulumi
        .all([args.accountId, args.region, args.fromAddress, args.fromDomain])
        .apply(([accountId, region, fromAddress, fromDomain]) => {
            let sanitizedFromAddress = fromAddress.replace('@', '-');
            let policyAddressValue: string = '';
            if (fromAddress.charAt(0) === '*') {
                policyAddressValue = '*';
            } else {
                policyAddressValue = fromAddress;
            }

            return new aws.iam.Policy(`ses-${sanitizedFromAddress}-send-raw-policy`, {
                name: `pu-${args.deploymentEnv}-${args.deploymentName}-${sanitizedFromAddress}-ses-send-policy`,
                path: '/',
                description: `${args.deploymentEnv}-${args.deploymentName}-${fromAddress} deployment SES SendMail permissions`,
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
                    Name: `pu-${args.deploymentEnv}-${args.deploymentName}-${sanitizedFromAddress}-ses-send-policy`,
                    pulumi: 'true'
                }
            });
        });
}
