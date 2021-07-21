import * as pulumi from '@pulumi/pulumi';

// config handling functions
export function optionalStringConfig(configKey: string, defaults: object, config: pulumi.Config) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as string;

    return config.get(`${configKey}`) === undefined ? configDefaultValue : config.require(`${configKey}`);
}

export function optionalNumberConfig(configKey: string, defaults: object, config: pulumi.Config) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as number;

    return config.getNumber(`${configKey}`) === undefined ? configDefaultValue : config.requireNumber(`${configKey}`);
}

export function optionalBoolConfig(configKey: string, defaultsObj: object, config: pulumi.Config) {
    let typedConfigKey = configKey as keyof typeof defaultsObj;
    let configDefaultValue = defaultsObj[typedConfigKey] as boolean;

    return config.getBoolean(`${configKey}`) === undefined ? configDefaultValue : config.requireBoolean(`${configKey}`);
}

export function optionalStringComponentArg(configKey: string, passedValue: string | undefined, defaults: object) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as string;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

export function optionalNumberComponentArg(configKey: string, passedValue: number | undefined, defaults: object) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as number;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

export function optionalBoolComponentArg(configKey: string, passedValue: boolean | undefined, defaultsObj: object) {
    let typedConfigKey = configKey as keyof typeof defaultsObj;
    let configDefaultValue = defaultsObj[typedConfigKey] as boolean;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

// string transformation
export function capitalizeWord(string: pulumi.Input<string>): string {
    return string.toString().charAt(0).toUpperCase() + string.toString().slice(1);
}

export function insertServiceId(serviceId: pulumi.Input<string> | undefined): pulumi.Input<string> | undefined {
    if (serviceId != undefined) {
        return `-${serviceId}`;
    } else {
        return undefined;
    }
}

export function buildSSMPathPrefix(env: string, name: string, service?: string): string {
    let pathPrefix = `/${env}/${name}`;
    if (service) {
        pathPrefix += `/${service}`;
    }
    return pathPrefix;
}

export function buildResourcePrefix(env: string, name: string, service?: string): string {
    let resourcePrefix = `pu-${env}-${name}`;
    if (service) {
        resourcePrefix += `-${service}`;
    }
    return resourcePrefix;
}
