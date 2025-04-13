import fs from 'fs/promises';
import {capture} from "./utils.js";

// 預設的被阻止命令
const DEFAULT_BLOCKED_COMMANDS = [
    "format",
    "mount",
    "umount",
    "mkfs",
    "fdisk",
    "dd",
    "sudo",
    "su",
    "passwd",
    "adduser",
    "useradd",
    "usermod",
    "groupadd"
];

class CommandManager {
    private blockedCommands: Set<string> = new Set(DEFAULT_BLOCKED_COMMANDS);

    async loadBlockedCommands(): Promise<void> {
        // 直接使用默認的被阻止命令列表
        this.blockedCommands = new Set(DEFAULT_BLOCKED_COMMANDS);
        process.stderr.write(`[command-manager] Loaded default blocked commands: ${Array.from(this.blockedCommands).join(', ')}\n`);
    }

    async saveBlockedCommands(): Promise<void> {
        // 不需要保存，因為我們不再使用config.json
        // 所有更改只在內存中有效，程序重啟後會恢復為默認值
        process.stderr.write(`[command-manager] Updated blocked commands: ${Array.from(this.blockedCommands).join(', ')}\n`);
        return Promise.resolve();
    }

    getBaseCommand(command: string) {
        return command.split(' ')[0].toLowerCase().trim();
    }

    extractCommands(commandString: string): string[] {
        try {
            // Trim any leading/trailing whitespace
            commandString = commandString.trim();

            // Define command separators - these are the operators that can chain commands
            const separators = [';', '&&', '||', '|', '&'];

            // This will store our extracted commands
            const commands: string[] = [];

            // Split by common separators while preserving quotes
            let inQuote = false;
            let quoteChar = '';
            let currentCmd = '';
            let escaped = false;

            for (let i = 0; i < commandString.length; i++) {
                const char = commandString[i];

                // Handle escape characters
                if (char === '\\' && !escaped) {
                    escaped = true;
                    currentCmd += char;
                    continue;
                }

                // If this character is escaped, just add it
                if (escaped) {
                    escaped = false;
                    currentCmd += char;
                    continue;
                }

                // Handle quotes (both single and double)
                if ((char === '"' || char === "'") && !inQuote) {
                    inQuote = true;
                    quoteChar = char;
                    currentCmd += char;
                    continue;
                } else if (char === quoteChar && inQuote) {
                    inQuote = false;
                    quoteChar = '';
                    currentCmd += char;
                    continue;
                }

                // If we're inside quotes, just add the character
                if (inQuote) {
                    currentCmd += char;
                    continue;
                }

                // Handle subshells - if we see an opening parenthesis, we need to find its matching closing parenthesis
                if (char === '(') {
                    // Find the matching closing parenthesis
                    let openParens = 1;
                    let j = i + 1;
                    while (j < commandString.length && openParens > 0) {
                        if (commandString[j] === '(') openParens++;
                        if (commandString[j] === ')') openParens--;
                        j++;
                    }

                    // Skip to after the closing parenthesis
                    if (j <= commandString.length) {
                        const subshellContent = commandString.substring(i + 1, j - 1);
                        // Recursively extract commands from the subshell
                        const subCommands = this.extractCommands(subshellContent);
                        commands.push(...subCommands);

                        // Move position past the subshell
                        i = j - 1;
                        continue;
                    }
                }

                // Check for separators
                let isSeparator = false;
                for (const separator of separators) {
                    if (commandString.startsWith(separator, i)) {
                        // We found a separator - extract the command before it
                        if (currentCmd.trim()) {
                            const baseCommand = this.extractBaseCommand(currentCmd.trim());
                            if (baseCommand) commands.push(baseCommand);
                        }

                        // Move past the separator
                        i += separator.length - 1;
                        currentCmd = '';
                        isSeparator = true;
                        break;
                    }
                }

                if (!isSeparator) {
                    currentCmd += char;
                }
            }

            // Don't forget to add the last command
            if (currentCmd.trim()) {
                const baseCommand = this.extractBaseCommand(currentCmd.trim());
                if (baseCommand) commands.push(baseCommand);
            }

            // Remove duplicates and return
            return [...new Set(commands)];
        } catch (error) {
            // If anything goes wrong, log the error but return the basic command to not break execution
            capture('server_request_error', {
                error: 'Error extracting commands'
            });
            return [this.getBaseCommand(commandString)];
        }
    }

    // This extracts the actual command name from a command string
    extractBaseCommand(commandStr: string): string | null {
        try {
            // Remove environment variables (patterns like KEY=value)
            const withoutEnvVars = commandStr.replace(/\w+=\S+\s*/g, '').trim();

            // If nothing remains after removing env vars, return null
            if (!withoutEnvVars) return null;

            // Get the first token (the command)
            const tokens = withoutEnvVars.split(/\s+/);
            const firstToken = tokens[0];

            // Check if it starts with special characters like (, $ that might indicate it's not a regular command
            if (['(', '$'].includes(firstToken[0])) {
                return null;
            }

            return firstToken.toLowerCase();
        } catch (error) {
            capture('Error extracting base command');
            return null;
        }
    }

    validateCommand(command: string): boolean {
        const baseCommand = this.getBaseCommand(command);
        return !this.blockedCommands.has(baseCommand);
    }

    async blockCommand(command: string): Promise<boolean> {
        command = command.toLowerCase().trim();
        if (this.blockedCommands.has(command)) {
            return false;
        }
        this.blockedCommands.add(command);
        await this.saveBlockedCommands();
        return true;
    }

    async unblockCommand(command: string): Promise<boolean> {
        command = command.toLowerCase().trim();
        if (!this.blockedCommands.has(command)) {
            return false;
        }
        this.blockedCommands.delete(command);
        await this.saveBlockedCommands();
        return true;
    }

    listBlockedCommands(): string[] {
        return Array.from(this.blockedCommands).sort();
    }
}

export const commandManager = new CommandManager();
