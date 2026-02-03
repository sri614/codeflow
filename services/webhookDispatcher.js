const axios = require('axios');
const Handlebars = require('handlebars');
const { URL } = require('url');

/**
 * Private/internal IP ranges that should be blocked for SSRF protection
 */
const BLOCKED_IP_PATTERNS = [
  /^127\./,                          // Loopback (127.0.0.0/8)
  /^10\./,                           // Private Class A (10.0.0.0/8)
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // Private Class B (172.16.0.0/12)
  /^192\.168\./,                     // Private Class C (192.168.0.0/16)
  /^169\.254\./,                     // Link-local (169.254.0.0/16)
  /^0\./,                            // Current network (0.0.0.0/8)
  /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-7])\./,  // Carrier-grade NAT (100.64.0.0/10)
  /^192\.0\.0\./,                    // IETF Protocol Assignments (192.0.0.0/24)
  /^192\.0\.2\./,                    // TEST-NET-1 (192.0.2.0/24)
  /^198\.51\.100\./,                 // TEST-NET-2 (198.51.100.0/24)
  /^203\.0\.113\./,                  // TEST-NET-3 (203.0.113.0/24)
  /^224\./,                          // Multicast (224.0.0.0/4)
  /^240\./,                          // Reserved (240.0.0.0/4)
  /^255\./,                          // Broadcast
  /^::1$/,                           // IPv6 loopback
  /^fc00:/i,                         // IPv6 unique local
  /^fe80:/i,                         // IPv6 link-local
];

/**
 * Blocked hostnames for SSRF protection
 */
const BLOCKED_HOSTNAMES = [
  'localhost',
  'localhost.localdomain',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  'metadata.google.internal',        // GCP metadata
  '169.254.169.254',                 // AWS/Azure/GCP metadata
  'metadata.azure.com',              // Azure metadata
];

/**
 * Validate URL for SSRF protection
 * @param {string} urlString - The URL to validate
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateWebhookUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http and https protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return { valid: false, error: `Protocol '${parsedUrl.protocol}' is not allowed. Use http or https.` };
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { valid: false, error: `Hostname '${hostname}' is not allowed for security reasons` };
  }

  // Check if hostname looks like an IP address
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    // Check against blocked IP patterns
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: `IP address '${hostname}' is in a blocked range` };
      }
    }
  }

  // Block IPv6 internal addresses
  if (hostname.startsWith('[') || hostname.includes(':')) {
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { valid: false, error: `IPv6 address '${hostname}' is in a blocked range` };
      }
    }
  }

  // Block URLs with credentials
  if (parsedUrl.username || parsedUrl.password) {
    return { valid: false, error: 'URLs with embedded credentials are not allowed' };
  }

  return { valid: true };
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN']
};

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} - Resolves after delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter
 * @param {number} attempt - Current attempt number (0-based)
 * @param {Object} config - Retry configuration
 * @returns {number} - Delay in milliseconds
 */
function calculateBackoffDelay(attempt, config) {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // Add jitter (±25%) to prevent thundering herd
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

/**
 * Check if error/response is retryable
 * @param {Object} result - Execution result
 * @param {Error} error - Error object (if any)
 * @param {Object} config - Retry configuration
 * @returns {boolean} - True if should retry
 */
function isRetryable(result, error, config) {
  // Check for retryable error codes
  if (error && config.retryableErrors.includes(error.code)) {
    return true;
  }

  // Check for retryable HTTP status codes
  if (result && result.httpStatusCode && config.retryableStatusCodes.includes(result.httpStatusCode)) {
    return true;
  }

  // Timeout is retryable
  if (result && result.status === 'timeout') {
    return true;
  }

  return false;
}

/**
 * Process template strings with Handlebars
 * @param {string} template - Template string with {{variable}} placeholders
 * @param {Object} context - Context object with values
 * @returns {string} - Processed string
 */
function processTemplate(template, context) {
  if (!template || typeof template !== 'string') {
    return template;
  }

  try {
    const compiled = Handlebars.compile(template, { noEscape: true });
    return compiled(context);
  } catch (error) {
    console.error('Template processing error:', error.message);
    return template;
  }
}

/**
 * Process an object's values recursively with templates
 * @param {Object} obj - Object to process
 * @param {Object} context - Context for templates
 * @returns {Object} - Processed object
 */
function processObjectTemplates(obj, context) {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => processObjectTemplates(item, context));
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = processTemplate(value, context);
    } else if (typeof value === 'object') {
      result[key] = processObjectTemplates(value, context);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Execute a single webhook request (no retry)
 * @param {Object} config - Webhook configuration
 * @param {Object} context - Context data from HubSpot workflow
 * @param {number} timeout - Request timeout in ms
 * @param {boolean} skipValidation - Skip URL validation (used when called from executeWebhook which already validated)
 * @returns {Object} - Response data
 */
async function executeSingleRequest(config, context, timeout = 30000, skipValidation = false) {
  const startTime = Date.now();

  // Process templates in URL and body
  const url = processTemplate(config.url, context);
  const method = (config.method || 'POST').toUpperCase();

  // Validate URL for SSRF protection (if not already validated)
  if (!skipValidation) {
    const urlValidation = validateWebhookUrl(url);
    if (!urlValidation.valid) {
      return {
        success: false,
        status: 'error',
        errorMessage: `URL validation failed: ${urlValidation.error}`,
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  // Build headers
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'CodeFlow/1.0',
    ...(config.headers ? processObjectTemplates(config.headers, context) : {})
  };

  // Build request body
  let data = null;
  let params = config.params ? processObjectTemplates(config.params, context) : undefined;

  if (config.body) {
    let processedBody;
    if (typeof config.body === 'string') {
      // Try to parse as JSON template
      const processed = processTemplate(config.body, context);
      try {
        processedBody = JSON.parse(processed);
      } catch {
        processedBody = processed;
      }
    } else {
      processedBody = processObjectTemplates(config.body, context);
    }

    // For GET requests, convert body to query parameters
    if (method === 'GET' && typeof processedBody === 'object') {
      params = { ...params, ...processedBody };
    } else {
      // POST, PUT, PATCH, DELETE - send body in request body
      data = processedBody;
    }
  }

  let error = null;
  try {
    const response = await axios({
      method,
      url,
      headers,
      data,
      params,
      timeout,
      validateStatus: () => true // Don't throw on any status code
    });

    const executionTimeMs = Date.now() - startTime;

    // Parse response
    let responseData = response.data;
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch {
        // Keep as string
      }
    }

    const isSuccess = response.status >= 200 && response.status < 300;

    return {
      success: isSuccess,
      status: isSuccess ? 'success' : 'error',
      httpStatusCode: response.status,
      httpResponse: typeof responseData === 'object'
        ? JSON.stringify(responseData).slice(0, 10000)
        : String(responseData).slice(0, 10000),
      data: responseData,
      executionTimeMs,
      headers: response.headers,
      error: null
    };
  } catch (err) {
    error = err;
    const executionTimeMs = Date.now() - startTime;

    if (err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
      return {
        success: false,
        status: 'timeout',
        errorMessage: `Request timed out after ${timeout}ms`,
        executionTimeMs,
        error: err
      };
    }

    return {
      success: false,
      status: 'error',
      errorMessage: err.message,
      errorCode: err.code,
      executionTimeMs,
      error: err
    };
  }
}

/**
 * Execute a webhook request with retry logic
 * @param {Object} config - Webhook configuration
 * @param {Object} context - Context data from HubSpot workflow
 * @param {number} timeout - Request timeout in ms
 * @param {Object} retryConfig - Retry configuration (optional)
 * @returns {Object} - Response data with retry info
 */
async function executeWebhook(config, context, timeout = 30000, retryConfig = {}) {
  const totalStartTime = Date.now();

  // Process the URL template first to get the final URL
  const processedUrl = processTemplate(config.url, context);

  // Validate URL for SSRF protection
  const urlValidation = validateWebhookUrl(processedUrl);
  if (!urlValidation.valid) {
    return {
      success: false,
      status: 'error',
      errorMessage: `URL validation failed: ${urlValidation.error}`,
      executionTimeMs: Date.now() - totalStartTime,
      totalExecutionTimeMs: Date.now() - totalStartTime,
      attempts: [],
      retriesUsed: 0
    };
  }

  // Merge retry config with defaults
  const retry = {
    ...DEFAULT_RETRY_CONFIG,
    ...retryConfig
  };

  // Disable retry if maxRetries is 0
  if (retry.maxRetries === 0) {
    return executeSingleRequest(config, context, timeout, true); // skip validation - already done
  }

  let lastResult = null;
  let attempts = [];

  for (let attempt = 0; attempt <= retry.maxRetries; attempt++) {
    // Wait before retry (skip for first attempt)
    if (attempt > 0) {
      const delay = calculateBackoffDelay(attempt - 1, retry);
      console.log(`Webhook retry attempt ${attempt}/${retry.maxRetries} after ${delay}ms delay`);
      await sleep(delay);
    }

    // Execute the request (skip validation - already done above)
    const result = await executeSingleRequest(config, context, timeout, true);

    // Track attempt info
    attempts.push({
      attempt: attempt + 1,
      status: result.status,
      httpStatusCode: result.httpStatusCode,
      executionTimeMs: result.executionTimeMs,
      errorMessage: result.errorMessage
    });

    lastResult = result;

    // If successful, return immediately
    if (result.success) {
      return {
        ...result,
        totalExecutionTimeMs: Date.now() - totalStartTime,
        attempts,
        retriesUsed: attempt
      };
    }

    // Check if we should retry
    if (attempt < retry.maxRetries && isRetryable(result, result.error, retry)) {
      console.log(`Webhook failed (${result.errorMessage || result.httpStatusCode}), will retry...`);
      continue;
    }

    // Not retryable or max retries reached
    break;
  }

  // Return final result with retry info
  return {
    ...lastResult,
    totalExecutionTimeMs: Date.now() - totalStartTime,
    attempts,
    retriesUsed: attempts.length - 1,
    maxRetriesReached: attempts.length > retry.maxRetries
  };
}

/**
 * Extract output fields from response based on mappings
 * @param {Object} response - Webhook response
 * @param {Array} outputMappings - Array of output field mappings
 * @returns {Object} - Extracted output fields
 */
function extractOutputFields(response, outputMappings) {
  if (!outputMappings || !response.data) {
    return {};
  }

  const outputs = {};

  for (const mapping of outputMappings) {
    const { outputFieldName, jsonPath } = mapping;

    if (!jsonPath) {
      continue;
    }

    // Simple dot-notation path extraction
    const value = getValueByPath(response.data, jsonPath);
    if (value !== undefined) {
      outputs[outputFieldName] = value;
    }
  }

  return outputs;
}

/**
 * Get value from object by dot-notation path
 * @param {Object} obj - Source object
 * @param {string} path - Dot-notation path (e.g., "data.user.name")
 * @returns {any} - Value at path or undefined
 */
function getValueByPath(obj, path) {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    // Handle array index notation like "items[0]"
    const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      current = current[arrayMatch[1]];
      if (Array.isArray(current)) {
        current = current[parseInt(arrayMatch[2], 10)];
      } else {
        return undefined;
      }
    } else {
      current = current[part];
    }
  }

  return current;
}

module.exports = {
  executeWebhook,
  executeSingleRequest,
  processTemplate,
  processObjectTemplates,
  extractOutputFields,
  getValueByPath,
  validateWebhookUrl,
  DEFAULT_RETRY_CONFIG
};
