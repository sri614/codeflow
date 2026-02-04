const express = require('express');
const router = express.Router();
const { verifyWorkflowActionSignature } = require('../middleware/hubspotSignature');
const { executeWebhook, extractOutputFields } = require('../services/webhookDispatcher');
const { executeCode } = require('../services/codeExecutor');
const { decrypt } = require('../services/encryption');
const Portal = require('../models/Portal');
const Snippet = require('../models/Snippet');
const Secret = require('../models/Secret');
const Execution = require('../models/Execution');
const Usage = require('../models/Usage');

/**
 * Send Webhook Action
 * POST /v1/actions/webhook
 */
router.post('/webhook', verifyWorkflowActionSignature, async (req, res) => {
  const startTime = Date.now();
  const { portalId, callbackId } = req;

  const {
    inputFields = {},
    object = {},
    workflow = {}
  } = req.body;

  // Extract webhook configuration from input fields
  const {
    webhookUrl,
    webhookMethod = 'POST',
    webhookHeaders,
    webhookBody,
    outputMappings,
    // Retry configuration
    retryEnabled = 'true',
    maxRetries = '3',
    initialDelayMs,
    retryDelayMs,
    maxDelayMs = '10000'
  } = inputFields;

  if (!webhookUrl) {
    return res.status(400).json({
      outputFields: {
        codeflow_error: 'Missing webhook URL'
      }
    });
  }

  try {
    // Get portal settings
    const portal = await Portal.findOne({ portalId });
    const timeout = portal?.settings?.webhookTimeout || 30000;

    // Build context for template processing
    const context = {
      object,
      workflow,
      inputs: inputFields,
      portalId
    };

    // Parse headers if provided as JSON string
    let headers = {};
    if (webhookHeaders) {
      try {
        headers = typeof webhookHeaders === 'string'
          ? JSON.parse(webhookHeaders)
          : webhookHeaders;
      } catch {
        headers = {};
      }
    }

    // Parse body if provided as JSON string
    let body = webhookBody;
    if (typeof webhookBody === 'string') {
      try {
        body = JSON.parse(webhookBody);
      } catch {
        body = webhookBody;
      }
    }

    // Build retry configuration (handle string "true"/"false" from HubSpot UI)
    const isRetryEnabled = retryEnabled === true || retryEnabled === 'true';
    const retryConfig = isRetryEnabled ? {
      maxRetries: parseInt(maxRetries, 10) || 3,
      initialDelayMs: parseInt(retryDelayMs || initialDelayMs, 10) || 1000,
      maxDelayMs: parseInt(maxDelayMs, 10) || 10000,
      backoffMultiplier: 2
    } : { maxRetries: 0 };

    // Execute the webhook with retry
    const result = await executeWebhook({
      url: webhookUrl,
      method: webhookMethod,
      headers,
      body: body || { object, workflow }
    }, context, timeout, retryConfig);

    // Extract output fields if mappings provided
    let outputFields = {};
    if (outputMappings && result.success) {
      try {
        const mappings = typeof outputMappings === 'string'
          ? JSON.parse(outputMappings)
          : outputMappings;
        outputFields = extractOutputFields(result, mappings);
      } catch {
        // Ignore mapping errors
      }
    }

    // Add status fields
    outputFields.codeflow_success = result.success;
    outputFields.codeflow_status_code = result.httpStatusCode;
    outputFields.codeflow_retries_used = result.retriesUsed || 0;
    if (!result.success) {
      outputFields.codeflow_error = result.errorMessage;
    }

    // Log execution
    await Execution.create({
      portalId,
      actionType: 'webhook',
      webhookUrl,
      webhookMethod,
      workflowId: workflow.workflowId,
      enrollmentId: callbackId,
      objectType: object.objectType,
      objectId: object.objectId,
      status: result.success ? 'success' : result.status,
      executionTimeMs: result.totalExecutionTimeMs || result.executionTimeMs,
      inputData: {
        url: webhookUrl,
        method: webhookMethod,
        retryConfig: retryConfig
      },
      outputData: outputFields,
      errorMessage: result.errorMessage,
      httpStatusCode: result.httpStatusCode,
      httpResponse: result.httpResponse,
      retryAttempts: result.attempts || []
    });

    // Record usage
    await Usage.recordExecution(portalId, {
      actionType: 'webhook',
      status: result.status,
      executionTimeMs: result.executionTimeMs,
      workflowId: workflow.workflowId
    });

    res.json({ outputFields });
  } catch (error) {
    console.error('Webhook action error:', error);

    // Log error execution
    await Execution.create({
      portalId,
      actionType: 'webhook',
      webhookUrl,
      webhookMethod,
      workflowId: workflow?.workflowId,
      status: 'error',
      executionTimeMs: Date.now() - startTime,
      errorMessage: error.message
    });

    res.json({
      outputFields: {
        codeflow_success: false,
        codeflow_error: error.message
      }
    });
  }
});

/**
 * Run Code Action
 * POST /v1/actions/code
 */
router.post('/code', verifyWorkflowActionSignature, async (req, res) => {
  const startTime = Date.now();
  const { portalId, callbackId } = req;

  const {
    inputFields = {},
    object = {},
    workflow = {}
  } = req.body;

  const {
    snippetId,
    inlineCode,
    ...customInputs
  } = inputFields;

  try {
    // Get portal settings
    const portal = await Portal.findOne({ portalId });
    const timeout = portal?.settings?.codeTimeout || 10000;

    // Get code to execute
    let code;
    let snippetDoc = null;

    if (snippetId) {
      snippetDoc = await Snippet.findOne({ _id: snippetId, portalId });
      if (!snippetDoc) {
        return res.json({
          outputFields: {
            codeflow_success: false,
            codeflow_error: 'Snippet not found'
          }
        });
      }
      code = snippetDoc.code;
    } else if (inlineCode) {
      code = inlineCode;
    } else {
      return res.json({
        outputFields: {
          codeflow_success: false,
          codeflow_error: 'No code provided (specify snippetId or inlineCode)'
        }
      });
    }

    // Load secrets for this portal
    const secretDocs = await Secret.find({ portalId });
    const secrets = {};
    const failedSecrets = [];
    for (const secret of secretDocs) {
      try {
        secrets[secret.name] = decrypt(
          secret.encryptedValue,
          secret.iv,
          secret.authTag
        );
        // Update usage
        secret.lastUsedAt = new Date();
        secret.usageCount += 1;
        await secret.save();
      } catch (decryptError) {
        console.error(`Failed to decrypt secret ${secret.name}:`, decryptError.message);
        failedSecrets.push(secret.name);
        // Set to null so code can detect the secret exists but failed to decrypt
        secrets[secret.name] = null;
      }
    }

    // Log warning if any secrets failed to decrypt
    if (failedSecrets.length > 0) {
      console.warn(`[Portal ${portalId}] ${failedSecrets.length} secret(s) failed to decrypt: ${failedSecrets.join(', ')}`);
    }

    // Build context
    const context = {
      object,
      workflow,
      portalId,
      enrollmentId: callbackId
    };

    // Execute code
    const result = await executeCode({
      code,
      inputs: customInputs,
      secrets,
      context,
      timeout
    });

    // Build output fields from result
    const outputFields = {
      codeflow_success: result.success,
      ...(result.output || {})
    };

    if (!result.success) {
      outputFields.codeflow_error = result.errorMessage;
    }

    // Log execution
    await Execution.create({
      portalId,
      actionType: 'code',
      snippetId: snippetDoc?._id,
      snippetName: snippetDoc?.name,
      workflowId: workflow.workflowId,
      enrollmentId: callbackId,
      objectType: object.objectType,
      objectId: object.objectId,
      status: result.status,
      executionTimeMs: result.executionTimeMs,
      inputData: customInputs,
      outputData: result.output,
      errorMessage: result.errorMessage,
      errorStack: result.errorStack
    });

    // Update snippet stats if used
    if (snippetDoc) {
      snippetDoc.executionCount += 1;
      snippetDoc.lastExecutedAt = new Date();
      await snippetDoc.save();
    }

    // Record usage
    await Usage.recordExecution(portalId, {
      actionType: 'code',
      status: result.status,
      executionTimeMs: result.executionTimeMs,
      workflowId: workflow.workflowId,
      snippetId: snippetDoc?._id
    });

    res.json({ outputFields });
  } catch (error) {
    console.error('Code action error:', error);

    await Execution.create({
      portalId,
      actionType: 'code',
      snippetId: inputFields.snippetId,
      workflowId: workflow?.workflowId,
      status: 'error',
      executionTimeMs: Date.now() - startTime,
      errorMessage: error.message
    });

    res.json({
      outputFields: {
        codeflow_success: false,
        codeflow_error: error.message
      }
    });
  }
});

/**
 * Format Data Action
 * POST /v1/actions/format
 */
router.post('/format', verifyWorkflowActionSignature, async (req, res) => {
  const startTime = Date.now();
  const { portalId, callbackId } = req;

  const {
    inputFields = {},
    object = {},
    workflow = {}
  } = req.body;

  const {
    operation,
    input1,
    input2,
    input3,
    formatOptions
  } = inputFields;

  if (!operation) {
    return res.json({
      outputFields: {
        codeflow_success: false,
        codeflow_error: 'No operation specified'
      }
    });
  }

  try {
    let result;
    let resultNumber = null;

    switch (operation) {
      // Text Operations
      case 'uppercase':
        result = String(input1 || '').toUpperCase();
        break;

      case 'lowercase':
        result = String(input1 || '').toLowerCase();
        break;

      case 'capitalize':
        result = String(input1 || '').replace(/\b\w/g, char => char.toUpperCase());
        break;

      case 'trim':
        result = String(input1 || '').trim();
        break;

      case 'concat':
        result = String(input1 || '') + String(input2 || '') + String(input3 || '');
        break;

      case 'substring': {
        const str = String(input1 || '');
        const start = parseInt(input2, 10) || 0;
        const length = input3 ? parseInt(input3, 10) : undefined;
        result = length !== undefined ? str.substring(start, start + length) : str.substring(start);
        break;
      }

      case 'replace':
        result = String(input1 || '').split(String(input2 || '')).join(String(input3 || ''));
        break;

      case 'split': {
        const delimiter = input2 || ',';
        const index = parseInt(input3, 10);
        const parts = String(input1 || '').split(delimiter);
        result = !isNaN(index) ? (parts[index] || '') : parts.join('|');
        break;
      }

      case 'length':
        result = String(input1 || '').length.toString();
        resultNumber = String(input1 || '').length;
        break;

      // Number Operations
      case 'number_format': {
        const num = parseFloat(input1);
        if (isNaN(num)) {
          result = input1;
        } else {
          const decimals = parseInt(formatOptions || input2, 10) || 2;
          result = num.toFixed(decimals);
          resultNumber = parseFloat(result);
        }
        break;
      }

      case 'currency': {
        const num = parseFloat(input1);
        if (isNaN(num)) {
          result = input1;
        } else {
          const currency = formatOptions || input2 || 'USD';
          const locale = input3 || 'en-US';
          try {
            result = new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: currency
            }).format(num);
          } catch {
            result = `${currency} ${num.toFixed(2)}`;
          }
          resultNumber = num;
        }
        break;
      }

      case 'percentage': {
        const num = parseFloat(input1);
        if (isNaN(num)) {
          result = input1;
        } else {
          const decimals = parseInt(formatOptions || input2, 10) || 0;
          const percentage = num * 100;
          result = percentage.toFixed(decimals) + '%';
          resultNumber = percentage;
        }
        break;
      }

      case 'round': {
        const num = parseFloat(input1);
        if (isNaN(num)) {
          result = input1;
        } else {
          const decimals = parseInt(formatOptions || input2, 10) || 0;
          const factor = Math.pow(10, decimals);
          resultNumber = Math.round(num * factor) / factor;
          result = resultNumber.toString();
        }
        break;
      }

      case 'floor': {
        const num = parseFloat(input1);
        resultNumber = isNaN(num) ? 0 : Math.floor(num);
        result = resultNumber.toString();
        break;
      }

      case 'ceil': {
        const num = parseFloat(input1);
        resultNumber = isNaN(num) ? 0 : Math.ceil(num);
        result = resultNumber.toString();
        break;
      }

      case 'abs': {
        const num = parseFloat(input1);
        resultNumber = isNaN(num) ? 0 : Math.abs(num);
        result = resultNumber.toString();
        break;
      }

      // Math Operations
      case 'add': {
        const num1 = parseFloat(input1) || 0;
        const num2 = parseFloat(input2) || 0;
        resultNumber = num1 + num2;
        result = resultNumber.toString();
        break;
      }

      case 'subtract': {
        const num1 = parseFloat(input1) || 0;
        const num2 = parseFloat(input2) || 0;
        resultNumber = num1 - num2;
        result = resultNumber.toString();
        break;
      }

      case 'multiply': {
        const num1 = parseFloat(input1) || 0;
        const num2 = parseFloat(input2) || 0;
        resultNumber = num1 * num2;
        result = resultNumber.toString();
        break;
      }

      case 'divide': {
        const num1 = parseFloat(input1) || 0;
        const num2 = parseFloat(input2);
        if (isNaN(num2) || num2 === 0) {
          return res.json({
            outputFields: {
              codeflow_success: false,
              codeflow_error: 'Cannot divide by zero or invalid divisor'
            }
          });
        }
        resultNumber = num1 / num2;
        result = resultNumber.toString();
        break;
      }

      // Date Operations
      case 'date_format': {
        const date = input1 ? new Date(input1) : new Date();
        if (isNaN(date.getTime())) {
          result = input1;
        } else {
          const format = formatOptions || input2 || 'YYYY-MM-DD';
          result = formatDate(date, format);
        }
        break;
      }

      case 'date_add': {
        const date = input1 ? new Date(input1) : new Date();
        const days = parseInt(input2, 10) || 0;
        if (isNaN(date.getTime())) {
          result = input1;
        } else {
          date.setDate(date.getDate() + days);
          const format = formatOptions || input3 || 'YYYY-MM-DD';
          result = formatDate(date, format);
        }
        break;
      }

      case 'date_subtract': {
        const date = input1 ? new Date(input1) : new Date();
        const days = parseInt(input2, 10) || 0;
        if (isNaN(date.getTime())) {
          result = input1;
        } else {
          date.setDate(date.getDate() - days);
          const format = formatOptions || input3 || 'YYYY-MM-DD';
          result = formatDate(date, format);
        }
        break;
      }

      case 'date_diff': {
        const date1 = new Date(input1);
        const date2 = input2 ? new Date(input2) : new Date();
        if (isNaN(date1.getTime()) || isNaN(date2.getTime())) {
          result = '0';
          resultNumber = 0;
        } else {
          const diffTime = Math.abs(date2 - date1);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          resultNumber = diffDays;
          result = diffDays.toString();
        }
        break;
      }

      case 'now': {
        const format = formatOptions || input1 || 'YYYY-MM-DD HH:mm:ss';
        result = formatDate(new Date(), format);
        break;
      }

      // JSON Operations
      case 'json_get': {
        try {
          const obj = typeof input1 === 'string' ? JSON.parse(input1) : input1;
          const path = input2 || '';
          result = getNestedValue(obj, path);
          if (typeof result === 'object') {
            result = JSON.stringify(result);
          } else {
            result = String(result);
          }
          if (!isNaN(parseFloat(result))) {
            resultNumber = parseFloat(result);
          }
        } catch {
          result = '';
        }
        break;
      }

      case 'json_stringify':
        try {
          result = JSON.stringify(typeof input1 === 'string' ? JSON.parse(input1) : input1);
        } catch {
          result = String(input1);
        }
        break;

      case 'json_parse':
        try {
          const parsed = JSON.parse(input1);
          result = JSON.stringify(parsed);
        } catch {
          result = input1;
        }
        break;

      // Logic Operations
      case 'default_value':
        result = (input1 !== null && input1 !== undefined && input1 !== '')
          ? String(input1)
          : String(input2 || '');
        break;

      case 'conditional': {
        // input1 = condition value, input2 = then value, input3 = else value
        const isTruthy = input1 && input1 !== 'false' && input1 !== '0' && input1 !== 'null' && input1 !== 'undefined';
        result = isTruthy ? String(input2 || '') : String(input3 || '');
        break;
      }

      default:
        return res.json({
          outputFields: {
            codeflow_success: false,
            codeflow_error: `Unknown operation: ${operation}`
          }
        });
    }

    // Log execution
    await Execution.create({
      portalId,
      actionType: 'format',
      workflowId: workflow.workflowId,
      enrollmentId: callbackId,
      objectType: object.objectType,
      objectId: object.objectId,
      status: 'success',
      executionTimeMs: Date.now() - startTime,
      inputData: { operation, input1, input2, input3, formatOptions },
      outputData: { result, result_number: resultNumber }
    });

    // Record usage
    await Usage.recordExecution(portalId, {
      actionType: 'format',
      status: 'success',
      executionTimeMs: Date.now() - startTime,
      workflowId: workflow.workflowId
    });

    res.json({
      outputFields: {
        codeflow_success: true,
        result: result,
        result_number: resultNumber
      }
    });
  } catch (error) {
    console.error('Format action error:', error);

    await Execution.create({
      portalId,
      actionType: 'format',
      workflowId: workflow?.workflowId,
      status: 'error',
      executionTimeMs: Date.now() - startTime,
      errorMessage: error.message
    });

    res.json({
      outputFields: {
        codeflow_success: false,
        codeflow_error: error.message
      }
    });
  }
});

// Helper function to format dates
function formatDate(date, format) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');

  const replacements = {
    'YYYY': date.getFullYear(),
    'YY': String(date.getFullYear()).slice(-2),
    'MM': pad(date.getMonth() + 1),
    'M': date.getMonth() + 1,
    'DD': pad(date.getDate()),
    'D': date.getDate(),
    'HH': pad(date.getHours()),
    'H': date.getHours(),
    'hh': pad(date.getHours() % 12 || 12),
    'h': date.getHours() % 12 || 12,
    'mm': pad(date.getMinutes()),
    'm': date.getMinutes(),
    'ss': pad(date.getSeconds()),
    's': date.getSeconds(),
    'A': date.getHours() >= 12 ? 'PM' : 'AM',
    'a': date.getHours() >= 12 ? 'pm' : 'am'
  };

  let result = format;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.replace(new RegExp(token, 'g'), value);
  }
  return result;
}

// Helper function to get nested value from object
function getNestedValue(obj, path) {
  if (!path) return obj;
  const keys = path.split('.');
  let value = obj;
  for (const key of keys) {
    if (value === null || value === undefined) return '';
    // Handle array index
    const arrayMatch = key.match(/^(\w+)\[(\d+)\]$/);
    if (arrayMatch) {
      value = value[arrayMatch[1]];
      if (Array.isArray(value)) {
        value = value[parseInt(arrayMatch[2], 10)];
      } else {
        return '';
      }
    } else {
      value = value[key];
    }
  }
  return value !== undefined ? value : '';
}

/**
 * Test endpoint for debugging
 * POST /v1/actions/test
 */
router.post('/test', async (req, res) => {
  res.json({
    success: true,
    message: 'CodeFlow actions endpoint is working',
    timestamp: new Date().toISOString(),
    receivedBody: req.body
  });
});

/**
 * Simple Code execution endpoint for testing (no auth required)
 * POST /v1/actions/simple-code
 */
router.post('/simple-code', async (req, res) => {
  console.log('Simple code execution received:', JSON.stringify(req.body, null, 2));

  const {
    code,
    inlineCode,
    inputs = {},
    timeout = 10000
  } = req.body;

  const codeToExecute = code || inlineCode;

  if (!codeToExecute) {
    return res.json({
      success: false,
      error: 'No code provided. Send "code" or "inlineCode" in request body.'
    });
  }

  try {
    // Mock context for testing
    const context = {
      object: req.body.object || { objectType: 'contact', objectId: 'test-123' },
      workflow: req.body.workflow || { workflowId: 'test-workflow' },
      portalId: 'test-portal'
    };

    // Execute code
    const result = await executeCode({
      code: codeToExecute,
      inputs,
      secrets: {},
      context,
      timeout
    });

    res.json({
      success: result.success,
      output: result.output,
      consoleOutput: result.consoleOutput,
      executionTimeMs: result.executionTimeMs,
      error: result.errorMessage
    });
  } catch (error) {
    console.error('Code execution error:', error.message);
    res.json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Simple Webhook endpoint for HubSpot's built-in webhook action
 * POST /v1/actions/simple-webhook
 *
 * This endpoint accepts HubSpot workflow action format:
 * { callbackId, origin, context, object, fields, inputFields, typedInputs }
 */
router.post('/simple-webhook', async (req, res) => {
  console.log('Simple webhook received:', JSON.stringify(req.body, null, 2));

  // HubSpot sends webhook config inside inputFields or fields
  const inputFields = req.body.inputFields || req.body.fields || req.body;
  console.log('Extracted inputFields:', JSON.stringify(inputFields, null, 2));

  const {
    webhookUrl,
    webhookMethod = 'POST',
    webhookBody,
    webhookHeaders,
    webhookParams,  // Query parameters for GET requests
    // Retry configuration
    retryEnabled = 'true',
    maxRetries = '3',
    retryDelayMs = '1000',
    ...otherData
  } = inputFields;

  const method = (webhookMethod || 'POST').toUpperCase();
  console.log(`Webhook URL: ${webhookUrl}, Method: ${method}`);

  // If no webhookUrl provided, just echo back the received data
  if (!webhookUrl) {
    return res.json({
      success: true,
      message: 'Data received (no webhookUrl provided)',
      receivedData: req.body,
      timestamp: new Date().toISOString()
    });
  }

  try {
    // Parse headers if provided
    let headers = {};
    if (webhookHeaders) {
      try {
        headers = typeof webhookHeaders === 'string'
          ? JSON.parse(webhookHeaders)
          : webhookHeaders;
      } catch (e) {
        // Ignore header parse errors
      }
    }

    // Parse query parameters if provided
    let params = null;
    if (webhookParams) {
      try {
        params = typeof webhookParams === 'string'
          ? JSON.parse(webhookParams)
          : webhookParams;
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Parse body - use webhookBody if provided, otherwise send otherData
    let body = null;
    if (webhookBody) {
      try {
        body = typeof webhookBody === 'string' ? JSON.parse(webhookBody) : webhookBody;
      } catch (e) {
        body = { data: webhookBody };
      }
    } else if (Object.keys(otherData).length > 0) {
      body = otherData;
    }

    console.log(`Sending ${method} request to: ${webhookUrl}`);
    if (body) console.log(`Request body:`, JSON.stringify(body, null, 2));
    if (params) console.log(`Query params:`, JSON.stringify(params, null, 2));

    // Build retry configuration
    const isRetryEnabled = retryEnabled === true || retryEnabled === 'true';
    const retryConfig = isRetryEnabled ? {
      maxRetries: parseInt(maxRetries, 10) || 3,
      initialDelayMs: parseInt(retryDelayMs, 10) || 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2
    } : { maxRetries: 0 };

    // Execute with retry support
    const result = await executeWebhook({
      url: webhookUrl,
      method: method,
      headers,
      body,
      params
    }, {}, 30000, retryConfig);

    console.log(`Webhook response: ${result.httpStatusCode} in ${result.totalExecutionTimeMs || result.executionTimeMs}ms`);
    if (result.data) console.log(`Response data:`, typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : result.data);

    // Convert response to string for HubSpot output field compatibility
    const responseStr = result.data
      ? (typeof result.data === 'object' ? JSON.stringify(result.data) : String(result.data))
      : null;

    res.json({
      success: result.success,
      statusCode: result.httpStatusCode || 0,
      executionTimeMs: result.totalExecutionTimeMs || result.executionTimeMs,
      retriesUsed: result.retriesUsed || 0,
      response: responseStr,
      error: result.errorMessage
    });
  } catch (error) {
    console.error('Webhook error:', error.message);

    res.json({
      success: false,
      statusCode: 0,
      executionTimeMs: 0,
      retriesUsed: 0,
      error: error.message
    });
  }
});

module.exports = router;
