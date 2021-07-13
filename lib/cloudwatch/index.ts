import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';
import * as utils from '../utils';

export const queryFooter = `| sort @timestamp desc
    | limit 40`;

export interface CloudherderCloudwatchDashboardArgs {
    resourcePrefix: string;
    region: string;
    resourceWidgetSections: Array<pulumi.Input<Array<DashboardWidget>>>;
}

export class CloudherderCloudwatchDashboard extends pulumi.ComponentResource {
    readonly dashboard: pulumi.Output<aws.cloudwatch.Dashboard>;

    /**
     * a
     * s
     * d
     */
    constructor(name: string, cwArgs: CloudherderCloudwatchDashboardArgs, opts?: pulumi.ResourceOptions) {
        super('cloudherder:aws:cloudwatch', name, {}, opts);
        const defaultResourceOptions: pulumi.ResourceOptions = { parent: this };

        const stackedWidgets = pulumi
            .all([cwArgs.resourceWidgetSections])
            .apply(([sections]) => stackWidgetSections(sections));

        this.dashboard = pulumi.all([stackedWidgets]).apply(
            ([widgets]) =>
                new aws.cloudwatch.Dashboard(
                    'cw-stack-dashboard',
                    {
                        dashboardName: `${cwArgs.resourcePrefix}-dashboard`,
                        dashboardBody: JSON.stringify({
                            widgets: [
                                ...widgets.widgets,
                                createSectionHeader('Log Ingestion Metrics', widgets.floor),
                                {
                                    height: 3,
                                    width: 24,
                                    y: widgets.floor + 1,
                                    x: 0,
                                    type: 'metric',
                                    properties: {
                                        metrics: [
                                            [
                                                'AWS/Logs',
                                                'IncomingLogEvents',
                                                'LogGroupName',
                                                `${cwArgs.resourcePrefix}-log-grp`
                                            ],
                                            [
                                                '...',
                                                `/aws/ecs/containerinsights/${cwArgs.resourcePrefix}-ecs-cluster/performance`
                                            ],
                                            ['...', `/aws/rds/instance/${cwArgs.resourcePrefix}-db/postgresql`]
                                        ],
                                        view: 'singleValue',
                                        stacked: false,
                                        region: cwArgs.region,
                                        stat: 'Sum',
                                        period: 3600,
                                        title: 'Log Group Events per Hour'
                                    }
                                }
                            ]
                        })
                    },
                    defaultResourceOptions
                )
        );
    }
}

export interface CloudherderQueryArgs {
    name: pulumi.Input<string>;
    logGroupName: pulumi.Input<string>;
    query: pulumi.Input<string>;
}

export interface logWidgetArgs {
    x: number;
    y: number;
    logGroupName: pulumi.Input<string>;
    baseQuery: pulumi.Input<string>;
    title: pulumi.Input<string>;
    region: pulumi.Input<string>;
}

export function createLogWidget(args: logWidgetArgs): DashboardWidget {
    return new DashboardWidget({
        height: 6,
        width: 24,
        x: args.x,
        y: args.y,
        type: 'log',
        properties: {
            query: utils.createDashboardQueryString({
                logGroupName: args.logGroupName,
                baseErrorQuery: args.baseQuery
            }),
            region: args.region,
            stacked: false,
            title: args.title,
            view: 'table'
        }
    });
}

export interface logWidgetsArgs {
    y: number;
    queries: CloudherderQueryArgs[];
    region: pulumi.Input<string>;
}

export function createLogWidgets(args: logWidgetsArgs): DashboardWidget[] {
    let logWidgetArr: DashboardWidget[] = [];
    let xCount = 0;
    let yCount = args.y;

    for (let i = 0; i < args.queries.length; i++) {
        logWidgetArr.push(
            createLogWidget({
                title: `${args.queries[i].name} Loq Query Results`,
                x: xCount,
                y: yCount,
                logGroupName: args.queries[i].logGroupName,
                baseQuery: args.queries[i].query,
                region: args.region
            })
        );
        yCount = yCount + 6;
    }

    return logWidgetArr;
}

export function createSectionHeader(title: string, y?: number): DashboardWidget {
    if (!y) {
        y = 0;
    }
    return new DashboardWidget({
        height: 1,
        width: 24,
        y: y,
        x: 0,
        type: 'text',
        properties: {
            markdown: `# ${title}`
        }
    });
}

export interface DashboardWidgetArgs {
    height: number;
    width: 6 | 12 | 24;
    x: number;
    y: number;
    type: string;
    properties: object;
}

export class DashboardWidget {
    readonly height: number;
    readonly width: 6 | 12 | 24;
    readonly x: number;
    y: number;
    readonly type: pulumi.Input<string>;
    readonly properties: object;

    constructor(args: DashboardWidgetArgs) {
        this.height = args.height;
        this.width = args.width;
        this.x = args.x;
        this.y = args.y;
        this.type = args.type;
        this.properties = args.properties;
    }
}

interface WidgetStack {
    floor: number;
    widgets: Array<DashboardWidget>;
}

function stackWidgetSections(widgets: Array<Array<DashboardWidget>>): WidgetStack {
    let widgetStack: WidgetStack = {
        floor: 0,
        widgets: []
    };

    let sectionYStart: number = 0;

    for (let i = 0; i < widgets.length; i++) {
        for (let x = 0; x < widgets[i].length; x++) {
            if (sectionYStart == 0) {
                widgetStack.widgets.push(widgets[i][x]);
            } else {
                widgets[i][x].y += sectionYStart;
                widgetStack.widgets.push(widgets[i][x]);
            }
        }
        sectionYStart = getNextStart(getLastWidgetArrElement(widgetStack.widgets));
    }
    widgetStack.floor = getNextStart(getLastWidgetArrElement(widgetStack.widgets));
    return widgetStack;
}

function getNextStart(widget: DashboardWidget): number {
    return widget.height + widget.y;
}

function getLastWidgetArrElement(arr: DashboardWidget[]): DashboardWidget {
    return arr[arr.length - 1];
}
