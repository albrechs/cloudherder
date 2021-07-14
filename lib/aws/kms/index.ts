import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import { accountId, region } from '../caller';

export interface CloudherderKMSArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
}

export class CloudherderKMS extends pulumi.ComponentResource {
    readonly key: pulumi.Output<aws.kms.Key>;
    readonly keyAlias: aws.kms.Alias;

    constructor(name: string, kmsArgs: CloudherderKMSArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:kms', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        const kmsKeyUsePolicy = pulumi.all([accountId, region]).apply(([accountId, region]) => ({
            Version: '2012-10-17',
            Id: 'kms-deployment-key-policy',
            Statement: [
                {
                    Sid: 'AllowIAMPermissions',
                    Effect: 'Allow',
                    Principal: {
                        AWS: `arn:aws:iam::${accountId}:root`
                    },
                    Action: 'kms:*',
                    Resource: '*'
                },
                {
                    Sid: 'AllowLogExport',
                    Effect: 'Allow',
                    Principal: {
                        Service: `logs.${region}.amazonaws.com`
                    },
                    Action: ['kms:Encrypt*', 'kms:Decrypt*', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:Describe*'],
                    Resource: '*',
                    Condition: {
                        ArnEquals: {
                            'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${region}:${accountId}:log-group:pu-${kmsArgs.deploymentEnv}-${kmsArgs.deploymentName}-log-grp`
                        }
                    }
                }
            ]
        }));

        this.key = kmsKeyUsePolicy.apply(
            (policy) =>
                new aws.kms.Key(
                    'kms-key',
                    {
                        description: `KMS key used to encrypt resources related to the ${kmsArgs.deploymentEnv}-${kmsArgs.deploymentName} deployment at rest.`,
                        policy: JSON.stringify(policy),
                        tags: {
                            Name: `pu-${kmsArgs.deploymentEnv}-${kmsArgs.deploymentName}-key`,
                            pulumi: 'true'
                        }
                    },
                    defaultResourceOptions
                )
        );

        this.keyAlias = new aws.kms.Alias(
            'kms-key-alias',
            {
                targetKeyId: this.key.id,
                name: `alias/pu-${kmsArgs.deploymentEnv}-${kmsArgs.deploymentName}-key`
            },
            defaultResourceOptions
        );
    }
}
