import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CRED_DIR, CRED_FILE } from './config.mjs';

/**
 * 读取本地凭据文件（~/.geoly/credentials）。
 * 文件不存在或解析失败一律返回 null，由调用方决定引导登录还是报错。
 */
export function loadCredentials() {
  try {
    return JSON.parse(readFileSync(CRED_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 写入凭据文件。
 * Accio Work 的硬契约：顶层必须有明文 account / email 字段（框架用它渲染授权卡片的账号标签，
 * 只认顶层明文，不解嵌套、不解密），后续版本升级不得把这两个字段挪走或改名。
 */
export function saveCredentials(creds) {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, `${JSON.stringify(creds, null, 2)}\n`, { mode: 0o600 });
}

/** 删除凭据文件（logout 用）。 */
export function clearCredentials() {
  try {
    rmSync(CRED_FILE);
    return true;
  } catch {
    return false;
  }
}
