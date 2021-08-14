import * as pulumi from '@pulumi/pulumi';
import * as caller from './caller';

interface Data {
    deploymentEnv: string;
    deploymentName: string;
}

const config = new pulumi.Config();
const cloudherder = config.requireObject<Data>('cloudherder');

export {
    caller,
    cloudherder,
    Data
}
