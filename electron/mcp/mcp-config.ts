import * as fs from 'fs';
import * as path from 'path';
import type { McpClientConfig, McpServerConfig, McpServerExposedConfig } from './types';

interface ConfigSources {
  globalConfigPath: string;
  vaultConfigPath?: string;
}

export function loadMcpClientConfig(sources: ConfigSources): McpClientConfig {
  const globalConfig = readJsonFile<McpClientConfig>(sources.globalConfigPath);
  const vaultConfig = sources.vaultConfigPath
    ? readJsonFile<McpClientConfig>(sources.vaultConfigPath)
    : null;

  const merged: McpClientConfig = { mcpServers: {} };

  if (globalConfig?.mcpServers) {
    for (const [name, config] of Object.entries(globalConfig.mcpServers)) {
      merged.mcpServers[name] = { ...config };
    }
  }

  if (vaultConfig?.mcpServers) {
    for (const [name, config] of Object.entries(vaultConfig.mcpServers)) {
      if (name in merged.mcpServers) {
        merged.mcpServers[name] = { ...merged.mcpServers[name], ...config };
      } else {
        merged.mcpServers[name] = { ...config };
      }
    }
  }

  return merged;
}

export function loadMcpServerConfig(vaultPath: string): McpServerExposedConfig {
  const configPath = path.join(vaultPath, '.synapse', 'mcp-server.json');
  const config = readJsonFile<McpServerExposedConfig>(configPath);
  return config ?? {
    enabled: false,
    profiles: {
      default: { name: 'default', capabilities: ['read'], blockedTools: [] },
    },
    httpTransport: { port: 19876, path: '/mcp' },
  };
}

export function resolveSecrets(
  config: McpServerConfig,
  secretsMap: Record<string, string>
): McpServerConfig {
  const resolved = { ...config };
  if (resolved.env) {
    resolved.env = resolveRecord(resolved.env, secretsMap);
  }
  if (resolved.headers) {
    resolved.headers = resolveRecord(resolved.headers, secretsMap);
  }
  return resolved;
}

export function loadSecrets(globalSecretsPath: string, vaultSecretsPath?: string): Record<string, string> {
  const global = readJsonFile<Record<string, string>>(globalSecretsPath) ?? {};
  const vault = vaultSecretsPath ? readJsonFile<Record<string, string>>(vaultSecretsPath) ?? {} : {};
  return { ...global, ...vault };
}

function resolveRecord(record: Record<string, string>, secrets: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const match = value.match(/^\$\{secret:(.+)\}$/);
    if (match && secrets[match[1]]) {
      result[key] = secrets[match[1]];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
