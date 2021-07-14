import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface KMSKeyUsePolicyArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    accountId: Promise<string>;
    region: Promise<string>;
    kmsKeyAliasName: pulumi.Input<string>;
}

export function createKMSKeyUsePolicy(args: KMSKeyUsePolicyArgs): aws.iam.Policy {
    return new aws.iam.Policy('kms-key-usage-iam-policy', {
        name: `pu-${args.deploymentEnv}-${args.deploymentName}-task-kms-policy`,
        path: '/',
        description: `${args.deploymentEnv}-${args.deploymentName} deployment KMS key permissions`,
        policy: {
            Version: '2012-10-17',
            Statement: [
                {
                    Sid: 'AllowCMKKMSEncryptedResourceAttachment',
                    Effect: 'Allow',
                    Action: ['kms:CreateGrant', 'kms:ListGrants', 'kms:RevokeGrant'],
                    Resource: `arn:aws:kms:${args.region}:${args.accountId}:key/*`,
                    Condition: {
                        'ForAnyValue:StringEquals': { 'kms:ResourceAliases': args.kmsKeyAliasName }
                    }
                },
                {
                    Sid: 'AllowCMKKMSKeyUse',
                    Effect: 'Allow',
                    Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
                    Resource: `arn:aws:kms:${args.region}:${args.accountId}:key/*`,
                    Condition: {
                        'ForAnyValue:StringEquals': { 'kms:ResourceAliases': args.kmsKeyAliasName }
                    }
                },
                {
                    Sid: 'AllowAWSManagedKMSEncryptedResourceAttachment',
                    Effect: 'Allow',
                    Action: ['kms:CreateGrant', 'kms:ListGrants', 'kms:RevokeGrant'],
                    Resource: `arn:aws:kms:${args.region}:${args.accountId}:key/aws/ssm`
                },
                {
                    Sid: 'AllowAWSManagedKMSKeyUse',
                    Effect: 'Allow',
                    Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:ReEncrypt*', 'kms:GenerateDataKey*', 'kms:DescribeKey'],
                    Resource: `arn:aws:kms:${args.region}:${args.accountId}:key/aws/ssm`
                }
            ]
        },
        tags: {
            Name: `pu-${args.deploymentEnv}-${args.deploymentName}-task-kms-policy`,
            pulumi: 'true'
        }
    });
}
