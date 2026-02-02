const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { validateCode } = require('../services/codeExecutor');
const Snippet = require('../models/Snippet');

/**
 * Escape special regex characters to prevent ReDoS attacks
 * @param {string} str - The string to escape
 * @returns {string} - Escaped string safe for use in regex
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// All routes require authentication
router.use(requireAuth);

/**
 * List all snippets for the portal
 * GET /api/snippets
 */
router.get('/', async (req, res) => {
  try {
    const { search, sort = '-updatedAt', limit = 50, offset = 0 } = req.query;

    const query = { portalId: req.portalId, isActive: true };

    // Search by name or description (escape regex special chars to prevent ReDoS)
    if (search) {
      const safeSearch = escapeRegex(search);
      query.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { description: { $regex: safeSearch, $options: 'i' } }
      ];
    }

    const snippets = await Snippet.find(query)
      .select('-code') // Don't include code in list
      .sort(sort)
      .skip(parseInt(offset, 10))
      .limit(parseInt(limit, 10));

    const total = await Snippet.countDocuments(query);

    res.json({
      snippets,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('List snippets error:', error);
    res.status(500).json({ error: 'Failed to list snippets' });
  }
});

/**
 * Get a single snippet
 * GET /api/snippets/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const snippet = await Snippet.findOne({
      _id: req.params.id,
      portalId: req.portalId
    });

    if (!snippet) {
      return res.status(404).json({ error: 'Snippet not found' });
    }

    res.json(snippet);
  } catch (error) {
    console.error('Get snippet error:', error);
    res.status(500).json({ error: 'Failed to get snippet' });
  }
});

/**
 * Create a new snippet
 * POST /api/snippets
 */
router.post('/', async (req, res) => {
  try {
    const { name, description, code, inputs, outputs } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    // Check snippet limit
    const portal = req.portal;
    const maxSnippets = portal.settings?.maxSnippets || 100;
    const currentCount = await Snippet.countDocuments({
      portalId: req.portalId,
      isActive: true
    });

    if (currentCount >= maxSnippets) {
      return res.status(400).json({
        error: `Snippet limit reached (${maxSnippets})`
      });
    }

    // Check for duplicate name
    const existing = await Snippet.findOne({
      portalId: req.portalId,
      name: name.trim()
    });

    if (existing) {
      return res.status(400).json({ error: 'A snippet with this name already exists' });
    }

    // Validate code syntax (basic check)
    try {
      new Function(code);
    } catch (syntaxError) {
      return res.status(400).json({
        error: 'Invalid JavaScript syntax',
        details: syntaxError.message
      });
    }

    const snippet = await Snippet.create({
      portalId: req.portalId,
      name: name.trim(),
      description: description?.trim(),
      code,
      inputs: inputs || [],
      outputs: outputs || [],
      createdBy: req.portal.userEmail
    });

    res.status(201).json(snippet);
  } catch (error) {
    console.error('Create snippet error:', error.message);
    console.error('Full error:', error);

    if (error.code === 11000) {
      return res.status(400).json({ error: 'A snippet with this name already exists' });
    }

    res.status(500).json({ error: 'Failed to create snippet', details: error.message });
  }
});

/**
 * Update a snippet
 * PUT /api/snippets/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { name, description, code, inputs, outputs, isActive } = req.body;

    const snippet = await Snippet.findOne({
      _id: req.params.id,
      portalId: req.portalId
    });

    if (!snippet) {
      return res.status(404).json({ error: 'Snippet not found' });
    }

    // If updating code, validate syntax
    if (code !== undefined) {
      const validation = validateCode(code);
      if (!validation.valid) {
        return res.status(400).json({
          error: 'Invalid JavaScript syntax',
          details: validation.error,
          line: validation.line
        });
      }
      snippet.code = code;
      snippet.version += 1;
    }

    // Check for name conflicts if renaming
    if (name && name.trim() !== snippet.name) {
      const existing = await Snippet.findOne({
        portalId: req.portalId,
        name: name.trim(),
        _id: { $ne: snippet._id }
      });

      if (existing) {
        return res.status(400).json({ error: 'A snippet with this name already exists' });
      }
      snippet.name = name.trim();
    }

    if (description !== undefined) snippet.description = description?.trim();
    if (inputs !== undefined) snippet.inputs = inputs;
    if (outputs !== undefined) snippet.outputs = outputs;
    if (isActive !== undefined) snippet.isActive = isActive;

    snippet.updatedBy = req.portal.userEmail;
    await snippet.save();

    res.json(snippet);
  } catch (error) {
    console.error('Update snippet error:', error);

    if (error.code === 11000) {
      return res.status(400).json({ error: 'A snippet with this name already exists' });
    }

    res.status(500).json({ error: 'Failed to update snippet' });
  }
});

/**
 * Delete a snippet (soft delete)
 * DELETE /api/snippets/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const snippet = await Snippet.findOne({
      _id: req.params.id,
      portalId: req.portalId
    });

    if (!snippet) {
      return res.status(404).json({ error: 'Snippet not found' });
    }

    // Soft delete
    snippet.isActive = false;
    await snippet.save();

    res.json({ success: true, message: 'Snippet deleted' });
  } catch (error) {
    console.error('Delete snippet error:', error);
    res.status(500).json({ error: 'Failed to delete snippet' });
  }
});

/**
 * Test execute a snippet
 * POST /api/snippets/:id/test
 */
router.post('/:id/test', async (req, res) => {
  try {
    const { inputs = {} } = req.body;

    const snippet = await Snippet.findOne({
      _id: req.params.id,
      portalId: req.portalId
    });

    if (!snippet) {
      return res.status(404).json({ error: 'Snippet not found' });
    }

    const { executeCode } = require('../services/codeExecutor');
    const { decrypt } = require('../services/encryption');
    const Secret = require('../models/Secret');

    // Load secrets
    const secretDocs = await Secret.find({ portalId: req.portalId });
    const secrets = {};
    const failedSecrets = [];
    for (const secret of secretDocs) {
      try {
        secrets[secret.name] = decrypt(secret.encryptedValue, secret.iv, secret.authTag);
      } catch (decryptError) {
        console.error(`Failed to decrypt secret ${secret.name}:`, decryptError.message);
        failedSecrets.push(secret.name);
        // Set to null so code can detect the secret exists but failed to decrypt
        secrets[secret.name] = null;
      }
    }

    // Log warning if any secrets failed to decrypt
    if (failedSecrets.length > 0) {
      console.warn(`[Portal ${req.portalId}] ${failedSecrets.length} secret(s) failed to decrypt during test: ${failedSecrets.join(', ')}`);
    }

    // Mock context for testing
    const context = {
      object: { objectType: 'contact', objectId: '12345' },
      workflow: { workflowId: 'test' },
      portalId: req.portalId
    };

    const result = await executeCode({
      code: snippet.code,
      inputs,
      secrets,
      context,
      timeout: 10000
    });

    res.json({
      success: result.success,
      status: result.status,
      output: result.output,
      consoleOutput: result.consoleOutput,
      executionTimeMs: result.executionTimeMs,
      error: result.errorMessage
    });
  } catch (error) {
    console.error('Test snippet error:', error);
    res.status(500).json({ error: 'Failed to test snippet' });
  }
});

module.exports = router;
