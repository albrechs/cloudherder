import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as random from '@pulumi/random';
import * as config from '../../config';
import * as utils from '../../utils';
import * as defaults from './defaults';
import * as monitoring from './monitoring';
import * as backup from './backup';
import { cloudwatch } from '..';

export interface RDSInstanceArgs {
    serviceId?: string;
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
    rdsStorageType?: pulumi.Input<string>;
    rdsAllocatedStorage: pulumi.Input<number>;
    rdsMasterUsername?: pulumi.Input<string>;
    rdsMasterPasswordVersion: pulumi.Input<number>;
    createRdsReadReplica?: boolean;
    enableAwsBackupResources?: boolean;
    awsBackupRoleArn?: pulumi.Input<string>;
    createDashboard?: boolean;
}

export class RDSInstance extends pulumi.ComponentResource {
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
    constructor(name: string, dbArgs: RDSInstanceArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:RDSInstance', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            dbArgs.serviceId
        );

        this.subnetGroup = new aws.rds.SubnetGroup(
            'rds-subnet-group',
            {
                name: `${resourcePrefix}-db-subnet-grp`,
                subnetIds: dbArgs.subnetIds,
                tags: {
                    Name: `${resourcePrefix}-db-subnet-grp`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.securityGroup = new aws.ec2.SecurityGroup(
            'rds-security-group',
            {
                description: 'Security group for the the cloudherder pulumi deployment RDS instance',
                vpcId: dbArgs.vpcId,
                tags: {
                    Name: `${resourcePrefix}-rds-sg`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        const masterPassword = new random.RandomPassword(
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

        const ssmPathPrefix = utils.buildSSMPathPrefix(
            config.cloudherder.deploymentEnv,
            config.cloudherder.deploymentName,
            dbArgs.serviceId
        );

        const masterPasswordSsm = new aws.ssm.Parameter(
            'rds-ssm-master-password',
            {
                name: `/${config.cloudherder.deploymentEnv}/cloudherder-web/${config.cloudherder.deploymentName}/rds-master-password`,
                type: 'SecureString',
                keyId: dbArgs.kmsKeyId,
                value: masterPassword.result,
                tags: {
                    Name: `${resourcePrefix}-rds-master-password-ssm`,
                    pulumi: 'true'
                }
            },
            { parent: masterPassword }
        );

        this.instanceMasterPasswordArn = masterPasswordSsm.arn;

        const randDataSubnetAz = new random.RandomShuffle(
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

        const engineArgs = defaults.getEngineConfig(dbArgs);

        this.instance = new aws.rds.Instance(
            'rds-instance',
            {
                identifier: `${resourcePrefix}-db`,
                snapshotIdentifier: dbArgs.rdsSnapshotIdentifier,
                instanceClass: dbArgs.rdsInstanceClass,
                deletionProtection: dbArgs.rdsDeletionProtection,
                enabledCloudwatchLogsExports: engineArgs.logNames,
                deleteAutomatedBackups: false,
                skipFinalSnapshot: utils.optionalBoolComponentArg(
                    'rdsSkipFinalSnapshot',
                    dbArgs.rdsSkipFinalSnapshot,
                    defaults.rds
                ),
                copyTagsToSnapshot: true,
                backupRetentionPeriod: utils.optionalNumberComponentArg(
                    'rdsBackupRetentionPeriod',
                    dbArgs.rdsBackupRetentionPeriod,
                    defaults.rds
                ),
                backupWindow: dbArgs.rdsBackupWindow,
                autoMinorVersionUpgrade: dbArgs.rdsAutoMinorVersionUpgrade,
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
                    Name: `${resourcePrefix}-db`,
                    pulumi: 'true'
                }
            },
            { ...defaultResourceOptions, deleteBeforeReplace: true, ignoreChanges: ['kmsKeyId', 'snapshotIdentifier'] }
        );

        if (dbArgs.createRdsReadReplica) {
            this.readReplica = new aws.rds.Instance(
                'rds-read-replica',
                {
                    identifier: `${resourcePrefix}-db-replica`,
                    instanceClass: dbArgs.rdsInstanceClass,
                    replicateSourceDb: this.instance.arn,
                    storageEncrypted: true,
                    kmsKeyId: dbArgs.kmsKeyId,
                    backupRetentionPeriod: 0,
                    iamDatabaseAuthenticationEnabled: true,
                    tags: {
                        Name: `${resourcePrefix}-db-replica`,
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
                name: `${resourcePrefix}-${engineArgs.logErrorQueries[i].name}`,
                logGroupName: `/aws/rds/instance/${resourcePrefix}-db/postgresql`,
                query: engineArgs.logErrorQueries[i].query
            });
        }

        if (dbArgs.enableAwsBackupResources) {
            this.backup = new backup.RDSBackup(
                'rds-aws-backup',
                {
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
                        rdsInstanceName: instance.identifier,
                        createDashboard: dbArgs.createDashboard,
                        logQueries: logQueryArr
                    },
                    defaultResourceOptions
                )
        );
    }
}
