import { ANTHROPIC_OAUTH, type OAuthTokens } from '../shared/oauth-config';

const STORAGE_KEY = 'anthropicOAuth';

// PKCE helpers
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Read tokens from storage
async function getStoredTokens(): Promise<OAuthTokens | null> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as OAuthTokens | undefined) ?? null;
}

// Save tokens to storage
async function saveTokens(tokens: OAuthTokens): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: tokens });
}

// Clear tokens
async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

// Start the OAuth flow — opens browser window for user consent
export async function startOAuthFlow(): Promise<void> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: ANTHROPIC_OAUTH.clientId,
    redirect_uri: ANTHROPIC_OAUTH.redirectUri,
    scope: ANTHROPIC_OAUTH.scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: crypto.randomUUID(),
  });

  const authUrl = `${ANTHROPIC_OAUTH.authorizationEndpoint}?${params.toString()}`;

  // chrome.identity.launchWebAuthFlow opens a popup for the user
  const redirectUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });

  if (!redirectUrl) {
    throw new Error('OAuth flow was cancelled');
  }

  // Extract authorization code from redirect URL
  const url = new URL(redirectUrl);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    throw new Error(`OAuth error: ${error}`);
  }
  if (!code) {
    throw new Error('No authorization code received');
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(ANTHROPIC_OAUTH.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_OAUTH.clientId,
      code,
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Token exchange failed (${tokenResponse.status}): ${errText}`);
  }

  const tokenData = await tokenResponse.json();
  const tokens: OAuthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
    scope: tokenData.scope ?? ANTHROPIC_OAUTH.scopes.join(' '),
  };

  await saveTokens(tokens);
}

// Refresh an expired access token
export async function refreshAccessToken(): Promise<OAuthTokens> {
  const stored = await getStoredTokens();
  if (!stored?.refreshToken) {
    throw new Error('No refresh token available — sign in again');
  }

  const response = await fetch(ANTHROPIC_OAUTH.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: ANTHROPIC_OAUTH.clientId,
      refresh_token: stored.refreshToken,
    }),
  });

  if (!response.ok) {
    // Refresh failed — clear tokens, user must re-authenticate
    await clearTokens();
    const errText = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? stored.refreshToken,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    scope: data.scope ?? stored.scope,
  };

  await saveTokens(tokens);
  return tokens;
}

// Get a valid access token (refreshes if expired)
export async function getAccessToken(): Promise<string> {
  const tokens = await getStoredTokens();
  if (!tokens) {
    throw new Error('Not authenticated — sign in with Anthropic first');
  }

  // Refresh if expired or expiring within 60 seconds
  if (Date.now() >= tokens.expiresAt - 60_000) {
    const refreshed = await refreshAccessToken();
    return refreshed.accessToken;
  }

  return tokens.accessToken;
}

// Revoke tokens (sign out)
export async function revokeTokens(): Promise<void> {
  await clearTokens();
}

// Check if user is authenticated
export async function isAuthenticated(): Promise<boolean> {
  const tokens = await getStoredTokens();
  return tokens !== null;
}
