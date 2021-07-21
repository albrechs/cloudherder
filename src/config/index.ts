import * as pulumi from '@pulumi/pulumi';

export interface Data {
    deploymentEnv: string;
    deploymentName: string;
}

const config = new pulumi.Config();
export const cloudherder = config.requireObject<Data>('cloudherder');

export * as caller from './caller';
