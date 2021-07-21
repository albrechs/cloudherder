import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as config from '../../config';
import * as utils from '../../utils';
import { createKMSKeyUsePolicy } from './iam';

export interface KMSKeyArgs {
    serviceId?: string;
}

export class KMSKey extends pulumi.ComponentResource {
    readonly key: pulumi.Output<aws.kms.Key>;
    readonly keyAlias: aws.kms.Alias;
    readonly keyUsePolicy: pulumi.Output<aws.iam.Policy>;

    constructor(name: string, kmsArgs: KMSKeyArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:KMSKey', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            kmsArgs.serviceId
        );

        const kmsKeyPolicy = pulumi
            .all([config.caller.accountId, config.caller.region])
            .apply(([accountId, region]) => ({
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
                        Action: [
                            'kms:Encrypt*',
                            'kms:Decrypt*',
                            'kms:ReEncrypt*',
                            'kms:GenerateDataKey*',
                            'kms:Describe*'
                        ],
                        Resource: '*',
                        Condition: {
                            ArnLike: {
                                'kms:EncryptionContext:aws:logs:arn': `arn:aws:logs:${region}:${accountId}:log-group:${resourcePrefix}-*`
                            }
                        }
                    }
                ]
            }));

        this.key = kmsKeyPolicy.apply(
            (policy) =>
                new aws.kms.Key(
                    'kms-key',
                    {
                        description: `KMS key used to encrypt resources related to the ${config.cloudherder.deploymentEnv}-${config.cloudherder.deploymentName} deployment at rest.`,
                        policy: JSON.stringify(policy),
                        tags: {
                            Name: `${resourcePrefix}-key`,
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
                name: `alias/${resourcePrefix}-key`
            },
            defaultResourceOptions
        );

        this.keyUsePolicy = createKMSKeyUsePolicy({
            kmsKeyAliasName: this.keyAlias.name
        });
    }
}
