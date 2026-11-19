import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'

const env = import.meta.env || {}
const endpoint = env.VITE_WORKBUDDY_ENDPOINT?.trim()
const publishableKey = env.VITE_WORKBUDDY_PUBLISHABLE_KEY?.trim()
const oauthRelayBaseUrl = env.VITE_WORKBUDDY_OAUTH_RELAY_BASE_URL?.trim()
  || 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'

export const cloud = endpoint && publishableKey
  ? createWorkBuddyCloud({ endpoint, oauthRelayBaseUrl, publishableKey })
  : null

export function requireCloud() {
  if (!cloud) throw new Error('请先配置 WorkBuddy Cloud 应用。配置方法见 README。')
  return cloud
}
