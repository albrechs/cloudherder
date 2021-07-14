import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as crypto from 'crypto';
import * as utils from '../../utils';

export interface ServiceAccountArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    region: Promise<string>;
    serviceId?: pulumi.Input<string>;
    kmsKeyArn?: pulumi.Input<string>;
    createSmtpPassword?: boolean;
}

export class ServiceAccount extends pulumi.ComponentResource {
    readonly serviceAccount: aws.iam.User;
    readonly serviceAccountAccessKeyId: pulumi.Output<string>;
    readonly serviceAccountSecretAccessKeyArn: pulumi.Output<string>;
    readonly serviceAccountSmtpPasswordArn?: pulumi.Output<string>;

    constructor(name: string, svcAcctArgs: ServiceAccountArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:ServiceAccount', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.serviceAccount = new aws.iam.User(
            `iam${utils.insertServiceId(svcAcctArgs.serviceId)}-svc-account`,
            {
                name: `pu-${svcAcctArgs.deploymentEnv}-${svcAcctArgs.deploymentName}${utils.insertServiceId(
                    svcAcctArgs.serviceId
                )}-svc-account`,
                tags: {
                    Name: `pu-${svcAcctArgs.deploymentEnv}-${svcAcctArgs.deploymentName}${utils.insertServiceId(
                        svcAcctArgs.serviceId
                    )}-svc-account`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        let ssmPathPrefix = `/${svcAcctArgs.deploymentEnv}/${svcAcctArgs.deploymentName}`;
        if (svcAcctArgs.serviceId) {
            ssmPathPrefix = ssmPathPrefix + `/${svcAcctArgs.serviceId}`;
        }
        const serviceAccountCreds = new aws.iam.AccessKey(
            `iam${utils.insertServiceId(svcAcctArgs.serviceId)}-svc-account-keys`,
            {
                user: this.serviceAccount.id
            },
            { parent: this.serviceAccount }
        );

        const serviceAccountAccessKeyIdSsm = new aws.ssm.Parameter(
            `iam-ssm${utils.insertServiceId(svcAcctArgs.serviceId)}-svc-account-key-id`,
            {
                name: `${ssmPathPrefix}/aws-access-key-id`,
                type: 'String',
                value: serviceAccountCreds.id,
                tags: {
                    Name: `pu-${svcAcctArgs.deploymentEnv}-${svcAcctArgs.deploymentName}${utils.insertServiceId(
                        svcAcctArgs.serviceId
                    )}-access-key-id-ssm`,
                    pulumi: 'true'
                }
            },
            { parent: serviceAccountCreds }
        );

        this.serviceAccountAccessKeyId = serviceAccountCreds.id;

        const serviceAccountSecretAccessKeySsm = new aws.ssm.Parameter(
            `iam-ssm${utils.insertServiceId(svcAcctArgs.serviceId)}-svc-account-secret-key`,
            {
                name: `${ssmPathPrefix}/aws-secret-access-key`,
                type: 'SecureString',
                keyId: svcAcctArgs.kmsKeyArn,
                value: serviceAccountCreds.secret,
                tags: {
                    Name: `pu-${svcAcctArgs.deploymentEnv}-${svcAcctArgs.deploymentName}${utils.insertServiceId(
                        svcAcctArgs.serviceId
                    )}-secret-access-key-ssm`,
                    pulumi: 'true'
                }
            },
            { parent: serviceAccountCreds }
        );

        this.serviceAccountSecretAccessKeyArn = serviceAccountSecretAccessKeySsm.arn;

        if (svcAcctArgs.createSmtpPassword) {
            const serviceAccountSmtpPasswordSsm = new aws.ssm.Parameter(
                `iam-ssm${utils.insertServiceId(svcAcctArgs.serviceId)}-svc-account-smtp-password`,
                {
                    name: `${ssmPathPrefix}/smtp-password`,
                    type: 'SecureString',
                    keyId: svcAcctArgs.kmsKeyArn,
                    value: generateSmtpPasswordFromIamKey(serviceAccountCreds.secret, svcAcctArgs.region),
                    tags: {
                        Name: `pu-${svcAcctArgs.deploymentEnv}-${svcAcctArgs.deploymentName}${utils.insertServiceId(
                            svcAcctArgs.serviceId
                        )}-svc-account-smtp-password-ssm`,
                        pulumi: 'true'
                    }
                },
                { parent: serviceAccountCreds }
            );
            this.serviceAccountSmtpPasswordArn = serviceAccountSmtpPasswordSsm.arn;
        }
    }
}

function sign(msg: string, key: string | Buffer): Buffer {
    return crypto.createHmac('sha256', key).update(msg).digest();
}

function generateSmtpPasswordFromIamKey(
    iamKey: pulumi.Input<string>,
    region: pulumi.Input<string>
): pulumi.Output<string> {
    const date = '11111111';
    const service = 'ses';
    const terminal = 'aws4_request';
    const message = 'SendRawEmail';
    const versionBytes = Buffer.from([0x04]);

    return pulumi.all([iamKey, region]).apply(([key, region]) => {
        let signature = sign(date, `AWS4${key}`);
        signature = sign(region, signature);
        signature = sign(service, signature);
        signature = sign(terminal, signature);
        signature = sign(message, signature);

        let sigAndVer = Buffer.concat([versionBytes, signature]);
        return sigAndVer.toString('base64');
    });
}
