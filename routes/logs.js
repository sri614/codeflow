const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const Execution = require('../models/Execution');

// All routes require authentication
router.use(requireAuth);

/**
 * List execution logs with filtering
 * GET /api/logs
 */
router.get('/', async (req, res) => {
  try {
    const {
      actionType,
      status,
      snippetId,
      workflowId,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
      sort = '-createdAt'
    } = req.query;

    // Build query
    const query = { portalId: req.portalId };

    if (actionType) {
      query.actionType = actionType;
    }

    if (status) {
      query.status = status;
    }

    if (snippetId) {
      query.snippetId = snippetId;
    }

    if (workflowId) {
      query.workflowId = workflowId;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    const logs = await Execution.find(query)
      .sort(sort)
      .skip(parseInt(offset, 10))
      .limit(parseInt(limit, 10));

    const total = await Execution.countDocuments(query);

    res.json({
      logs,
      total,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    console.error('List logs error:', error);
    res.status(500).json({ error: 'Failed to list logs' });
  }
});

/**
 * Get execution statistics
 * GET /api/logs/stats/summary
 * NOTE: This route MUST be defined before /:id to prevent '/stats/summary' matching as id='stats'
 */
router.get('/stats/summary', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days, 10));

    const stats = await Execution.aggregate([
      {
        $match: {
          portalId: req.portalId,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: null,
          totalExecutions: { $sum: 1 },
          successCount: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          errorCount: {
            $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
          },
          timeoutCount: {
            $sum: { $cond: [{ $eq: ['$status', 'timeout'] }, 1, 0] }
          },
          webhookCount: {
            $sum: { $cond: [{ $eq: ['$actionType', 'webhook'] }, 1, 0] }
          },
          codeCount: {
            $sum: { $cond: [{ $eq: ['$actionType', 'code'] }, 1, 0] }
          },
          avgExecutionTime: { $avg: '$executionTimeMs' },
          maxExecutionTime: { $max: '$executionTimeMs' }
        }
      }
    ]);

    const result = stats[0] || {
      totalExecutions: 0,
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      webhookCount: 0,
      codeCount: 0,
      avgExecutionTime: 0,
      maxExecutionTime: 0
    };

    // Calculate success rate
    result.successRate = result.totalExecutions > 0
      ? Math.round((result.successCount / result.totalExecutions) * 100)
      : 0;

    res.json(result);
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * Get executions by day for charts
 * GET /api/logs/stats/daily
 */
router.get('/stats/daily', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days, 10));
    startDate.setHours(0, 0, 0, 0);

    const dailyStats = await Execution.aggregate([
      {
        $match: {
          portalId: req.portalId,
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          total: { $sum: 1 },
          success: {
            $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] }
          },
          error: {
            $sum: { $cond: [{ $eq: ['$status', 'error'] }, 1, 0] }
          },
          webhook: {
            $sum: { $cond: [{ $eq: ['$actionType', 'webhook'] }, 1, 0] }
          },
          code: {
            $sum: { $cond: [{ $eq: ['$actionType', 'code'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({ dailyStats });
  } catch (error) {
    console.error('Get daily stats error:', error);
    res.status(500).json({ error: 'Failed to get daily stats' });
  }
});

/**
 * Get recent errors
 * GET /api/logs/errors/recent
 */
router.get('/errors/recent', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const errors = await Execution.find({
      portalId: req.portalId,
      status: { $in: ['error', 'timeout'] }
    })
      .sort('-createdAt')
      .limit(parseInt(limit, 10))
      .select('actionType snippetName webhookUrl status errorMessage createdAt workflowId');

    res.json({ errors });
  } catch (error) {
    console.error('Get recent errors:', error);
    res.status(500).json({ error: 'Failed to get recent errors' });
  }
});

/**
 * Get a single execution log
 * GET /api/logs/:id
 * NOTE: This route MUST be defined AFTER all specific routes to prevent
 * paths like '/stats/summary' from being matched as id='stats'
 */
router.get('/:id', async (req, res) => {
  try {
    const log = await Execution.findOne({
      _id: req.params.id,
      portalId: req.portalId
    });

    if (!log) {
      return res.status(404).json({ error: 'Log not found' });
    }

    res.json(log);
  } catch (error) {
    console.error('Get log error:', error);
    res.status(500).json({ error: 'Failed to get log' });
  }
});

module.exports = router;
