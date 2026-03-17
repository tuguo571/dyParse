import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

function readEnv(name, fallback) {
  const denoValue = globalThis.Deno?.env?.get?.(name);
  if (typeof denoValue === 'string' && denoValue.length > 0) {
    return denoValue;
  }

  const processValue = process.env[name];
  if (typeof processValue === 'string' && processValue.length > 0) {
    return processValue;
  }

  return fallback;
}

const PARSE_ENDPOINT = readEnv('PARSE_ENDPOINT', 'https://www.hellotik.app/api/parse');
const PARSE_PAGE_URL = readEnv('PARSE_PAGE_URL', 'https://www.hellotik.app/zh/douyin');
const PARSE_SIGN_SECRET = readEnv('PARSE_SIGN_SECRET', '');
const PARSE_DECRYPT_SECRET = readEnv('PARSE_DECRYPT_SECRET', '');
const STANDARD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CUSTOM_B64 = 'ZYXABCDEFGHIJKLMNOPQRSTUVWzyxabcdefghijklmnopqrstuvw9876543210-_';
const XOR_KEY = 0x5a;
const DEFAULT_USER_AGENT = readEnv(
  'DEFAULT_USER_AGENT',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
);

function randomToken(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const buffer = crypto.randomBytes(length * 2);

  for (const value of buffer) {
    result += alphabet[value % alphabet.length];
    if (result.length >= length) {
      break;
    }
  }

  return result;
}

function currentShanghaiDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function replaceBD(value) {
  return value.replace(/b/g, '#').replace(/d/g, 'F').replace(/#/g, 'C');
}

function md5(value) {
  return crypto.createHash('md5').update(value, 'utf8').digest('hex');
}

function requireConfig(name, value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function generateXAuthToken(payload, salt, ts, secret) {
  const query = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${payload[key]}`)
    .join('&');

  return replaceBD(md5(`${query}&salt=${salt}&ts=${ts}&secret=${secret}`));
}

function buildParsePayload(requestURL, overrides = {}) {
  const signSecret = requireConfig('PARSE_SIGN_SECRET', PARSE_SIGN_SECRET);
  const basePayload = {
    requestURL,
    isMobile: 'false',
    isoCode: 'CN',
    adType: 'adsense',
    uwx_id: `uwx_${randomToken(12)}`,
    successCount: '1',
    totalSuccessCount: '1',
    firstSuccessDate: currentShanghaiDate(),
    ...overrides
  };

  const time = Math.floor(Date.now() / 1000);
  const key = randomToken(8);
  const token = generateXAuthToken(basePayload, key, time, signSecret);

  return {
    payload: {
      ...basePayload,
      time,
      key
    },
    token
  };
}

function base64CustomDecode(value) {
  let result = '';

  for (const char of value) {
    const index = CUSTOM_B64.indexOf(char);
    result += index === -1 ? char : STANDARD_B64[index];
  }

  return result;
}

function blockReverse(value, blockSize = 8) {
  let result = '';

  for (let index = 0; index < value.length; index += blockSize) {
    const chunk = value.slice(index, index + blockSize);
    result += chunk.split('').reverse().join('');
  }

  return result;
}

function xorBinaryString(value, key = XOR_KEY) {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    result += String.fromCharCode(value.charCodeAt(index) ^ key);
  }

  return result;
}

function decodeIvBase64(encodedKey) {
  const binary = Buffer.from(encodedKey, 'base64').toString('binary');
  const xorDecoded = xorBinaryString(binary);
  const reversed = blockReverse(xorDecoded);
  return base64CustomDecode(reversed);
}

function decryptParseResponse(encryptedData, encodedKey, secret = PARSE_DECRYPT_SECRET) {
  const decryptSecret = requireConfig('PARSE_DECRYPT_SECRET', secret);
  const ciphertextBase64 = base64CustomDecode(
    blockReverse(xorBinaryString(Buffer.from(encryptedData, 'base64').toString('binary')))
  );
  const ivBase64 = decodeIvBase64(encodedKey);
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(decryptSecret, 'utf8'),
    Buffer.from(ivBase64, 'base64')
  );

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final()
  ]).toString('utf8');

  return JSON.parse(decrypted);
}

async function parseByHellotik(requestURL, overrides = {}) {
  const { payload, token } = buildParsePayload(requestURL, overrides);
  const response = await fetch(PARSE_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: '*/*',
      'Content-Type': 'application/json',
      Origin: 'https://www.hellotik.app',
      Referer: PARSE_PAGE_URL,
      'User-Agent': DEFAULT_USER_AGENT,
      'X-Auth-Token': token
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`parse request failed: ${response.status} ${response.statusText} ${text}`.trim());
  }

  const json = await response.json();
  if (!json || typeof json !== 'object') {
    throw new Error('parse response is not valid JSON');
  }

  if (json.status !== 0) {
    throw new Error(`parse response status is not 0: ${JSON.stringify(json)}`);
  }

  if (!json.encrypt || !json.data || !json.key) {
    return {
      request: payload,
      token,
      raw: json,
      parsed: json.data ?? null
    };
  }

  return {
    request: payload,
    token,
    raw: json,
    parsed: decryptParseResponse(json.data, json.key)
  };
}

function buildCliSummary(result) {
  const parsed = result?.parsed || {};
  const variants = (((parsed.videos || [])[0] || {}).video_fullinfo || []).map((item) => ({
    type: item.type,
    size: item.size,
    url: item.url
  }));

  return {
    request: result.request,
    token: result.token,
    title: parsed.title || '',
    type: parsed.type || '',
    cover: parsed.cover || '',
    url: parsed.url || '',
    variants
  };
}

async function main() {
  const [, , requestURL, ...rest] = process.argv;
  const outputFull = rest.includes('--full');

  if (!requestURL) {
    console.error('Usage: node index.mjs <douyin-url> [--full]');
    process.exitCode = 1;
    return;
  }

  try {
    const result = await parseByHellotik(requestURL);
    const output = outputFull ? result : buildCliSummary(result);
    console.log(JSON.stringify(output, null, 2));
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          success: false,
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  }
}

export {
  buildParsePayload,
  buildCliSummary,
  decryptParseResponse,
  generateXAuthToken,
  parseByHellotik
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
