import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

/**
 * Extended StdioServerTransport that filters out non-JSON messages.
 * This prevents the "Watching /" error from crashing the server.
 */
export class FilteredStdioServerTransport extends StdioServerTransport {
  constructor() {
    // Create a proxy for stdout that only allows valid JSON to pass through
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = function(buffer: any) {
      // 嚴格過濾，確保只有有效的JSON才能通過stdout
      if (typeof buffer === 'string') {
        try {
          // 嘗試解析為JSON，確保是有效的JSON
          const trimmed = buffer.trim();
          // 只允許以 { 或 [ 開頭的可能有效JSON
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            JSON.parse(trimmed);  // 如果不是有效JSON，會拋出錯誤
            // 有效JSON，允許通過stdout
            return originalStdoutWrite.apply(process.stdout, arguments as any);
          } else {
            // 不是以 { 或 [ 開頭，重定向到stderr
            process.stderr.write(`[filtered-output] Non-JSON: ${buffer}`);
            return true;
          }
        } catch (e) {
          // 解析JSON失敗，重定向到stderr
          process.stderr.write(`[filtered-output] Invalid JSON: ${buffer}`);
          return true;
        }
      }
      // 非字符串類型允許通過
      return originalStdoutWrite.apply(process.stdout, arguments as any);
    };

    super();
    
    // Log initialization to stderr to avoid polluting the JSON stream
    process.stderr.write(`[desktop-commander] Initialized FilteredStdioServerTransport\n`);
  }
}
