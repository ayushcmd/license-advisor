/**
 * Open Workers — Issue & PR Webhook Automation Service
 *
 * Implements safe, opt-in webhook event handling for issues and pull requests
 * based on verified repository configuration (.github/open-workers.yml).
 */

import { isBotSender, hasMarker, MARKERS } from '../../core/events/idempotency.js';
import {
  categorizeIssue,
  classifyPullRequestSize,
  formatWelcomeMessage,
  parseOpenWorkersConfig,
  PR_SIZE_THRESHOLDS
} from './engine.js';

/**
 * Fetch and parse .github/open-workers.yml configuration from default branch
 */
async function loadRepositoryConfig(octokit, owner, repo, defaultBranch = 'main') {
  for (const filename of ['.github/open-workers.yml', '.github/open-workers.yaml']) {
    try {
      const res = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: filename,
        ref: defaultBranch
      });
      if (res?.data?.content) {
        const text = Buffer.from(res.data.content, 'base64').toString('utf8');
        return parseOpenWorkersConfig(text);
      }
    } catch {
      // Configuration file does not exist
    }
  }
  return parseOpenWorkersConfig(null);
}

/**
 * Handle issue events (opened, reopened, edited)
 *
 * @param {object} payload
 * @param {object} context
 * @returns {Promise<object>}
 */
export async function handleIssueEvent(payload = {}, context = {}) {
  const action = payload.action;
  const issue = payload.issue;
  const repository = payload.repository;
  const installationId = payload.installation?.id;

  if (!issue || !repository) {
    return { skipped: true, reason: 'INVALID_PAYLOAD' };
  }

  // Guard 1: Ignore pull requests delivered via issues webhook
  if (issue.pull_request) {
    return { skipped: true, reason: 'IS_PULL_REQUEST' };
  }

  // Guard 2: Bot loop protection
  if (isBotSender(payload.sender) || isBotSender(issue.user)) {
    return { skipped: true, reason: 'BOT_SENDER_IGNORED' };
  }

  const owner = repository.owner?.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch || 'main';

  // Resolve octokit for installation
  let octokit = null;
  if (installationId && context.githubContext?.getInstallationOctokit) {
    try {
      octokit = await context.githubContext.getInstallationOctokit(installationId);
    } catch (err) {
      return { skipped: true, reason: 'INSTALLATION_ERROR', error: err.message };
    }
  }

  if (!octokit) {
    return { skipped: true, reason: 'OCTOKIT_UNAVAILABLE' };
  }

  // Guard 3: Strict Opt-in verification (.github/open-workers.yml)
  const config = await loadRepositoryConfig(octokit, owner, repo, defaultBranch);
  if (!config.enabled && !config.issues.labeling.enabled) {
    return {
      skipped: true,
      reason: 'OPT_IN_REQUIRED',
      message: 'Automation is disabled. Enable it by committing .github/open-workers.yml with enabled: true.'
    };
  }

  // Action: Automated categorization & labeling on opened / reopened
  if (action === 'opened' || action === 'reopened') {
    if (config.issues.labeling.enabled) {
      const categorization = categorizeIssue(issue);
      if (categorization.confidence === 'high' && categorization.suggestedLabels.length > 0) {
        try {
          const addRes = await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: issue.number,
            labels: categorization.suggestedLabels
          });
          return {
            success: true,
            action: 'applied_labels',
            issueNumber: issue.number,
            labels: (addRes.data || []).map((l) => (typeof l === 'string' ? l : l.name))
          };
        } catch (err) {
          return {
            success: false,
            action: 'apply_labels_failed',
            error: err.message,
            code: err.status === 403 ? 'INSUFFICIENT_PERMISSIONS' : 'API_ERROR'
          };
        }
      }
    }
  }

  return { skipped: true, reason: 'NO_ACTION_TRIGGERED', action };
}

/**
 * Handle pull request events (opened, synchronize, reopened)
 *
 * @param {object} payload
 * @param {object} context
 * @returns {Promise<object>}
 */
export async function handlePullRequestEvent(payload = {}, context = {}) {
  const action = payload.action;
  const pr = payload.pull_request;
  const repository = payload.repository;
  const installationId = payload.installation?.id;

  if (!pr || !repository) {
    return { skipped: true, reason: 'INVALID_PAYLOAD' };
  }

  // Guard 1: Bot loop protection
  if (isBotSender(payload.sender) || isBotSender(pr.user)) {
    return { skipped: true, reason: 'BOT_SENDER_IGNORED' };
  }

  const owner = repository.owner?.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch || 'main';

  // Resolve octokit for installation
  let octokit = null;
  if (installationId && context.githubContext?.getInstallationOctokit) {
    try {
      octokit = await context.githubContext.getInstallationOctokit(installationId);
    } catch (err) {
      return { skipped: true, reason: 'INSTALLATION_ERROR', error: err.message };
    }
  }

  if (!octokit) {
    return { skipped: true, reason: 'OCTOKIT_UNAVAILABLE' };
  }

  // Guard 2: Strict Opt-in verification (.github/open-workers.yml)
  const config = await loadRepositoryConfig(octokit, owner, repo, defaultBranch);
  if (!config.enabled && !config.pullRequests.welcome.enabled && !config.pullRequests.sizeLabeling.enabled) {
    return {
      skipped: true,
      reason: 'OPT_IN_REQUIRED',
      message: 'Automation is disabled. Enable it by committing .github/open-workers.yml with enabled: true.'
    };
  }

  const results = [];

  // 1. Welcome First-Time Contributors on pull_request.opened
  if (action === 'opened' && config.pullRequests.welcome.enabled) {
    const authorAssociation = pr.author_association;
    const isFirstTimer = authorAssociation === 'FIRST_TIME_CONTRIBUTOR' || authorAssociation === 'FIRST_TIMER' || authorAssociation === 'NONE';

    if (isFirstTimer) {
      // Check existing comments for idempotency marker
      let alreadyWelcomed = false;
      try {
        const commentsRes = await octokit.rest.issues.listComments({
          owner,
          repo,
          issue_number: pr.number,
          per_page: 50
        });
        for (const c of (commentsRes.data || [])) {
          if (hasMarker(c.body, MARKERS.WELCOME)) {
            alreadyWelcomed = true;
            break;
          }
        }
      } catch {
        // Continue if list comments fails
      }

      if (!alreadyWelcomed) {
        try {
          const welcomeBody = formatWelcomeMessage({
            username: pr.user?.login,
            repo: repository.full_name,
            customMessage: config.pullRequests.welcome.message
          });

          const commentRes = await octokit.rest.issues.createComment({
            owner,
            repo,
            issue_number: pr.number,
            body: welcomeBody
          });

          results.push({
            action: 'posted_welcome',
            commentId: commentRes.data.id
          });
        } catch (err) {
          results.push({
            action: 'post_welcome_failed',
            error: err.message,
            code: err.status === 403 ? 'INSUFFICIENT_PERMISSIONS' : 'API_ERROR'
          });
        }
      } else {
        results.push({ action: 'welcome_already_present', skipped: true });
      }
    }
  }

  // 2. PR Size Labeling on pull_request.opened or pull_request.synchronize
  if ((action === 'opened' || action === 'synchronize') && config.pullRequests.sizeLabeling.enabled) {
    const size = classifyPullRequestSize({
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files
    });

    if (size.label) {
      const currentLabels = (pr.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
      const allSizeLabels = PR_SIZE_THRESHOLDS.map((t) => t.label);
      const labelsToRemove = currentLabels.filter((l) => allSizeLabels.includes(l) && l !== size.label);
      const alreadyHasLabel = currentLabels.includes(size.label);

      if (!alreadyHasLabel || labelsToRemove.length > 0) {
        try {
          // Remove outdated size labels
          for (const oldLabel of labelsToRemove) {
            try {
              await octokit.rest.issues.removeLabel({
                owner,
                repo,
                issue_number: pr.number,
                name: oldLabel
              });
            } catch {
              // Ignore if remove fails
            }
          }

          // Add the current size label
          await octokit.rest.issues.addLabels({
            owner,
            repo,
            issue_number: pr.number,
            labels: [size.label]
          });

          results.push({
            action: 'applied_size_label',
            applied: size.label,
            removed: labelsToRemove
          });
        } catch (err) {
          results.push({
            action: 'apply_size_label_failed',
            error: err.message,
            code: err.status === 403 ? 'INSUFFICIENT_PERMISSIONS' : 'API_ERROR'
          });
        }
      } else {
        results.push({ action: 'size_label_already_current', label: size.label });
      }
    }
  }

  return {
    handled: true,
    action,
    pullNumber: pr.number,
    results
  };
}

/**
 * Register issue & PR event handlers with the global event dispatcher
 *
 * @param {object} dispatcher EventDispatcher instance
 */
export function registerAutomationHandlers(dispatcher) {
  if (!dispatcher || typeof dispatcher.register !== 'function') return;

  dispatcher.register('issues', handleIssueEvent);
  dispatcher.register('pull_request', handlePullRequestEvent);
}
