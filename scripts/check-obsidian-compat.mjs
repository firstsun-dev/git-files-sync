import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const NODE_BUILTINS = ['crypto', 'child_process', 'util'];

/** Removes comments while preserving code and string literals. */
function stripComments(source) {
    let result = '';
    let index = 0;
    let quote = '';

    while (index < source.length) {
        const character = source[index];
        const next = source[index + 1];

        if (quote) {
            result += character;
            if (character === '\\') {
                result += next ?? '';
                index += 2;
                continue;
            }
            if (character === quote) quote = '';
            index += 1;
            continue;
        }

        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            result += character;
            index += 1;
            continue;
        }

        if (character === '/' && next === '/') {
            index = source.indexOf('\n', index);
            if (index === -1) break;
            result += '\n';
            index += 1;
            continue;
        }

        if (character === '/' && next === '*') {
            const end = source.indexOf('*/', index + 2);
            index = end === -1 ? source.length : end + 2;
            continue;
        }

        result += character;
        index += 1;
    }

    return result;
}

export function findCompatibilityViolations(bundle) {
    const code = stripComments(bundle);
    const violations = [];

    for (const builtin of NODE_BUILTINS) {
        const nodeImport = new RegExp(`\\b(?:require|import)\\s*\\(\\s*["']node:${builtin}["']\\s*\\)|\\bfrom\\s*["']node:${builtin}["']`);
        if (nodeImport.test(code)) violations.push(`node:${builtin}`);
    }

    const executableCode = code.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '');
    if (/(?:^|[^.$\w])fetch\s*\(/.test(executableCode)) violations.push('native fetch');

    return violations;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const bundlePath = new URL('../main.js', import.meta.url);
    const bundle = await readFile(bundlePath, 'utf8');
    const violations = findCompatibilityViolations(bundle);

    if (violations.length > 0) {
        console.error(`Obsidian compatibility check failed: ${violations.join(', ')}`);
        process.exitCode = 1;
    } else {
        console.log('Obsidian compatibility check passed: main.js contains no prohibited Node imports or native fetch calls.');
    }
}
