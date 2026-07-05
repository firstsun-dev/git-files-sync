const PREFIX = '[git-file-sync]';

export const logger = {
    error: (message: string, ...args: unknown[]) => console.error(`${PREFIX} ${message}`, ...args),
    warn:  (message: string, ...args: unknown[]) => console.warn(`${PREFIX}  ${message}`, ...args),
    debug: (message: string, ...args: unknown[]) => console.debug(`${PREFIX} ${message}`, ...args),
};
