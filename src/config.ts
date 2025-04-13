import path from 'path';
import process from 'process';

// 移除 CONFIG_FILE 配置
export const LOG_FILE = path.join(process.cwd(), 'server.log');
export const ERROR_LOG_FILE = path.join(process.cwd(), 'error.log');

export const DEFAULT_COMMAND_TIMEOUT = 1000; // milliseconds
