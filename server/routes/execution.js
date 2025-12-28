import express from 'express';
import { executeRule, executeMultipleRules, getQuickBooksDataContext } from '../services/ruleExecutor.js';
import { injectOAuthToken } from '../services/oauthTokenManager.js';

const router = express.Router();

/**
 * Execute a single rule against QuickBooks data
 * POST /api/execution/rule
 */
router.post('/rule', injectOAuthToken, async (req, res) => {
  try {
    const { rule, realmId, accessToken, entity } = req.body;

    // Validate required parameters
    if (!rule) {
      return res.status(400).json({
        success: false,
        error: 'Rule is required'
      });
    }

    if (!realmId || !accessToken || !entity) {
      return res.status(400).json({
        success: false,
        error: 'realmId, accessToken, and entity are required'
      });
    }

    // Validate rule structure
    if (!rule.conditions || !Array.isArray(rule.conditions)) {
      return res.status(400).json({
        success: false,
        error: 'Rule must have a conditions array'
      });
    }

    console.log(`🚀 Executing rule ${rule.id || rule.rule_type} against ${entity}...`);

    // Execute the rule
    const result = await executeRule(rule, { realmId, accessToken, entity });

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: `Rule executed successfully. ${result.data.execution_summary.flagged_count} transactions flagged.`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Rule execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute rule',
      details: error.message
    });
  }
});

/**
 * Execute multiple rules against QuickBooks data
 * POST /api/execution/rules
 */
router.post('/rules', injectOAuthToken, async (req, res) => {
  try {
    const { rules, realmId, accessToken, entity } = req.body;

    // Validate required parameters
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Rules array is required and must not be empty'
      });
    }

    if (!realmId || !accessToken || !entity) {
      return res.status(400).json({
        success: false,
        error: 'realmId, accessToken, and entity are required'
      });
    }

    // Validate each rule structure
    for (const rule of rules) {
      if (!rule.conditions || !Array.isArray(rule.conditions)) {
        return res.status(400).json({
          success: false,
          error: `Rule ${rule.id || rule.rule_type} must have a conditions array`
        });
      }
    }

    console.log(`🚀 Executing ${rules.length} rules against ${entity}...`);

    // Execute the rules
    const result = await executeMultipleRules(rules, { realmId, accessToken, entity });

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: `Batch execution completed. ${result.data.summary.total_transactions_flagged} total transactions flagged.`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('Batch rule execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute rules',
      details: error.message
    });
  }
});

/**
 * Execute all active rules against QuickBooks data
 * POST /api/execution/all-active
 */
router.post('/all-active', injectOAuthToken, async (req, res) => {
  try {
    const { realmId, accessToken, entity } = req.body;

    if (!realmId || !accessToken || !entity) {
      return res.status(400).json({
        success: false,
        error: 'realmId, accessToken, and entity are required'
      });
    }

    // Get all active rules from storage
    // This would typically come from a database, but for now we'll use the in-memory storage
    // You'll need to import the rules storage or pass the rules in the request body
    
    // For now, we'll require rules to be passed in the body
    const { rules } = req.body;
    
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Rules array is required for all-active execution'
      });
    }

    // Filter to only active rules
    const activeRules = rules.filter(rule => rule.is_active !== false);

    if (activeRules.length === 0) {
      return res.json({
        success: true,
        data: {
          summary: {
            total_rules_executed: 0,
            successful_executions: 0,
            failed_executions: 0,
            total_transactions_checked: 0,
            total_transactions_flagged: 0,
            total_execution_time: 0
          },
          individual_results: [],
          executed_at: new Date().toISOString()
        },
        message: 'No active rules found to execute'
      });
    }

    console.log(`🚀 Executing ${activeRules.length} active rules against ${entity}...`);

    // Execute the active rules
    const result = await executeMultipleRules(activeRules, { realmId, accessToken, entity });

    if (result.success) {
      res.json({
        success: true,
        data: result.data,
        message: `All active rules executed. ${result.data.summary.total_transactions_flagged} total transactions flagged.`
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('All-active execution error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to execute all active rules',
      details: error.message
    });
  }
});

/**
 * Get complete QuickBooks data context for analysis
 * GET /api/execution/data-context
 */
router.get('/data-context', async (req, res) => {
  // For GET requests, we need to handle OAuth token injection differently
  try {
    const { realmId, accessToken } = req.query;
    
    // If accessToken is provided, use it
    if (accessToken) {
      return handleDataContextRequest(req, res);
    }
    
    // If realmId is provided but no accessToken, try to get OAuth token
    if (realmId && !accessToken) {
      const { getAccessToken } = await import('../services/oauthTokenManager.js');
      const { accessToken: oauthToken } = await getAccessToken(realmId);
      req.query.accessToken = oauthToken;
      return handleDataContextRequest(req, res);
    }
    
    return res.status(400).json({
      success: false,
      error: 'realmId and accessToken (or OAuth connection) are required'
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: error.message,
      requiresOAuth: true
    });
  }
});

async function handleDataContextRequest(req, res) {
  try {
    const { realmId, accessToken, entity } = req.query;

    if (!realmId || !accessToken || !entity) {
      return res.status(400).json({
        success: false,
        error: 'realmId, accessToken, and entity are required'
      });
    }

    console.log(`📊 Fetching complete data context for ${entity}...`);

    // Get the complete QuickBooks data context
    const dataContext = await getQuickBooksDataContext({ realmId, accessToken, entity });

    res.json({
      success: true,
      data: dataContext,
      message: `Complete data context retrieved for ${entity}`
    });

  } catch (error) {
    console.error('Data context fetch error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch data context',
      details: error.message
    });
  }
}

export default router; 