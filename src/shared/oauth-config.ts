// Anthropic OAuth configuration
// NOTE: Endpoints and clientId are placeholders — update when registering with Anthropic
export const ANTHROPIC_OAUTH = {
  authorizationEndpoint: 'https://console.anthropic.com/oauth/authorize',
  tokenEndpoint: 'https://console.anthropic.com/oauth/token',
  clientId: 'PLACEHOLDER_CLIENT_ID', // Replace with registered client ID
  scopes: ['api:read', 'api:write'],
  // Chrome extension redirect URL — unique per extension ID
  get redirectUri(): string {
    return chrome.identity.getRedirectURL('callback');
  },
} as const;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // ms timestamp
  scope: string;
}
