#!/usr/bin/env node

import { FilteredStdioServerTransport } from './custom-stdio.js';
import { server } from './server.js';
import { commandManager } from './command-manager.js';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'os';
import { capture } from './utils.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isWindows = platform() === 'win32';

// Helper function to properly convert file paths to URLs, especially for Windows
function createFileURL(filePath: string): URL {
  if (isWindows) {
    // Ensure path uses forward slashes for URL format
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Ensure path has proper file:// prefix
    if (normalizedPath.startsWith('/')) {
      return new URL(`file://${normalizedPath}`);
    } else {
      return new URL(`file:///${normalizedPath}`);
    }
  } else {
    // For non-Windows, we can use the built-in function
    return pathToFileURL(filePath);
  }
}

async function runSetup() {
  try {
    // Fix for Windows ESM path issue
    const setupScriptPath = join(__dirname, 'setup-claude-server.js');
    const setupScriptUrl = createFileURL(setupScriptPath);
    
    // Now import using the URL format
    const { default: setupModule } = await import(setupScriptUrl.href);
    if (typeof setupModule === 'function') {
      await setupModule();
    }
  } catch (error) {
    console.error('Error running setup:', error);
    process.exit(1);
  }
}

function showHelp() {
  // 使用 stderr 輸出幫助信息，確保不會被 FilteredStdioServerTransport 過濾掉
  const helpText = `
Desktop Commander MCP - Command Line Options:

Usage: node index.js [options]

Options:
  setup               Run setup script
  --allowed-dir, -d   Specify an allowed directory (can be used multiple times)
                      Example: --allowed-dir=/path/to/dir1 -d /path/to/dir2
  --help, -h          Show this help message

Examples:
  node index.js --allowed-dir=/Users/username/projects
  node index.js -d /path/to/dir1 -d /path/to/dir2
  `;
  
  process.stderr.write(helpText);
  
  // 直接退出，不執行後續程式碼
  process.exit(0);
}

async function runServer() {
  try {
    const transport = new FilteredStdioServerTransport();

    // 檢查幫助命令放在最前面
    // Check command line arguments
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      showHelp();
      return; // This should never be reached due to process.exit in showHelp
    }
    
    // Check if first argument is "setup"
    if (process.argv[2] === 'setup') {
      await runSetup();
      return;
    }
    
    // 檢查是否指定了允許的目錄
    const hasAllowedDir = process.argv.some(arg => 
      arg === '--allowed-dir' || 
      arg === '-d' || 
      arg.startsWith('--allowed-dir=')
    );
    
    if (!hasAllowedDir) {
      process.stderr.write("[desktop-commander] [error] No allowed directories specified.\n");
      process.stderr.write("Please specify at least one allowed directory using --allowed-dir or -d\n");
      showHelp();
      process.exit(1);
    }
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        process.stderr.write(`[desktop-commander] JSON parsing error: ${errorMessage}\n`);
        return; // Don't exit on JSON parsing errors
      }

      capture('run_server_uncaught_exception', {
        error: errorMessage
      });

      process.stderr.write(`[desktop-commander] Uncaught exception: ${errorMessage}\n`);
      process.exit(1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', async (reason) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);
      
      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        process.stderr.write(`[desktop-commander] JSON parsing rejection: ${errorMessage}\n`);
        return; // Don't exit on JSON parsing errors
      }

      capture('run_server_unhandled_rejection', {
        error: errorMessage
      });

      process.stderr.write(`[desktop-commander] Unhandled rejection: ${errorMessage}\n`);
      process.exit(1);
    });

    capture('run_server_start');
    
    // Load blocked commands from config file
    await commandManager.loadBlockedCommands();

    await server.connect(transport);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // 使用stderr輸出日誌信息
    process.stderr.write(`[server] Failed to start server: ${errorMessage}\n`);
    
    // 使用stdout輸出JSON格式的錯誤信息
    process.stdout.write(JSON.stringify({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Failed to start server: ${errorMessage}`
    }) + '\n');

    capture('run_server_failed_start_error', {
      error: errorMessage
    });
    process.exit(1);
  }
}

runServer().catch(async (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  // 使用stderr輸出日誌信息
  process.stderr.write(`[server] Fatal error running server: ${errorMessage}\n`);
  
  // 使用stdout輸出JSON格式的錯誤信息
  process.stdout.write(JSON.stringify({
    type: 'error',
    timestamp: new Date().toISOString(),
    message: `Fatal error running server: ${errorMessage}`
  }) + '\n');

  capture('run_server_fatal_error', {
    error: errorMessage
  });
  process.exit(1);
});