import { Logger } from './logger.js';

const logger = new Logger('PackerUnpacker');

/**
 * Unpacks Dean Edwards packed JavaScript code:
 * eval(function(p,a,c,k,e,d){...}('payload', radix, count, 'symtab'.split('|')))
 * Operates purely via string substitution without calling eval()
 */
export function unpackPacker(packedJs: string, pageUrl: string = ''): string | null {
  try {
    const packerRegex =
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*['"]([\s\S]+?)['"]\s*,\s*(\d+)\s*,\s*\d+\s*,\s*['"]([\s\S]+?)['"]\.split\(['"]\|['"]\)/;

    const match = packedJs.match(packerRegex);
    if (!match) {
      // Alternate regex without .split('|') explicitly in the match
      const altRegex =
        /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*['"]([\s\S]+?)['"]\s*,\s*(\d+)\s*,\s*\d+\s*,\s*['"]([\s\S]+?)['"]/;
      const altMatch = packedJs.match(altRegex);
      if (!altMatch) return null;
      return unpackPayload(altMatch[1], parseInt(altMatch[2], 10), altMatch[3].split('|'), pageUrl);
    }

    const [, payloadRaw, radixStr, sympipe] = match;
    const radix = parseInt(radixStr, 10) || 36;
    const symtab = sympipe.split('|');

    return unpackPayload(payloadRaw, radix, symtab, pageUrl);
  } catch (err) {
    logger.warn(`Failed to unpack packer script: ${(err as Error).message}`);
    return null;
  }
}

function unpackPayload(payloadRaw: string, radix: number, symtab: string[], pageUrl: string): string {
  let payload = payloadRaw
    .replace(/location\.href/g, `'${pageUrl}'`)
    .replace(/window\.location/g, `'${pageUrl}'`)
    .replace(/document\.cookie/g, `''`);

  const tokenRegex = /\b[0-9a-zA-Z]+\b/g;

  return payload.replace(tokenRegex, (token) => {
    try {
      const idx = parseInt(token, radix);
      if (!isNaN(idx) && idx >= 0 && idx < symtab.length && symtab[idx]) {
        return symtab[idx];
      }
    } catch {
      // Ignore
    }
    return token;
  });
}

/**
 * Recursively unpacks all packed scripts in the provided HTML/code (up to maxIterations)
 */
export function unpackAll(code: string, pageUrl: string = '', maxIterations: number = 5): string {
  let current = code;
  const packerPattern = /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/i;

  for (let i = 0; i < maxIterations; i++) {
    if (!packerPattern.test(current)) {
      break;
    }

    // Match all packed blocks in the current document
    const blockRegex =
      /eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)\s*\{[\s\S]*?\}\s*\(\s*['"][\s\S]+?['"]\s*,\s*\d+\s*,\s*\d+\s*,\s*['"][\s\S]+?['"](?:\.split\(['"]\|['"]\))?\s*\)\s*\)/g;

    let modified = false;
    current = current.replace(blockRegex, (packedBlock) => {
      const unpacked = unpackPacker(packedBlock, pageUrl);
      if (unpacked) {
        modified = true;
        return unpacked;
      }
      return packedBlock;
    });

    if (!modified) break;
  }
  return current;
}
