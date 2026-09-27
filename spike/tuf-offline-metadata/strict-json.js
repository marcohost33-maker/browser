import { TextDecoder } from 'node:util';

import {
  canonicalBytes,
  DEFAULT_LIMITS,
  TufSpikeError,
} from './tuf-offline.js';

const UTF8_FATAL = new TextDecoder('utf-8', { fatal: true });
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const JSON_WHITESPACE = new Set([' ', '\t', '\r', '\n']);

function fail(code, message, details = undefined) {
  throw new TufSpikeError(code, message, details);
}

function positiveSafeLimit(value, fallback, label) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1) {
    fail('INVALID_LIMIT', `${label} must be a positive safe integer`);
  }
  return selected;
}

function isHexDigit(char) {
  return /^[0-9a-fA-F]$/.test(char);
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue('$');
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      fail('INVALID_JSON', `unexpected trailing JSON data at offset ${this.index}`);
    }
    return value;
  }

  skipWhitespace() {
    while (this.index < this.text.length && JSON_WHITESPACE.has(this.text[this.index])) {
      this.index += 1;
    }
  }

  parseValue(path) {
    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === '{') return this.parseObject(path);
    if (char === '[') return this.parseArray(path);
    if (char === '"') return this.parseString();
    if (char === 't') return this.parseLiteral('true', true);
    if (char === 'f') return this.parseLiteral('false', false);
    if (char === 'n') return this.parseLiteral('null', null);
    if (char === '-' || (char >= '0' && char <= '9')) return this.parseNumber(path);
    fail('INVALID_JSON', `unexpected token at offset ${this.index}`);
  }

  parseObject(path) {
    this.index += 1;
    this.skipWhitespace();
    const result = Object.create(null);
    const keys = new Set();

    if (this.text[this.index] === '}') {
      this.index += 1;
      return result;
    }

    while (this.index < this.text.length) {
      if (this.text[this.index] !== '"') {
        fail('INVALID_JSON', `object key must be a string at offset ${this.index}`);
      }
      const keyOffset = this.index;
      const key = this.parseString();
      if (keys.has(key)) {
        fail('DUPLICATE_JSON_KEY', `duplicate JSON object key ${JSON.stringify(key)}`, {
          path,
          key,
          offset: keyOffset,
        });
      }
      keys.add(key);

      this.skipWhitespace();
      if (this.text[this.index] !== ':') {
        fail('INVALID_JSON', `missing ':' after object key at offset ${this.index}`);
      }
      this.index += 1;
      result[key] = this.parseValue(`${path}.${key}`);
      this.skipWhitespace();

      const delimiter = this.text[this.index];
      if (delimiter === '}') {
        this.index += 1;
        return result;
      }
      if (delimiter !== ',') {
        fail('INVALID_JSON', `missing ',' or '}' at offset ${this.index}`);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    fail('INVALID_JSON', 'unterminated JSON object');
  }

  parseArray(path) {
    this.index += 1;
    this.skipWhitespace();
    const result = [];

    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }

    let itemIndex = 0;
    while (this.index < this.text.length) {
      result.push(this.parseValue(`${path}[${itemIndex}]`));
      itemIndex += 1;
      this.skipWhitespace();

      const delimiter = this.text[this.index];
      if (delimiter === ']') {
        this.index += 1;
        return result;
      }
      if (delimiter !== ',') {
        fail('INVALID_JSON', `missing ',' or ']' at offset ${this.index}`);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    fail('INVALID_JSON', 'unterminated JSON array');
  }

  parseString() {
    const start = this.index;
    this.index += 1;

    while (this.index < this.text.length) {
      const char = this.text[this.index];
      const codeUnit = this.text.charCodeAt(this.index);

      if (char === '"') {
        this.index += 1;
        const token = this.text.slice(start, this.index);
        try {
          return JSON.parse(token);
        } catch {
          fail('INVALID_JSON_STRING', `invalid JSON string at offset ${start}`);
        }
      }

      if (codeUnit <= 0x1f) {
        fail('INVALID_JSON_STRING', `unescaped control character at offset ${this.index}`);
      }

      if (char === '\\') {
        this.index += 1;
        if (this.index >= this.text.length) {
          fail('INVALID_JSON_STRING', `unterminated escape at offset ${this.index - 1}`);
        }
        const escape = this.text[this.index];
        if (escape === 'u') {
          for (let n = 1; n <= 4; n += 1) {
            const digit = this.text[this.index + n];
            if (digit === undefined || !isHexDigit(digit)) {
              fail('INVALID_JSON_STRING', `invalid unicode escape at offset ${this.index - 1}`);
            }
          }
          this.index += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(escape)) {
          fail('INVALID_JSON_STRING', `invalid escape at offset ${this.index - 1}`);
        }
      }

      this.index += 1;
    }

    fail('INVALID_JSON_STRING', `unterminated JSON string at offset ${start}`);
  }

  parseLiteral(token, value) {
    if (!this.text.startsWith(token, this.index)) {
      fail('INVALID_JSON', `invalid literal at offset ${this.index}`);
    }
    this.index += token.length;
    return value;
  }

  parseNumber(path) {
    const rest = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (!match) fail('INVALID_JSON_NUMBER', `invalid number at offset ${this.index}`);

    const token = match[0];
    this.index += token.length;
    const value = Number(token);
    if (!Number.isFinite(value)) {
      fail('INVALID_JSON_NUMBER', `non-finite JSON number at ${path}`);
    }
    return value;
  }
}

/**
 * Parse untrusted JSON bytes without allowing JSON.parse's duplicate-key overwrite.
 * The byte limit is enforced before UTF-8 decoding or syntax traversal.
 */
export function parseStrictJsonBytes(rawBytes, {
  maxBytes = DEFAULT_LIMITS.metadataBytes,
  label = 'metadata',
} = {}) {
  if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array)) {
    fail('INVALID_RAW_METADATA', `${label} must be Buffer or Uint8Array`);
  }

  const bytes = Buffer.from(rawBytes);
  const byteLimit = positiveSafeLimit(maxBytes, DEFAULT_LIMITS.metadataBytes, 'maxBytes');
  if (bytes.length > byteLimit) {
    fail('METADATA_TOO_LARGE', `${label} exceeds the raw byte limit`, {
      actual: bytes.length,
      limit: byteLimit,
    });
  }
  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    fail('JSON_BOM_FORBIDDEN', `${label} must not contain a UTF-8 BOM`);
  }

  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    fail('INVALID_UTF8', `${label} is not valid UTF-8`);
  }

  return new StrictJsonParser(text).parse();
}

/**
 * Parse a TUF metadata envelope from raw bytes and require the exact project POUF
 * canonical representation. This prevents two distinct raw representations from
 * collapsing onto the same signed/canonical object before descriptor checks.
 */
export function parseCanonicalMetadataBytes(rawBytes, limits = DEFAULT_LIMITS, label = 'metadata') {
  const maxBytes = positiveSafeLimit(limits?.metadataBytes, DEFAULT_LIMITS.metadataBytes, 'metadataBytes');
  const value = parseStrictJsonBytes(rawBytes, { maxBytes, label });

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('INVALID_METADATA', `${label} must be a JSON object`);
  }

  const canonical = canonicalBytes(value, limits);
  const bytes = Buffer.from(rawBytes);
  if (!bytes.equals(canonical)) {
    fail('NONCANONICAL_METADATA', `${label} bytes are not the canonical POUF representation`, {
      rawLength: bytes.length,
      canonicalLength: canonical.length,
    });
  }

  return value;
}
