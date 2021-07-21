declare namespace cloudwatch {
    export class CloudwatchDashboard {}
    export class DashboardWidget {}
    export const queryFooter: string;
    export function createDashboardQueryString(args: dashQueryStringArgs): string;
    export function createLogWidget(args: LogWidgetArgs): DashboardWidget;
    export function createLogWidgets(args: logWidgetsArgs): DashboardWidget[];
    export function createSectionHeader(title: string, y?: number): DashboardWidget;
    export function sanitizeQueryString(string: string): string;
    export interface CloudwatchDashboardArgs {}
    export interface DashboardWidgetArgs {}
    export interface dashQueryStringArgs {}
    export interface LogWidgetArgs {}
    export interface logWidgetsArgs {}
    export interface QueryArgs {}
}
