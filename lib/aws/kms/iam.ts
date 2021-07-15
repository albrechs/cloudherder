import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as utils from '../../utils';
import { accountId, region } from '../caller';

export interface KMSKeyUsePolicyArgs {
    deploymentEnv: string;
    deploymentName: string;
    serviceId?: string;
    kmsKeyAliasName: pulumi.Input<string>;
}

export function createKMSKeyUsePolicy(args: KMSKeyUsePolicyArgs): pulumi.Output<aws.iam.Policy> {
    const resourcePrefix = utils.buildResourcePrefix(args.deploymentEnv, args.deploymentName, args.serviceId);
    return pulumi.all([region, accountId]).apply(([region, accountId]) => {
        const arnPrefix = `arn:aws:kms:${region}:${accountId}`;
        return new aws.iam.Policy('kms-key-usage-iam-policy', {
            name: `${resourcePrefix}-task-kms-policy`,
            path: '/',
            description: `${resourcePrefix} deployment KMS key permissions`,
            policy: {
                Version: '2012-10-17',
                Statement: [
                    {
                        Sid: 'AllowCMKKMSEncryptedResourceAttachment',
                        Effect: 'Allow',
                        Action: ['kms:CreateGrant', 'kms:ListGrants', 'kms:RevokeGrant'],
                        Resource: `${arnPrefix}:key/*`,
                        Condition: {
                            'ForAnyValue:StringEquals': { 'kms:ResourceAliases': args.kmsKeyAliasName }
                        }
                    },
                    {
                        Sid: 'AllowCMKKMSKeyUse',
                        Effect: 'Allow',
                        Action: [
                            'kms:Encrypt',
                            'kms:Decrypt',
                            'kms:ReEncrypt*',
                            'kms:GenerateDataKey*',
                            'kms:DescribeKey'
                        ],
                        Resource: `${arnPrefix}:key/*`,
                        Condition: {
                            'ForAnyValue:StringEquals': { 'kms:ResourceAliases': args.kmsKeyAliasName }
                        }
                    },
                    {
                        Sid: 'AllowAWSManagedKMSEncryptedResourceAttachment',
                        Effect: 'Allow',
                        Action: ['kms:CreateGrant', 'kms:ListGrants', 'kms:RevokeGrant'],
                        Resource: `${arnPrefix}:key/aws/ssm`
                    },
                    {
                        Sid: 'AllowAWSManagedKMSKeyUse',
                        Effect: 'Allow',
                        Action: [
                            'kms:Encrypt',
                            'kms:Decrypt',
                            'kms:ReEncrypt*',
                            'kms:GenerateDataKey*',
                            'kms:DescribeKey'
                        ],
                        Resource: `${arnPrefix}:key/aws/ssm`
                    }
                ]
            },
            tags: {
                Name: `${resourcePrefix}-task-kms-policy`,
                pulumi: 'true'
            }
        });
    });
}
