import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as random from '@pulumi/random';
import * as defaults from './defaults';
import * as monitoring from './monitoring';
import * as backup from './backup';
import * as utils from '../../utils';
import { cloudwatch } from '../';
import { region } from '../caller';

export interface CloudherderDatabaseArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    vpcId: pulumi.Input<string>;
    subnetIds: pulumi.Input<Array<string>>;
    subnetAvailabityZones: pulumi.Input<Array<string>>;
    kmsKeyId?: pulumi.Input<string>;
    rdsSnapshotIdentifier: pulumi.Input<string>;
    rdsMultiAz?: boolean;
    rdsAutoMinorVersionUpgrade?: boolean;
    rdsEngine: 'postgres'; // | 'mysql' | 'mssql' (eventually);
    rdsEngineVersion?: pulumi.Input<string>;
    rdsParameterGroupName?: pulumi.Input<string>;
    rdsEnableIamAuth?: boolean;
    rdsInstanceClass: pulumi.Input<string>;
    rdsDeletionProtection: boolean;
    rdsSkipFinalSnapshot?: boolean;
    rdsBackupRetentionPeriod?: number;
    rdsBackupWindow?: string;
    rdsStorageType: pulumi.Input<string>;
    rdsAllocatedStorage: pulumi.Input<number>;
    rdsMasterUsername: pulumi.Input<string>;
    rdsMasterPasswordVersion: pulumi.Input<number>;
    createRdsReadReplica?: boolean;
    enableAwsBackupResources?: boolean;
    awsBackupRoleArn?: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class PostgresInstance extends pulumi.ComponentResource {
    readonly instance: aws.rds.Instance;
    readonly instanceMasterPasswordArn: pulumi.Output<string>;
    readonly securityGroup: aws.ec2.SecurityGroup;
    readonly subnetGroup: aws.rds.SubnetGroup;
    readonly instrumentation: pulumi.Output<monitoring.RDSInstrumentation>;
    readonly readReplica?: aws.rds.Instance;
    readonly backup?: backup.RDSBackup;

    /**
     * @param name The unique name of the resource
     * @param dbArgs The arguments to configure the database resources
     * @param opts Pulumi opts
     */
    constructor(name: string, dbArgs: CloudherderDatabaseArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:PostgresInstance', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.subnetGroup = new aws.rds.SubnetGroup(
            'rds-subnet-group',
            {
                name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db-subnet-grp`,
                subnetIds: dbArgs.subnetIds,
                tags: {
                    Name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db-subnet-grp`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.securityGroup = new aws.ec2.SecurityGroup(
            'rds-security-group',
            {
                description: 'Security group for the the cloudherder-web pulumi deployment RDS instance',
                vpcId: dbArgs.vpcId,
                tags: {
                    Name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-rds-sg`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        let masterPassword = new random.RandomPassword(
            'rds-random-master-password',
            {
                length: 32,
                special: true,
                minSpecial: 5,
                overrideSpecial: '!#$%^&*()-_=+[]{}<>:?',
                keepers: {
                    version: dbArgs.rdsMasterPasswordVersion
                }
            },
            defaultResourceOptions
        );

        let masterPasswordSsm = new aws.ssm.Parameter(
            'rds-ssm-master-password',
            {
                name: `/${dbArgs.deploymentEnv}/cloudherder-web/${dbArgs.deploymentName}/rds-master-password`,
                type: 'SecureString',
                keyId: dbArgs.kmsKeyId,
                value: masterPassword.result,
                tags: {
                    Name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-rds-master-password-ssm`,
                    pulumi: 'true'
                }
            },
            { parent: masterPassword }
        );

        this.instanceMasterPasswordArn = masterPasswordSsm.arn;

        let randDataSubnetAz = new random.RandomShuffle(
            'rds-random-az',
            {
                inputs: dbArgs.subnetAvailabityZones,
                resultCount: 1
            },
            defaultResourceOptions
        ).results[0];

        let encryptSwitch: boolean = false;
        if (dbArgs.kmsKeyId) {
            encryptSwitch = true;
        } else {
            encryptSwitch = false;
        }

        let engineArgs = defaults.getEngineConfig(dbArgs);

        this.instance = new aws.rds.Instance(
            'rds-instance',
            {
                identifier: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db`,
                snapshotIdentifier: dbArgs.rdsSnapshotIdentifier,
                instanceClass: dbArgs.rdsInstanceClass,
                deletionProtection: dbArgs.rdsDeletionProtection,
                enabledCloudwatchLogsExports: engineArgs.logNames,
                deleteAutomatedBackups: false,
                skipFinalSnapshot: utils.optionalBoolComponent(
                    'rdsSkipFinalSnapshot',
                    dbArgs.rdsSkipFinalSnapshot,
                    defaults.rds
                ),
                copyTagsToSnapshot: true,
                backupRetentionPeriod: utils.optionalNumberComponent(
                    'rdsBackupRetentionPeriod',
                    dbArgs.rdsBackupRetentionPeriod,
                    defaults.rds
                ),
                backupWindow: utils.optionalStringComponent('rdsBackupWindow', dbArgs.rdsBackupWindow, defaults.rds),
                autoMinorVersionUpgrade: utils.optionalBoolComponent(
                    'rdsAutoMinorVersionUpgrade',
                    dbArgs.rdsAutoMinorVersionUpgrade,
                    defaults.rds
                ),
                dbSubnetGroupName: this.subnetGroup.name,
                availabilityZone: randDataSubnetAz,
                multiAz: dbArgs.rdsMultiAz,
                vpcSecurityGroupIds: [this.securityGroup.id],
                engine: engineArgs.engineName,
                engineVersion: engineArgs.engineVersion,
                parameterGroupName: engineArgs.parameterGroupName,
                allocatedStorage: dbArgs.rdsAllocatedStorage,
                storageType: dbArgs.rdsStorageType,
                storageEncrypted: encryptSwitch,
                kmsKeyId: dbArgs.kmsKeyId,
                username: dbArgs.rdsMasterUsername,
                password: masterPassword.result,
                iamDatabaseAuthenticationEnabled: dbArgs.rdsEnableIamAuth,
                tags: {
                    Name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db`,
                    pulumi: 'true'
                }
            },
            { ...defaultResourceOptions, deleteBeforeReplace: true, ignoreChanges: ['kmsKeyId', 'snapshotIdentifier'] }
        );

        if (dbArgs.createRdsReadReplica) {
            this.readReplica = new aws.rds.Instance(
                'rds-read-replica',
                {
                    identifier: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db-replica`,
                    instanceClass: dbArgs.rdsInstanceClass,
                    replicateSourceDb: this.instance.arn,
                    storageEncrypted: true,
                    kmsKeyId: dbArgs.kmsKeyId,
                    backupRetentionPeriod: 0,
                    iamDatabaseAuthenticationEnabled: true,
                    tags: {
                        Name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db-replica`,
                        pulumi: 'true'
                    }
                },
                {
                    dependsOn: [this.instance],
                    parent: this.instance,
                    deleteBeforeReplace: true,
                    ignoreChanges: ['kmsKeyId', 'replicateSourceDb']
                }
            );
        }

        let logQueryArr: Array<cloudwatch.QueryArgs> = [];
        for (let i = 0; i < engineArgs.logErrorQueries.length; i++) {
            logQueryArr.push({
                name: `pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-${engineArgs.logErrorQueries[i].name}`,
                logGroupName: `/aws/rds/instance/pu-${dbArgs.deploymentEnv}-${dbArgs.deploymentName}-db/postgresql`,
                query: engineArgs.logErrorQueries[i].query
            });
        }

        if (dbArgs.enableAwsBackupResources) {
            this.backup = new backup.RDSBackup(
                'rds-aws-backup',
                {
                    deploymentEnv: dbArgs.deploymentEnv,
                    deploymentName: dbArgs.deploymentName,
                    kmsKeyArn: dbArgs.kmsKeyId,
                    rdsInstanceArn: this.instance.arn,
                    backupRoleArn: dbArgs.awsBackupRoleArn
                },
                { parent: this.instance }
            );
        }

        this.instrumentation = pulumi.all([this.instance]).apply(
            ([instance]) =>
                new monitoring.RDSInstrumentation(
                    'rds-instrumentation',
                    {
                        deploymentEnv: dbArgs.deploymentEnv,
                        deploymentName: dbArgs.deploymentName,
                        deploymentRegion: region,
                        rdsInstanceName: instance.identifier,
                        createDashboard: dbArgs.createDashboard,
                        logQueries: logQueryArr
                    },
                    defaultResourceOptions
                )
        );
    }
}
