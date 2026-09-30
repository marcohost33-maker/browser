import { TextDecoder } from 'node:util';

import {
  canonicalBytes,
  DEFAULT_LIMITS,
  TufSpikeError,
  verifyOfflineBundle,
  verifyTopLevelMetadata,
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

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isHexDigit(char) {
  return char !== undefined && /^[0-9a-fA-F]$/.test(char);
}

// Type- and size-check a raw metadata view WITHOUT copying it. The generic core
// makes the single defensive copy that is then both parsed and hashed.
function checkedRawBytes(value, label, maxBytes) {
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) {
    fail('INVALID_RAW_METADATA', `${label} must be Buffer or Uint8Array`);
  }
  if (value.byteLength > maxBytes) {
    fail('METADATA_TOO_LARGE', `${label} exceeds the raw byte limit`, {
      actual: value.byteLength,
      limit: maxBytes,
    });
  }
  return value;
}

function rawMetadataByteLimit(limits) {
  return positiveSafeLimit(limits?.metadataBytes, DEFAULT_LIMITS.metadataBytes, 'metadataBytes');
}

/**
 * Bound the root chain by COUNT before any candidate is read, copied or parsed.
 * updateRootChain() enforces the same limit, but only after the byte ingress has
 * already done per-candidate work; without this gate the aggregate cost of an
 * untrusted bundle grows with its array length instead of with rootUpdates
 * (TUF 5.3.3/5.3.9: the client stops after a bounded number of root files).
 */
function rawRootCandidates(bundle, limits) {
  const roots = bundle.roots ?? [];
  if (!Array.isArray(roots)) {
    fail('INVALID_RAW_METADATA', 'raw root metadata must be an array');
  }
  const limit = positiveSafeLimit(limits?.rootUpdates, DEFAULT_LIMITS.rootUpdates, 'rootUpdates');
  if (roots.length > limit) {
    fail('TOO_MANY_ROOT_UPDATES', 'root update chain exceeds the limit', {
      actual: roots.length,
      limit,
    });
  }
  return roots;
}

/**
 * Fail-fast shape, count and size gate for a raw bundle. Only raw bytes are passed
 * on: the core derives every verified object from exactly these bytes, so no
 * caller-supplied parse result can diverge from the hashed file.
 */
function checkedRawMetadata(bundle, limits) {
  const rawRoots = rawRootCandidates(bundle, limits);
  const maxBytes = rawMetadataByteLimit(limits);
  return {
    roots: Array.from(rawRoots, (bytes, index) => checkedRawBytes(bytes, `root[${index}]`, maxBytes)),
    timestamp: checkedRawBytes(bundle.timestamp, 'timestamp', maxBytes),
    snapshot: checkedRawBytes(bundle.snapshot, 'snapshot', maxBytes),
    targets: checkedRawBytes(bundle.targets, 'targets', maxBytes),
  };
}

class StrictJsonParser {
  constructor(text, { maxDepth, maxNodes }) {
    this.text = text;
    this.index = 0;
    this.maxDepth = maxDepth;
    this.maxNodes = maxNodes;
    this.nodes = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue('$', 0);
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

  parseValue(path, depth) {
    this.nodes += 1;
    if (this.nodes > this.maxNodes) {
      fail('JSON_NODE_LIMIT', `${path} exceeds the JSON node limit`);
    }
    if (depth > this.maxDepth) {
      fail('JSON_DEPTH_LIMIT', `${path} exceeds the JSON depth limit`);
    }

    this.skipWhitespace();
    const char = this.text[this.index];
    if (char === '{') return this.parseObject(path, depth);
    if (char === '[') return this.parseArray(path, depth);
    if (char === '"') return this.parseString();
    if (char === 't') return this.parseLiteral('true', true);
    if (char === 'f') return this.parseLiteral('false', false);
    if (char === 'n') return this.parseLiteral('null', null);
    if (char === '-' || (char >= '0' && char <= '9')) return this.parseNumber(path);
    fail('INVALID_JSON', `unexpected token at offset ${this.index}`);
  }

  parseObject(path, depth) {
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
      result[key] = this.parseValue(`${path}.${key}`, depth + 1);
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

  parseArray(path, depth) {
    this.index += 1;
    this.skipWhitespace();
    const result = [];

    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }

    let itemIndex = 0;
    while (this.index < this.text.length) {
      result.push(this.parseValue(`${path}[${itemIndex}]`, depth + 1));
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
            if (!isHexDigit(this.text[this.index + n])) {
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

    // The project POUF accepts integer tokens only. Checking the raw token is
    // essential: JSON.parse/Number would collapse 1.0 and 1e0 to the integer 1,
    // making the representation rule impossible to enforce afterwards.
    if (/[.eE]/.test(token)) {
      fail('FLOAT_FORBIDDEN', `non-integer JSON number at ${path}`);
    }

    let integer;
    try {
      integer = BigInt(token);
    } catch {
      fail('INVALID_JSON_NUMBER', `invalid integer at ${path}`);
    }
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (integer > maxSafe || integer < -maxSafe) {
      fail('INVALID_NUMBER', `${path} must be a safe integer`);
    }
    return Number(integer);
  }
}

/**
 * Parse untrusted JSON bytes without JSON.parse's duplicate-key overwrite.
 * The byte limit is enforced before UTF-8 decoding or syntax traversal.
 */
export function parseStrictJsonBytes(rawBytes, {
  maxBytes = DEFAULT_LIMITS.metadataBytes,
  maxDepth = DEFAULT_LIMITS.jsonDepth,
  maxNodes = DEFAULT_LIMITS.jsonNodes,
  label = 'metadata',
} = {}) {
  if (!(Buffer.isBuffer(rawBytes) || rawBytes instanceof Uint8Array)) {
    fail('INVALID_RAW_METADATA', `${label} must be Buffer or Uint8Array`);
  }

  const byteLimit = positiveSafeLimit(maxBytes, DEFAULT_LIMITS.metadataBytes, 'maxBytes');
  const depthLimit = positiveSafeLimit(maxDepth, DEFAULT_LIMITS.jsonDepth, 'maxDepth');
  const nodeLimit = positiveSafeLimit(maxNodes, DEFAULT_LIMITS.jsonNodes, 'maxNodes');
  // Reject on the caller's view length BEFORE the defensive copy: copying first
  // would let an oversized input force a full-size allocation the limit exists
  // to prevent.
  if (rawBytes.byteLength > byteLimit) {
    fail('METADATA_TOO_LARGE', `${label} exceeds the raw byte limit`, {
      actual: rawBytes.byteLength,
      limit: byteLimit,
    });
  }
  const bytes = Buffer.from(rawBytes);
  if (bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM)) {
    fail('JSON_BOM_FORBIDDEN', `${label} must not contain a UTF-8 BOM`);
  }

  let text;
  try {
    text = UTF8_FATAL.decode(bytes);
  } catch {
    fail('INVALID_UTF8', `${label} is not valid UTF-8`);
  }

  return new StrictJsonParser(text, {
    maxDepth: depthLimit,
    maxNodes: nodeLimit,
  }).parse();
}

/**
 * Parse one TUF metadata file from the exact received bytes.
 *
 * The full envelope does NOT need to be byte-identical to canonical JSON: TUF
 * signatures cover the canonical form of the "signed" object, while timestamp and
 * snapshot length/hash descriptors bind the exact metadata-file bytes received.
 * canonicalBytes() is still evaluated here to enforce this project's restricted
 * POUF domain (safe integers, well-formed Unicode, bounded JSON).
 */
export function parseTufMetadataBytes(rawBytes, limits = DEFAULT_LIMITS, label = 'metadata') {
  const maxBytes = positiveSafeLimit(
    limits?.metadataBytes,
    DEFAULT_LIMITS.metadataBytes,
    'metadataBytes',
  );
  const value = parseStrictJsonBytes(rawBytes, {
    maxBytes,
    maxDepth: positiveSafeLimit(limits?.jsonDepth, DEFAULT_LIMITS.jsonDepth, 'jsonDepth'),
    maxNodes: positiveSafeLimit(limits?.jsonNodes, DEFAULT_LIMITS.jsonNodes, 'jsonNodes'),
    label,
  });

  if (!isPlainObject(value)) {
    fail('INVALID_METADATA', `${label} must be a JSON object`);
  }
  canonicalBytes(value, limits);
  return value;
}

/**
 * Raw-byte ingress for the generic top-level TUF metadata core.
 */
export function verifyTopLevelMetadataBytes({
  trustedState,
  bundle,
  now = new Date(),
  limits = DEFAULT_LIMITS,
}) {
  if (!isPlainObject(bundle)) {
    fail('INVALID_INPUT', 'raw top-level bundle must be an object');
  }

  return verifyTopLevelMetadata({
    trustedState,
    bundle: { rawMetadata: checkedRawMetadata(bundle, limits) },
    now,
    limits,
  });
}

/**
 * Production-facing raw-byte ingress for the offline research verifier.
 * Object-mode verifyOfflineBundle() remains useful for deterministic unit fixtures,
 * but untrusted metadata should enter through this function so duplicate keys and
 * file-byte hash/length checks cannot be lost during parsing/re-serialization.
 */
export function verifyOfflineBundleBytes({
  trustedState,
  bundle,
  targetPath,
  now = new Date(),
  approveCapabilityExpansion = () => false,
  limits = DEFAULT_LIMITS,
}) {
  if (!isPlainObject(bundle)) {
    fail('INVALID_INPUT', 'raw offline bundle must be an object');
  }

  return verifyOfflineBundle({
    trustedState,
    bundle: {
      target: bundle.target,
      rawMetadata: checkedRawMetadata(bundle, limits),
    },
    targetPath,
    now,
    approveCapabilityExpansion,
    limits,
  });
}
