import fs from "fs/promises";
import path from "path";
import os from 'os';
import fetch from 'cross-fetch';
import {capture, withTimeout} from '../utils.js';
import { CONFIG_FILE } from '../config.js';

// 默認允許的目錄，如果配置文件和命令行參數都不存在或讀取失敗則使用這些
let allowedDirectories: string[] = [
    "/Users/wenleliao/opensource", 
    "/Users/wenleliao/doc",
    "/Users/wenleliao/RiderProjects",
    "/Users/wenleliao/Documents/Cline/MCP",
    process.cwd()  // Current working directory
];

/**
 * 解析命令行參數，獲取允許的目錄列表
 * @returns 從命令行獲取的允許目錄列表，如果沒有則返回 null
 */
function parseCommandLineArgs(): string[] | null {
    const directories: string[] = [];
    
    // 遍歷命令行參數
    for (let i = 2; i < process.argv.length; i++) {
        const arg = process.argv[i];
        
        // 檢查是否為 --allowed-dir 或 -d 參數
        if (arg === '--allowed-dir' || arg === '-d') {
            // 確保有下一個參數
            if (i + 1 < process.argv.length) {
                const dirPath = process.argv[++i];
                directories.push(dirPath);
            }
        } else if (arg.startsWith('--allowed-dir=')) {
            // 處理形如 --allowed-dir=/path/to/dir 的格式
            const dirPath = arg.split('=')[1];
            if (dirPath) {
                directories.push(dirPath);
            }
        }
    }
    
    return directories.length > 0 ? directories : null;
}

// 嘗試加載允許的目錄，優先使用命令行參數，然後是配置文件，最後是默認值
async function loadAllowedDirectories() {
    try {
        // 1. 首先嘗試從命令行參數獲取
        const cmdDirs = parseCommandLineArgs();
        if (cmdDirs) {
            // 使用命令行參數指定的目錄
            allowedDirectories = cmdDirs;
            
            // 始終添加當前工作目錄
            if (!allowedDirectories.includes(process.cwd())) {
                allowedDirectories.push(process.cwd());
            }
            
            console.log('Loaded allowed directories from command line arguments:', allowedDirectories);
            return;
        }
        
        // 2. 如果命令行參數未指定，嘗試從配置文件讀取
        const configData = await fs.readFile(CONFIG_FILE, 'utf-8');
        const config = JSON.parse(configData);
        
        // 如果配置文件中有 allowedDirectories 字段且是數組，則使用它
        if (config.allowedDirectories && Array.isArray(config.allowedDirectories)) {
            allowedDirectories = config.allowedDirectories;
            
            // 始終添加當前工作目錄
            if (!allowedDirectories.includes(process.cwd())) {
                allowedDirectories.push(process.cwd());
            }
            
            console.log('Loaded allowed directories from config file:', allowedDirectories);
        }
    } catch (error) {
        console.error('Error loading allowed directories:', error);
        console.log('Using default allowed directories:', allowedDirectories);
        // 發生錯誤時使用默認配置
    }
}

// 立即加載配置
loadAllowedDirectories().catch(error => {
    console.error('Failed to load allowed directories:', error);
});

// Normalize all paths consistently
function normalizePath(p: string): string {
    return path.normalize(p).toLowerCase();
}

function expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
        return path.join(os.homedir(), filepath.slice(1));
    }
    return filepath;
}

/**
 * Recursively validates parent directories until it finds a valid one
 * This function handles the case where we need to create nested directories
 * and we need to check if any of the parent directories exist
 * 
 * @param directoryPath The path to validate
 * @returns Promise<boolean> True if a valid parent directory was found
 */
async function validateParentDirectories(directoryPath: string): Promise<boolean> {
    const parentDir = path.dirname(directoryPath);
    
    // Base case: we've reached the root or the same directory (shouldn't happen normally)
    if (parentDir === directoryPath || parentDir === path.dirname(parentDir)) {
        return false;
    }

    try {
        // Check if the parent directory exists
        await fs.realpath(parentDir);
        return true;
    } catch {
        // Parent doesn't exist, recursively check its parent
        return validateParentDirectories(parentDir);
    }
}

/**
 * Validates a path to ensure it can be accessed or created.
 * For existing paths, returns the real path (resolving symlinks).
 * For non-existent paths, validates parent directories to ensure they exist.
 * 
 * @param requestedPath The path to validate
 * @returns Promise<string> The validated path
 * @throws Error if the path or its parent directories don't exist
 */
export async function validatePath(requestedPath: string): Promise<string> {
    const PATH_VALIDATION_TIMEOUT = 10000; // 10 seconds timeout
    
    const validationOperation = async (): Promise<string> => {
        // Expand home directory if present
        const expandedPath = expandHome(requestedPath);
        
        // Convert to absolute path
        const absolute = path.isAbsolute(expandedPath)
            ? path.resolve(expandedPath)
            : path.resolve(process.cwd(), expandedPath);
        
        // Check if the path is within one of the allowed directories
        const isAllowed = allowedDirectories.some(dir => {
            // Normalize both paths for consistent comparison
            const normalizedDir = normalizePath(dir);
            const normalizedPath = normalizePath(absolute);
            
            // Check if the path is exactly the directory or is contained within it
            return normalizedPath === normalizedDir || normalizedPath.startsWith(normalizedDir + path.sep);
        });
        
        if (!isAllowed) {
            return `__ERROR__: Access denied. Path is not within allowed directories: ${absolute}`;
        }
        
        // Check if path exists
        try {
            const stats = await fs.stat(absolute);
            // If path exists, resolve any symlinks
            return await fs.realpath(absolute);
        } catch (error) {
            // Path doesn't exist - validate parent directories
            if (await validateParentDirectories(absolute)) {
                // Return the path if a valid parent exists
                // This will be used for folder creation and many other file operations
                return absolute;
            }
            // If no valid parent found, return the absolute path anyway
            return absolute;
        }
    };
    
    // Execute with timeout
    const result = await withTimeout(
        validationOperation(),
        PATH_VALIDATION_TIMEOUT,
        `Path validation for ${requestedPath}`,
        null
    );
    
    if (result === null) {
        // Return a path with an error indicator instead of throwing
        return `__ERROR__: Path validation timed out after ${PATH_VALIDATION_TIMEOUT/1000} seconds for: ${requestedPath}`;
    }
    
    return result;
}

// File operation tools
export interface FileResult {
    content: string;
    mimeType: string;
    isImage: boolean;
}


/**
 * Read file content from a URL
 * @param url URL to fetch content from
 * @param returnMetadata Whether to return metadata with the content
 * @returns File content or file result with metadata
 */
export async function readFileFromUrl(url: string, returnMetadata?: boolean): Promise<string | FileResult> {
    // Import the MIME type utilities
    const { isImageFile } = await import('./mime-types.js');
    
    // Set up fetch with timeout
    const FETCH_TIMEOUT_MS = 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    
    try {
        const response = await fetch(url, {
            signal: controller.signal
        });
        
        // Clear the timeout since fetch completed
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        
        // Get MIME type from Content-Type header
        const contentType = response.headers.get('content-type') || 'text/plain';
        const isImage = isImageFile(contentType);
        
        if (isImage) {
            // For images, convert to base64
            const buffer = await response.arrayBuffer();
            const content = Buffer.from(buffer).toString('base64');
            
            if (returnMetadata === true) {
                return { content, mimeType: contentType, isImage };
            } else {
                return content;
            }
        } else {
            // For text content
            const content = await response.text();
            
            if (returnMetadata === true) {
                return { content, mimeType: contentType, isImage };
            } else {
                return content;
            }
        }
    } catch (error) {
        // Clear the timeout to prevent memory leaks
        clearTimeout(timeoutId);
        
        // Return error information instead of throwing
        const errorMessage = error instanceof DOMException && error.name === 'AbortError'
            ? `URL fetch timed out after ${FETCH_TIMEOUT_MS}ms: ${url}`
            : `Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`;

        capture('server_request_error', {error: errorMessage});
        if (returnMetadata === true) {
            return { 
                content: `Error: ${errorMessage}`, 
                mimeType: 'text/plain', 
                isImage: false 
            };
        } else {
            return `Error: ${errorMessage}`;
        }
    }
}

/**
 * Read file content from the local filesystem
 * @param filePath Path to the file
 * @param returnMetadata Whether to return metadata with the content
 * @returns File content or file result with metadata
 */
export async function readFileFromDisk(filePath: string, returnMetadata?: boolean): Promise<string | FileResult> {
    // Import the MIME type utilities
    const { getMimeType, isImageFile } = await import('./mime-types.js');
    
    const validPath = await validatePath(filePath);
    
    // Check if the path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        if (returnMetadata) {
            return { 
                content: errorMessage, 
                mimeType: 'text/plain', 
                isImage: false 
            };
        } else {
            return errorMessage;
        }
    }
    
    // Check file size before attempting to read
    try {
        const stats = await fs.stat(validPath);
        const MAX_SIZE = 100 * 1024; // 100KB limit
        
        if (stats.size > MAX_SIZE) {
            const message = `File too large (${(stats.size / 1024).toFixed(2)}KB > ${MAX_SIZE / 1024}KB limit)`;
            if (returnMetadata) {
                return { 
                    content: message, 
                    mimeType: 'text/plain', 
                    isImage: false 
                };
            } else {
                return message;
            }
        }
    } catch (error) {
        capture('server_request_error', {error: error});
        // If we can't stat the file, continue anyway and let the read operation handle errors
        //console.error(`Failed to stat file ${validPath}:`, error);
    }
    
    // Detect the MIME type based on file extension
    const mimeType = getMimeType(validPath);
    const isImage = isImageFile(mimeType);
    
    const FILE_READ_TIMEOUT = 30000; // 30 seconds timeout for file operations
    
    // Use withTimeout to handle potential hangs
    const readOperation = async () => {
        if (isImage) {
            // For image files, read as Buffer and convert to base64
            const buffer = await fs.readFile(validPath);
            const content = buffer.toString('base64');
            
            if (returnMetadata === true) {
                return { content, mimeType, isImage };
            } else {
                return content;
            }
        } else {
            // For all other files, try to read as UTF-8 text
            try {
                const content = await fs.readFile(validPath, "utf-8");
                
                if (returnMetadata === true) {
                    return { content, mimeType, isImage };
                } else {
                    return content;
                }
            } catch (error) {
                // If UTF-8 reading fails, treat as binary and return base64 but still as text
                const buffer = await fs.readFile(validPath);
                const content = `Binary file content (base64 encoded):\n${buffer.toString('base64')}`;

                if (returnMetadata === true) {
                    return { content, mimeType: 'text/plain', isImage: false };
                } else {
                    return content;
                }
            }
        }
    };
    
    // Execute with timeout
    const result = await withTimeout(
        readOperation(),
        FILE_READ_TIMEOUT,
        `Read file operation for ${filePath}`,
        returnMetadata ? 
            { content: `Operation timed out after ${FILE_READ_TIMEOUT/1000} seconds`, mimeType: 'text/plain', isImage: false } : 
            `Operation timed out after ${FILE_READ_TIMEOUT/1000} seconds`
    );
    
    return result;
}

/**
 * Read a file from either the local filesystem or a URL
 * @param filePath Path to the file or URL
 * @param returnMetadata Whether to return metadata with the content
 * @param isUrl Whether the path is a URL
 * @returns File content or file result with metadata
 */
export async function readFile(filePath: string, returnMetadata?: boolean, isUrl?: boolean): Promise<string | FileResult> {
    return isUrl 
        ? readFileFromUrl(filePath, returnMetadata)
        : readFileFromDisk(filePath, returnMetadata);
}

export async function writeFile(filePath: string, content: string): Promise<void> {
    const validPath = await validatePath(filePath);
    
    // Check if the path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    await fs.writeFile(validPath, content, "utf-8");
}

export interface MultiFileResult {
    path: string;
    content?: string;
    mimeType?: string;
    isImage?: boolean;
    error?: string;
}

export async function readMultipleFiles(paths: string[]): Promise<MultiFileResult[]> {
    return Promise.all(
        paths.map(async (filePath: string) => {
            try {
                const validPath = await validatePath(filePath);
                const fileResult = await readFile(validPath, true);

                return {
                    path: filePath,
                    content: typeof fileResult === 'string' ? fileResult : fileResult.content,
                    mimeType: typeof fileResult === 'string' ? "text/plain" : fileResult.mimeType,
                    isImage: typeof fileResult === 'string' ? false : fileResult.isImage
                };
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return {
                    path: filePath,
                    error: errorMessage
                };
            }
        }),
    );
}

export async function createDirectory(dirPath: string): Promise<void> {
    const validPath = await validatePath(dirPath);
    
    // Check if the path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    await fs.mkdir(validPath, { recursive: true });
}

export async function listDirectory(dirPath: string): Promise<string[]> {
    const validPath = await validatePath(dirPath);
    
    // Check if the path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    const entries = await fs.readdir(validPath, { withFileTypes: true });
    return entries.map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`);
}

export async function moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    const validSourcePath = await validatePath(sourcePath);
    const validDestPath = await validatePath(destinationPath);
    
    // Check if either path validation returned an error
    if (validSourcePath.startsWith('__ERROR__:')) {
        const errorMessage = validSourcePath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    if (validDestPath.startsWith('__ERROR__:')) {
        const errorMessage = validDestPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    await fs.rename(validSourcePath, validDestPath);
}

export async function searchFiles(rootPath: string, pattern: string): Promise<string[]> {
    const results: string[] = [];
    
    // Validate the root path first
    const validPath = await validatePath(rootPath);
    
    // Check if path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }

    async function search(currentPath: string) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            
            try {
                const validFullPath = await validatePath(fullPath);
                
                // Skip paths that aren't allowed
                if (validFullPath.startsWith('__ERROR__:')) {
                    continue;
                }

                if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
                    results.push(fullPath);
                }

                if (entry.isDirectory()) {
                    await search(fullPath);
                }
            } catch (error) {
                continue;
            }
        }
    }
    
    await search(validPath);
    return results;
}

export async function getFileInfo(filePath: string): Promise<Record<string, any>> {
    const validPath = await validatePath(filePath);
    
    // Check if path validation returned an error
    if (validPath.startsWith('__ERROR__:')) {
        const errorMessage = validPath.substring('__ERROR__:'.length).trim();
        throw new Error(errorMessage);
    }
    
    const stats = await fs.stat(validPath);
    
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };
}

export function listAllowedDirectories(): string[] {
    return [...allowedDirectories]; // 返回副本以避免外部修改
}

/**
 * 重新加載允許的目錄列表
 * 當配置文件被修改時可以調用此函數
 */
export async function reloadAllowedDirectories(): Promise<string[]> {
    await loadAllowedDirectories();
    return listAllowedDirectories();
}
