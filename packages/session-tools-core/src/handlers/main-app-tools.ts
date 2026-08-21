import type { SessionToolContext } from '../context.ts';
import type { ToolResult } from '../types.ts';
import { errorResponse, successResponse } from '../response.ts';

export interface MainAppListTabsArgs {}
export interface MainAppSwitchTabArgs { target: string }
export interface MainAppCloseTabArgs { target: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function handleMainAppListTabs(
  ctx: SessionToolContext,
  _args: MainAppListTabsArgs,
): Promise<ToolResult> {
  if (!ctx.listMainAppTabs) {
    return errorResponse('main_app_list_tabs is unavailable. Open this workspace in the desktop app.');
  }
  try {
    return successResponse(JSON.stringify(await ctx.listMainAppTabs(), null, 2));
  } catch (error) {
    return errorResponse(`Failed to list main App tabs: ${errorMessage(error)}`);
  }
}

export async function handleMainAppSwitchTab(
  ctx: SessionToolContext,
  args: MainAppSwitchTabArgs,
): Promise<ToolResult> {
  if (!ctx.switchMainAppTab) {
    return errorResponse('main_app_switch_tab is unavailable. Open this workspace in the desktop app.');
  }
  try {
    return successResponse(JSON.stringify(await ctx.switchMainAppTab(args.target), null, 2));
  } catch (error) {
    return errorResponse(`Failed to switch main App tab: ${errorMessage(error)}`);
  }
}

export async function handleMainAppCloseTab(
  ctx: SessionToolContext,
  args: MainAppCloseTabArgs,
): Promise<ToolResult> {
  if (!ctx.closeMainAppTab) {
    return errorResponse('main_app_close_tab is unavailable. Open this workspace in the desktop app.');
  }
  try {
    return successResponse(JSON.stringify(await ctx.closeMainAppTab(args.target), null, 2));
  } catch (error) {
    return errorResponse(`Failed to close main App tab: ${errorMessage(error)}`);
  }
}
