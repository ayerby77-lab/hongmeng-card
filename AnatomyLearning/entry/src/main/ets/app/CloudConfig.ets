// 云端问答配置（接口约定 §7）。
//
// CLOUD_FUNCTION_URL 为空串 → useCloud=false，走 TestCloudModelService（离线替身，可完整演示流程）；
// 配置为 CFKit 云函数 URL → useCloud=true，走 CloudModelProxy（真实云端联调）。

export const CLOUD_FUNCTION_URL: string = '';
export const CLOUD_MODEL: string = 'doubao-pro';
