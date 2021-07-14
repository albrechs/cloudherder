import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

export interface BackupArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    rdsInstanceArn: pulumi.Input<string>;
    kmsKeyArn?: pulumi.Input<string>;
    backupRoleArn?: pulumi.Input<string>;
}

export class RDSBackup extends pulumi.ComponentResource {
    readonly vault: aws.backup.Vault;
    readonly vaultPolicy: pulumi.Output<aws.backup.VaultPolicy>;
    readonly plan: aws.backup.Plan;
    readonly selection: aws.backup.Selection;

    /**
     * @param name The unique name of the resource
     * @param backupArgs The arguments to configure the backup resources
     * @param opts Pulumi opts
     */
    constructor(name: string, backupArgs: BackupArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:RDSBackup', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.vault = new aws.backup.Vault(
            'aws-backup-vault',
            {
                name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-vault`,
                kmsKeyArn: backupArgs.kmsKeyArn,
                tags: {
                    Name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-vault`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        const VaultPolicyObj = pulumi.all([this.vault]).apply(([vault]) => ({
            Version: '2012-10-17',
            Id: `${backupArgs.deploymentName}VaultPolicy`,
            Statement: [
                {
                    Sid: 'default',
                    Effect: 'Allow',
                    Principal: {
                        AWS: '*'
                    },
                    Action: [
                        'backup:DescribeBackupVault',
                        'backup:DeleteBackupVault',
                        'backup:PutBackupVaultAccessPolicy',
                        'backup:DeleteBackupVaultAccessPolicy',
                        'backup:GetBackupVaultAccessPolicy',
                        'backup:StartBackupJob',
                        'backup:GetBackupVaultNotifications',
                        'backup:PutBackupVaultNotifications'
                    ],
                    Resource: vault.arn
                }
            ]
        }));

        this.vaultPolicy = pulumi.all([VaultPolicyObj]).apply(
            ([policy]) =>
                new aws.backup.VaultPolicy(
                    'aws-backup-vault-policy',
                    {
                        backupVaultName: this.vault.name,
                        policy: JSON.stringify(policy)
                    },
                    { parent: this.vault }
                )
        );

        this.plan = new aws.backup.Plan(
            'aws-backup-plan',
            {
                name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-plan`,
                rules: [
                    {
                        ruleName: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-rule-nightly`,
                        targetVaultName: this.vault.name,
                        startWindow: 60,
                        completionWindow: 180,
                        schedule: 'cron(0 7 * * ? *)',
                        lifecycle: {
                            coldStorageAfter: 30,
                            deleteAfter: 120
                        }
                    },
                    {
                        ruleName: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-rule-continuous`,
                        targetVaultName: this.vault.name,
                        enableContinuousBackup: true,
                        schedule: 'cron(0 7 * * ? *)',
                        lifecycle: {
                            deleteAfter: 7
                        }
                    }
                ],
                tags: {
                    Name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-plan`,
                    pulumi: 'true'
                }
            },
            { parent: this.vault }
        );

        let backupRoleArn: pulumi.Input<string> | undefined = backupArgs.backupRoleArn;
        if (backupRoleArn === undefined) {
            let backupRole = new aws.iam.Role(
                'aws-backup-role',
                {
                    name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-role`,
                    assumeRolePolicy: JSON.stringify({
                        Version: '2012-10-17',
                        Statement: [
                            {
                                Action: ['sts:AssumeRole'],
                                Effect: 'allow',
                                Principal: {
                                    Service: ['backup.amazonaws.com']
                                }
                            }
                        ]
                    }),
                    tags: {
                        Name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-role`,
                        pulumi: 'true'
                    }
                },
                defaultResourceOptions
            );
            backupRoleArn = backupRole.arn;

            new aws.iam.RolePolicyAttachment(
                'aws-backup-role-policy-attachment',
                {
                    policyArn: 'arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup',
                    role: backupRole.name
                },
                { parent: backupRole, dependsOn: [backupRole] }
            );
        }

        this.selection = new aws.backup.Selection(
            'aws-backup-selection',
            {
                name: `pu-${backupArgs.deploymentEnv}-${backupArgs.deploymentName}-backup-selection`,
                iamRoleArn: backupRoleArn,
                planId: this.plan.id,
                resources: [backupArgs.rdsInstanceArn]
            },
            { parent: this.plan }
        );
    }
}
