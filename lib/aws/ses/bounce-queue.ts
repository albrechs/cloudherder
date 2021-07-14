import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as monitoring from './bounce-queue-monitoring';

export interface CloudherderBounceQueueArgs {
    deploymentEnv: pulumi.Input<string>;
    deploymentRegion: pulumi.Input<string>;
    deploymentName: pulumi.Input<string>;
    accountId: pulumi.Input<string>;
    kmsKeyId?: pulumi.Input<string>;
}

export class CloudherderBounceQueue extends pulumi.ComponentResource {
    readonly snsTopic: aws.sns.Topic;
    readonly sqsQueue: aws.sqs.Queue;
    readonly instrumentation: monitoring.CloudherderBounceQueueInstrumentation;

    constructor(name: string, queueArgs: CloudherderBounceQueueArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:bounceQueue', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        this.snsTopic = new aws.sns.Topic(
            'bounce-sns-topic',
            {
                name: `pu-${queueArgs.deploymentEnv}-${queueArgs.deploymentName}-bounce-sns-topic`,
                tags: {
                    Name: `pu-${queueArgs.deploymentEnv}-${queueArgs.deploymentName}-bounce-sns-topic`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        this.sqsQueue = new aws.sqs.Queue(
            'bounce-sqs-queue',
            {
                name: `pu-${queueArgs.deploymentEnv}-${queueArgs.deploymentName}-bounce-queue`,
                kmsMasterKeyId: queueArgs.kmsKeyId,
                tags: {
                    Name: `pu-${queueArgs.deploymentEnv}-${queueArgs.deploymentName}-bounce-queue`,
                    pulumi: 'true'
                }
            },
            defaultResourceOptions
        );

        let sqsQueuePolicyStatement = pulumi
            .all([this.sqsQueue.arn, this.snsTopic.arn, queueArgs.accountId])
            .apply(([queueArn, topicArn, accountId]) =>
                JSON.stringify({
                    Version: '2012-10-17',
                    Id: `${queueArgs.deploymentName}-bounce-sqs-policy`,
                    Statement: [
                        {
                            Sid: 'owner_statement',
                            Effect: 'Allow',
                            Principal: {
                                AWS: `arn:aws:iam::${accountId}:root`
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

        this.instrumentation = new monitoring.CloudherderBounceQueueInstrumentation(
            'bounce-instrumentation',
            {
                deploymentEnv: queueArgs.deploymentEnv,
                deploymentName: queueArgs.deploymentName,
                deploymentRegion: queueArgs.deploymentRegion,
                snsTopicName: this.snsTopic.name,
                sqsQueueName: this.sqsQueue.name
            },
            defaultResourceOptions
        );
    }
}
