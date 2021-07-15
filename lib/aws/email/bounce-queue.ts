import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as utils from '../../utils';
import * as monitoring from './bounce-queue-monitoring';
import { accountId } from '../caller';

export interface SESBounceQueueArgs {
    deploymentEnv: string;
    deploymentName: string;
    serviceId?: string;
    kmsKeyId?: pulumi.Input<string>;
}

export class SESBounceQueue extends pulumi.ComponentResource {
    readonly snsTopic: aws.sns.Topic;
    readonly sqsQueue: aws.sqs.Queue;
    readonly instrumentation: monitoring.SESBounceQueueInstrumentation;

    constructor(name: string, queueArgs: SESBounceQueueArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:SESBounceQueue', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };
        const resourcePrefix = utils.buildResourcePrefix(
            queueArgs.deploymentEnv,
            queueArgs.deploymentName,
            queueArgs.serviceId
        );

        this.snsTopic = new aws.sns.Topic(
            'bounce-sns-topic',
            {
                name: `${resourcePrefix}-bounce-sns-topic`,
                tags: {
                    Name: `${resourcePrefix}-bounce-sns-topic`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.sqsQueue = new aws.sqs.Queue(
            'bounce-sqs-queue',
            {
                name: `${resourcePrefix}-bounce-queue`,
                kmsMasterKeyId: queueArgs.kmsKeyId,
                tags: {
                    Name: `${resourcePrefix}-bounce-queue`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        let sqsQueuePolicyStatement = pulumi
            .all([this.sqsQueue.arn, this.snsTopic.arn, accountId])
            .apply(([queueArn, topicArn, account]) =>
                JSON.stringify({
                    Version: '2012-10-17',
                    Id: `${queueArgs.deploymentName}-bounce-sqs-policy`,
                    Statement: [
                        {
                            Sid: 'owner_statement',
                            Effect: 'Allow',
                            Principal: {
                                AWS: `arn:aws:iam::${account}:root`
                            },
                            Action: 'SQS:*',
                            Resource: queueArn
                        },
                        {
                            Sid: 'sns_subscription',
                            Effect: 'Allow',
                            Principal: {
                                AWS: '*'
                            },
                            Action: 'SQS:SendMessage',
                            Resource: queueArn,
                            Condition: {
                                ArnEquals: {
                                    'aws:SourceArn': topicArn
                                }
                            }
                        }
                    ]
                })
            );

        const sqsQueuePolicy = new aws.sqs.QueuePolicy(
            'bounce-sqs-queue-policy',
            {
                queueUrl: this.sqsQueue.id,
                policy: sqsQueuePolicyStatement
            },
            { parent: this.sqsQueue }
        );

        const snsTopicSubscription = new aws.sns.TopicSubscription(
            'bounce-sns-topic-subscription',
            {
                topic: this.snsTopic.arn,
                endpoint: this.sqsQueue.arn,
                protocol: 'sqs'
            },
            defaultResourceOptions
        );

        this.instrumentation = new monitoring.SESBounceQueueInstrumentation(
            'bounce-instrumentation',
            {
                deploymentEnv: queueArgs.deploymentEnv,
                deploymentName: queueArgs.deploymentName,
                snsTopicName: this.snsTopic.name,
                sqsQueueName: this.sqsQueue.name
            },
            defaultResourceOptions
        );
    }
}
