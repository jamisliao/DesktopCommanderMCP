import {
    readFile,
    readMultipleFiles,
    writeFile,
    createDirectory,
    listDirectory,
    moveFile,
    searchFiles,
    getFileInfo,
    listAllowedDirectories,
    reloadAllowedDirectories,
    type FileResult,
    type MultiFileResult
} from '../tools/filesystem.js';

import { ServerResult } from '../types.js';
import { withTimeout } from '../utils.js';
import { createErrorResponse } from '../error-handlers.js';

import {
    ReadFileArgsSchema,
    ReadMultipleFilesArgsSchema,
    WriteFileArgsSchema,
    CreateDirectoryArgsSchema,
    ListDirectoryArgsSchema,
    MoveFileArgsSchema,
    SearchFilesArgsSchema,
    GetFileInfoArgsSchema
} from '../tools/schemas.js';

/**
 * Helper function to check if path contains an error
 */
function isErrorPath(path: string): boolean {
    return path.startsWith('__ERROR__:');
}

/**
 * Extract error message from error path
 */
function getErrorFromPath(path: string): string {
    return path.substring('__ERROR__:'.length).trim();
}

/**
 * Handle read_file command
 */
export async function handleReadFile(args: unknown): Promise<ServerResult> {
    const HANDLER_TIMEOUT = 60000; // 60 seconds total operation timeout
    
    const readFileOperation = async () => {
        const parsed = ReadFileArgsSchema.parse(args);
        // Explicitly cast the result to FileResult since we're passing true
        const fileResult = await readFile(parsed.path, true, parsed.isUrl) as FileResult;
        
        if (fileResult.isImage) {
            // For image files, return as an image content type
            return {
                content: [
                    { 
                        type: "text", 
                        text: `Image file: ${parsed.path} (${fileResult.mimeType})\n` 
                    },
                    {
                        type: "image",
                        data: fileResult.content,
                        mimeType: fileResult.mimeType
                    }
                ],
            };
        } else {
            // For all other files, return as text
            return {
                content: [{ type: "text", text: fileResult.content }],
            };
        }
    };
    
    // Execute with timeout at the handler level
    return await withTimeout(
        readFileOperation(),
        HANDLER_TIMEOUT,
        'Read file handler operation',
        {
            content: [{ type: "text", text: `Operation timed out after ${HANDLER_TIMEOUT/1000} seconds. The file might be too large or on a slow/unresponsive storage device.` }],
        }
    );
}

/**
 * Handle read_multiple_files command
 */
export async function handleReadMultipleFiles(args: unknown): Promise<ServerResult> {
    const parsed = ReadMultipleFilesArgsSchema.parse(args);
    const fileResults = await readMultipleFiles(parsed.paths);
    
    // Create a text summary of all files
    const textSummary = fileResults.map(result => {
        if (result.error) {
            return `${result.path}: Error - ${result.error}`;
        } else if (result.mimeType) {
            return `${result.path}: ${result.mimeType} ${result.isImage ? '(image)' : '(text)'}`;
        } else {
            return `${result.path}: Unknown type`;
        }
    }).join("\n");
    
    // Create content items for each file
    const contentItems: Array<{type: string, text?: string, data?: string, mimeType?: string}> = [];
    
    // Add the text summary
    contentItems.push({ type: "text", text: textSummary });
    
    // Add each file content
    for (const result of fileResults) {
        if (!result.error && result.content !== undefined) {
            if (result.isImage && result.mimeType) {
                // For image files, add an image content item
                contentItems.push({
                    type: "image",
                    data: result.content,
                    mimeType: result.mimeType
                });
            } else {
                // For text files, add a text summary
                contentItems.push({
                    type: "text",
                    text: `\n--- ${result.path} contents: ---\n${result.content}`
                });
            }
        }
    }
    
    return { content: contentItems };
}

/**
 * Handle write_file command
 */
export async function handleWriteFile(args: unknown): Promise<ServerResult> {
    try {
        const parsed = WriteFileArgsSchema.parse(args);
        await writeFile(parsed.path, parsed.content);
        
        return {
            content: [{ type: "text", text: `Successfully wrote to ${parsed.path}` }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle create_directory command
 */
export async function handleCreateDirectory(args: unknown): Promise<ServerResult> {
    try {
        const parsed = CreateDirectoryArgsSchema.parse(args);
        await createDirectory(parsed.path);
        return {
            content: [{ type: "text", text: `Successfully created directory ${parsed.path}` }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle list_directory command
 */
export async function handleListDirectory(args: unknown): Promise<ServerResult> {
    try {
        const parsed = ListDirectoryArgsSchema.parse(args);
        const entries = await listDirectory(parsed.path);
        return {
            content: [{ type: "text", text: entries.join('\n') }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle move_file command
 */
export async function handleMoveFile(args: unknown): Promise<ServerResult> {
    try {
        const parsed = MoveFileArgsSchema.parse(args);
        await moveFile(parsed.source, parsed.destination);
        return {
            content: [{ type: "text", text: `Successfully moved ${parsed.source} to ${parsed.destination}` }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle search_files command
 */
export async function handleSearchFiles(args: unknown): Promise<ServerResult> {
    try {
        const parsed = SearchFilesArgsSchema.parse(args);
        const timeoutMs = parsed.timeoutMs || 30000; // 30 seconds default
        
        // Apply timeout at the handler level
        const searchOperation = async () => {
            return await searchFiles(parsed.path, parsed.pattern);
        };
        
        // Use withTimeout at the handler level
        const results = await withTimeout(
            searchOperation(),
            timeoutMs,
            'File search operation',
            [] // Empty array as default on timeout
        );
        
        if (results.length === 0) {
            // Similar approach as in handleSearchCode
            if (timeoutMs > 0) {
                return {
                    content: [{ type: "text", text: `No matches found or search timed out after ${timeoutMs}ms.` }],
                };
            }
            return {
                content: [{ type: "text", text: "No matches found" }],
            };
        }
        
        return {
            content: [{ type: "text", text: results.join('\n') }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle get_file_info command
 */
export async function handleGetFileInfo(args: unknown): Promise<ServerResult> {
    try {
        const parsed = GetFileInfoArgsSchema.parse(args);
        const info = await getFileInfo(parsed.path);
        return {
            content: [{ 
                type: "text", 
                text: Object.entries(info)
                    .map(([key, value]) => `${key}: ${value}`)
                    .join('\n') 
            }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return createErrorResponse(errorMessage);
    }
}

/**
 * Handle list_allowed_directories command
 */
export function handleListAllowedDirectories(): ServerResult {
    const directories = listAllowedDirectories();
    return {
        content: [{ 
            type: "text", 
            text: `Allowed directories:\n${directories.join('\n')}` 
        }],
    };
}

/**
 * Handle reload_allowed_directories command
 */
export async function handleReloadAllowedDirectories(): Promise<ServerResult> {
    try {
        const directories = await reloadAllowedDirectories();
        return {
            content: [{ 
                type: "text", 
                text: `Reloaded allowed directories from config:\n${directories.join('\n')}` 
            }],
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            content: [{ 
                type: "text", 
                text: `Error reloading allowed directories: ${errorMessage}` 
            }],
            isError: true
        };
    }
}
