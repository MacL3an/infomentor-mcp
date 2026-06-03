/**
 * Config file management.
 *
 * Stores refresh token + child list in ~/.infomentor/config.json.
 * The refresh token rotates on each use and is automatically saved back.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.infomentor');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export interface Child {
  name: string;
  switchId: number;
}

export interface Config {
  refresh_token: string;
  children: Child[];
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      'No config found. Run `infomentor-login` first to authenticate via BankID.',
    );
  }
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function updateRefreshToken(newToken: string): void {
  const config = loadConfig();
  config.refresh_token = newToken;
  saveConfig(config);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}
