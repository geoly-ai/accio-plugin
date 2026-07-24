import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

/**
 * 全局常量配置。
 * GEOLY_BASE_URL 环境变量仅用于本地联调（指向 staging 等），生产默认 app.geoly.ai。
 * 凭据文件路径 ~/.geoly/credentials 是与 Accio Work connector 声明
 * （connectors.json → cli.credential.home = ".geoly/credentials"）绑定的硬契约，不能改。
 */
export const BASE_URL = process.env.GEOLY_BASE_URL || 'https://app.geoly.ai';
export const MCP_URL = `${BASE_URL}/api/mcp`;
export const CRED_DIR = join(homedir(), '.geoly');
export const CRED_FILE = join(CRED_DIR, 'credentials');
export const CLIENT_NAME = 'geoly-accio-plugin';
export const VERSION = pkg.version;
export const OAUTH_SCOPE = 'openid profile email offline_access';
