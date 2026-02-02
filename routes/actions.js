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
 * This endpoint accepts a simpler format:
 * { webhookUrl, webhookMethod, webhookBody, message, contactId, ... }
 */
router.post('/simple-webhook', async (req, res) => {
  console.log('Simple webhook received:', JSON.stringify(req.body, null, 2));

  const {
    webhookUrl,
    webhookMethod = 'POST',
    webhookBody,
    webhookHeaders,
    // Retry configuration
    retryEnabled = 'true',
    maxRetries = '3',
    retryDelayMs = '1000',
    ...otherData
  } = req.body;

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

    // Parse body - use webhookBody if provided, otherwise send otherData
    let body = otherData;
    if (webhookBody) {
      try {
        body = typeof webhookBody === 'string' ? JSON.parse(webhookBody) : webhookBody;
      } catch (e) {
        body = { data: webhookBody, ...otherData };
      }
    }

    console.log(`Sending ${webhookMethod} request to: ${webhookUrl}`);

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
      method: webhookMethod,
      headers,
      body
    }, {}, 30000, retryConfig);

    console.log(`Webhook response: ${result.httpStatusCode} in ${result.totalExecutionTimeMs || result.executionTimeMs}ms`);

    res.json({
      success: result.success,
      statusCode: result.httpStatusCode || 0,
      executionTimeMs: result.totalExecutionTimeMs || result.executionTimeMs,
      retriesUsed: result.retriesUsed || 0,
      response: result.data,
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
