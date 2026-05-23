// Anthropic OAuth configuration
// To use OAuth:
// 1. Register an OAuth application at https://console.anthropic.com/settings/oauth-apps
// 2. Set the redirect URI to: chrome.identity.getRedirectURL('callback')
//    (load the extension first to get your extension ID, then construct the URL:
//     https://<extension-id>.chromiumapp.org/callback)
// 3. Replace the clientId below with the UUID you receive
export const ANTHROPIC_OAUTH = {
  authorizationEndpoint: 'https://console.anthropic.com/oauth/authorize',
  tokenEndpoint: 'https://console.anthropic.com/oauth/token',
  clientId: 'PLACEHOLDER_CLIENT_ID', // Replace with UUID from Anthropic OAuth app registration
  scopes: ['user:profile', 'user:inference'],
  get redirectUri(): string {
    return typeof chrome !== 'undefined' && chrome.identity
      ? chrome.identity.getRedirectURL('callback')
      : '';
  },
} as const;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms timestamp
  scope: string;
}
