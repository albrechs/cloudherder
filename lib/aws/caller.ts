import * as aws from '@pulumi/aws';

const callerIdentity = aws.getCallerIdentity();
export const accountId = callerIdentity.then((callerIdentity) => callerIdentity.accountId);

const getRegion = aws.getRegion();
export const region = getRegion.then((getRegion) => getRegion.name);
