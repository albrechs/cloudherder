import * as pulumi from '@pulumi/pulumi';

declare module 'cloudherder' {
    export const aws: {
        cloudwatch: {
            CloudwatchDashboard:
        },
        databases: ,
        email: ,
        identity: ,
        kms: ,
        loadbalancing: ,
    };
    export const config: {
        coudherder: pulumi.Output<{
            deploymentEnv: string;
            deploymentName: string;
        }>;
        caller: {
            accountId: Promise<string>;
            region: Promise<string>;
        };
    };
}
