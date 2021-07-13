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

export function optionalStringComponent(configKey: string, passedValue: string | undefined, defaults: object) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as string;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

export function optionalNumberComponent(configKey: string, passedValue: number | undefined, defaults: object) {
    let typedConfigKey = configKey as keyof typeof defaults;
    let configDefaultValue = defaults[typedConfigKey] as number;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

export function optionalBoolComponent(configKey: string, passedValue: boolean | undefined, defaultsObj: object) {
    let typedConfigKey = configKey as keyof typeof defaultsObj;
    let configDefaultValue = defaultsObj[typedConfigKey] as boolean;

    return passedValue === undefined ? configDefaultValue : passedValue;
}

// string transformation
export function capitalizeWord(string: pulumi.Input<string>): string {
    return string.toString().charAt(0).toUpperCase() + string.toString().slice(1);
}

export function sanitizeQueryString(string: string): string {
    let extraEscapeRemoved = string.split('\\n').join('\n');
    return extraEscapeRemoved.slice(1).slice(0, -1);
}

export interface dashQueryStringArgs {
    logGroupName: pulumi.Input<string>;
    baseErrorQuery: pulumi.Input<string>;
}

export function createDashboardQueryString(args: dashQueryStringArgs): string {
    let queryHead: string = `SOURCE '${args.logGroupName}'
    | fields @timestamp, @message`;

    return sanitizeQueryString(
        JSON.stringify(`${queryHead}
    | ${args.baseErrorQuery}`)
    );
}
