/**
 * PR-6 — local workbench mode. When LOCAL_MODE is enabled the app runs as a
 * single-user local workbench: no login wall, a provisioned local principal
 * owns every request. Auth code paths stay intact for non-local deployments.
 */
export function isLocalMode(): boolean {
  const v = process.env.LOCAL_MODE;
  return v === 'true' || v === '1';
}

export const LOCAL_USER_EMAIL = 'local@studio.local';
export const LOCAL_WORKSPACE_NAME = '我的工作区';
export const LOCAL_PROJECT_SKU = 'LOCAL-DEFAULT';
export const LOCAL_PROJECT_NAME = '默认项目';
