import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface ListAppsArgs {}
export interface OpenAppArgs { appId: string }
export interface CloseAppArgs { appId: string }
export interface CallWebToolArgs {
  appId: string;
  functionName: string;
  arguments?: Record<string, unknown>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleListApps(ctx: SessionToolContext, _args: ListAppsArgs): Promise<ToolResult> {
  if (!ctx.listApps) return errorResponse('list_apps is unavailable. Open this workspace in the desktop app.');
  try {
    const apps = await ctx.listApps();
    return successResponse(JSON.stringify(apps, null, 2));
  } catch (error) {
    return errorResponse(`Failed to list apps: ${message(error)}`);
  }
}

export async function handleOpenApp(ctx: SessionToolContext, args: OpenAppArgs): Promise<ToolResult> {
  if (!ctx.openApp) return errorResponse('open_app is unavailable. Open this workspace in the desktop app.');
  try {
    return successResponse(JSON.stringify(await ctx.openApp(args.appId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to open app: ${message(error)}`);
  }
}

export async function handleCloseApp(ctx: SessionToolContext, args: CloseAppArgs): Promise<ToolResult> {
  if (!ctx.closeApp) return errorResponse('close_app is unavailable. Open this workspace in the desktop app.');
  try {
    return successResponse(JSON.stringify(await ctx.closeApp(args.appId), null, 2));
  } catch (error) {
    return errorResponse(`Failed to close app: ${message(error)}`);
  }
}

export async function handleCallWebTool(ctx: SessionToolContext, args: CallWebToolArgs): Promise<ToolResult> {
  if (!ctx.callWebTool) return errorResponse('call_webtool is unavailable. Open this workspace in the desktop app.');
  try {
    const result = await ctx.callWebTool(args.appId, args.functionName, args.arguments ?? {});
    const structuredContent = result && typeof result === 'object' && !Array.isArray(result)
      ? result as Record<string, unknown>
      : { result };
    return {
      content: [{ type: 'text', text: JSON.stringify(result ?? null, null, 2) }],
      structuredContent,
      isError: false,
    };
  } catch (error) {
    return errorResponse(`WebTool call failed: ${message(error)}`);
  }
}
