import * as pulumi from '@pulumi/pulumi';
import { queryFooter } from '../cloudwatch';
import { CloudherderDatabaseArgs } from '.';

export interface DbErrorQuery {
    name: string;
    query: string;
}

export interface EngineDefaultConfig {
    engineName: pulumi.Input<string>;
    engineVersion: pulumi.Input<string>;
    parameterGroupName: pulumi.Input<string>;
    logNames: Array<string>;
    logErrorQueries: Array<DbErrorQuery>;
}

export const rds = {
    rdsAutoMinorVersionUpgrade: true,
    rdsSkipFinalSnapshot: true,
    rdsBackupRetentionPeriod: 7,
    rdsBackupWindow: '09:17-09:47'
};

export const engineArgs = {
    postgres: {
        engineName: 'postgres',
        engineVersion: '12.5',
        parameterGroupName: 'default.postgres12',
        logNames: ['postgresql', 'upgrade'],
        logErrorQueries: [
            {
                name: 'psql-error-query',
                query: `filter @message not like /:LOG:/
    | parse @message '* * *:*(*):*@*:[*]:*: *' as date,time,timezone,sourceIp,sourcePort,username,database,pid,level,message
    | filter level not in ['LOG']
    | display @logStream,@timestamp,sourceIp,username,database,pid,level,message
    ${queryFooter}`
            } as DbErrorQuery
        ]
    } as EngineDefaultConfig
};

export function getEngineConfig(passedArgs: CloudherderDatabaseArgs): EngineDefaultConfig {
    let engineName = passedArgs.rdsEngine;
    const typedEngineKey = engineName as keyof typeof engineArgs;
    const defaultValues = engineArgs[typedEngineKey];

    let engineVersion: pulumi.Input<string>, parameterGroupName: pulumi.Input<string>;

    if (passedArgs.rdsEngineVersion) {
        engineVersion = passedArgs.rdsEngineVersion;
    } else {
        engineVersion = defaultValues.engineVersion;
    }

    if (passedArgs.rdsParameterGroupName) {
        parameterGroupName = passedArgs.rdsParameterGroupName;
    } else {
        parameterGroupName = defaultValues.parameterGroupName;
    }

    return {
        engineName: engineName,
        engineVersion: engineVersion,
        parameterGroupName: parameterGroupName,
        logNames: defaultValues.logNames,
        logErrorQueries: defaultValues.logErrorQueries
    } as EngineDefaultConfig;
}
