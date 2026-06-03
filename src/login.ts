#!/usr/bin/env node
/**
 * InfoMentor one-time login via BankID.
 *
 * Opens a browser, user logs in via their municipality's SSO + BankID,
 * then the script exchanges the session for OAuth2 tokens and saves them
 * to ~/.infomentor/config.json.
 *
 * Usage: npx infomentor-login
 *        (or: node dist/login.js)
 *
 * Requires: puppeteer (peer dependency)
 */
import { getAccount } from './auth.js';
import { saveConfig, getConfigPath, type Config } from './config.js';

async function main() {
  // Dynamic import — puppeteer is a peer dependency
  let puppeteer: typeof import('puppeteer');
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.error(
      'puppeteer is required for login. Install it:\n  npm install puppeteer\n',
    );
    process.exit(1);
  }

  console.log('InfoMentor Login');
  console.log('================');
  console.log('A browser will open. Log in via your municipality\'s SSO (e.g. BankID).');
  console.log('Once you see the InfoMentor dashboard, the script will capture your session.\n');

  const browser = await puppeteer.default.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.goto('https://infomentor.se/swedish/production/mentor/', {
    waitUntil: 'networkidle2',
    timeout: 30000,
  });

  console.log('Select your municipality and complete the login.\n');

  // Watch for new tabs (SSO may open hub in a new tab)
  type Page = Awaited<ReturnType<typeof browser.newPage>>;
  const allPages: Set<Page> = new Set([page]);
  browser.on('targetcreated', async (target) => {
    if (target.type() === 'page') {
      const p = await target.page();
      if (p) allPages.add(p as Page);
    }
  });

  // Wait for hub page
  const deadline = Date.now() + 10 * 60 * 1000;
  let hubPage: Page | null = null;

  while (Date.now() < deadline) {
    for (const p of allPages) {
      try {
        if (p.isClosed()) continue;
        const url = p.url();
        if (
          url.includes('hub.infomentor.se') &&
          !url.includes('/authentication/') &&
          !url.includes('/login')
        ) {
          hubPage = p;
          break;
        }
      } catch {}
    }
    if (hubPage) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (!hubPage) {
    console.error('Login timed out (10 minutes).');
    await browser.close();
    process.exit(1);
  }

  console.log('Login successful!');
  await new Promise((r) => setTimeout(r, 5000));

  // Step 2: Get authentication data (apiUrl, authenticationUrl, tokenUrl)
  console.log('Requesting OAuth2 authorization...');

  const authData = await hubPage.evaluate(async () => {
    const res = await fetch('/account/pair/GetAuthenticationData', {
      method: 'POST',
      credentials: 'include',
    });
    return res.json() as Promise<{
      apiUrl: string;
      authenticationUrl: string;
      tokenUrl: string;
      clientId: string;
    }>;
  });

  // Step 3: Navigate to OAuth2 authorize URL
  const authorizeUrl = authData.authenticationUrl
    .replace('{DeviceIdentifier}', 'infomentor-mcp-' + Date.now())
    .replace('{DeviceFriendlyName}', 'InfoMentor-MCP')
    .replace('{DeviceType}', 'Android')
    + '&scope=IM2-API-NOTIFICATION'
    + '&redirect_uri=' + encodeURIComponent('InfomentorNotification://oauth2Callback')
    + '&client_id=notificationapp'
    + '&response_type=code';

  // Intercept the callback redirect to capture the auth code
  let authCode = '';
  await hubPage.setRequestInterception(true);
  hubPage.on('request', (req) => {
    const url = req.url();
    if (url.includes('oauth2Callback') && url.includes('code=')) {
      const match = url.match(/code=([^&]+)/);
      if (match) authCode = decodeURIComponent(match[1]);
      req.abort();
    } else {
      req.continue();
    }
  });

  try {
    await hubPage.goto(authorizeUrl, { waitUntil: 'networkidle2', timeout: 10000 });
  } catch {
    // Expected — the redirect to the custom URL scheme will fail
  }

  if (!authCode) {
    // Check the URL bar
    const currentUrl = hubPage.url();
    const match = currentUrl.match(/code=([^&]+)/);
    if (match) authCode = decodeURIComponent(match[1]);
  }

  if (!authCode) {
    console.error('Could not obtain authorization code.');
    await browser.close();
    process.exit(1);
  }

  console.log('Got authorization code.');

  // Step 4: Exchange code for tokens
  console.log('Exchanging for tokens...');

  const tokenRes = await fetch(authData.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: authCode,
      client_id: 'notificationapp',
      client_secret: 'NONE',
      redirect_uri: 'InfomentorNotification://oauth2Callback',
      grant_type: 'authorization_code',
    }),
  });

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  if (!tokens.access_token || !tokens.refresh_token) {
    console.error('Token exchange failed.');
    await browser.close();
    process.exit(1);
  }

  // Step 5: Get children
  console.log('Fetching account info...');
  const account = await getAccount(tokens.access_token);
  const children = (account?.pupils || []).map((p) => ({
    name: (p.firstName + ' ' + p.lastName).trim(),
    switchId: p.userRoleId,
  }));

  // Step 6: Save config
  const config: Config = {
    refresh_token: tokens.refresh_token,
    children,
  };
  saveConfig(config);

  console.log(`\nSetup complete!`);
  console.log(`Config saved to: ${getConfigPath()}`);
  console.log(`Account: ${account?.name || 'unknown'}`);
  console.log(`Children: ${children.map((c) => c.name).join(', ') || 'none found'}`);
  console.log(`\nYou can now close the browser and use the MCP server.`);

  await new Promise<void>((resolve) => {
    browser.on('disconnected', resolve);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
