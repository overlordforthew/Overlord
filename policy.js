/**
 * Action Policy Engine
 *
 * Defines what Overlord auto-executes vs what needs confirmation.
 * Stored here as config so it's explicit, auditable, and editable.
 *
 * Policies:
 *   auto_execute              — run without asking
 *   auto_execute_and_verify   — run, then verify result
 *   ask_confirmation          — ask Gil first
 *   escalate_immediately      — always confirm, never auto-execute
 */

const ACTION_POLICIES = {
  // ---- Container operations ----
  container_restart:          { policy: 'auto_execute_and_verify', riskLevel: 'low' },
  container_stop:             { policy: 'ask_confirmation',        riskLevel: 'medium' },
  container_rm:               { policy: 'ask_confirmation',        riskLevel: 'high' },
  container_prune:            { policy: 'auto_execute',            riskLevel: 'low' },

  // ---- Deploy operations ----
  deploy_coolify:             { policy: 'auto_execute_and_verify', riskLevel: 'low' },
  deploy_docker_compose:      { policy: 'auto_execute_and_verify', riskLevel: 'low' },
  git_push:                   { policy: 'auto_execute_and_verify', riskLevel: 'low' },
  git_force_push:             { policy: 'ask_confirmation',        riskLevel: 'high' },
  git_reset_hard:             { policy: 'escalate_immediately',    riskLevel: 'critical' },

  // ---- Nginx/proxy ----
  nginx_reload:               { policy: 'auto_execute_and_verify', riskLevel: 'low' },
  nginx_test:                 { policy: 'auto_execute',            riskLevel: 'none' },
  traefik_config_change:      { policy: 'ask_confirmation',        riskLevel: 'medium' },

  // ---- Database ----
  db_query_read:              { policy: 'auto_execute',            riskLevel: 'none' },
  db_query_write:             { policy: 'ask_confirmation',        riskLevel: 'medium' },
  db_drop_table:              { policy: 'escalate_immediately',    riskLevel: 'critical' },
  db_truncate:                { policy: 'escalate_immediately',    riskLevel: 'critical' },
  db_migration:               { policy: 'ask_confirmation',        riskLevel: 'high' },

  // ---- Files ----
  file_edit:                  { policy: 'auto_execute',            riskLevel: 'low' },
  file_delete:                { policy: 'ask_confirmation',        riskLevel: 'high' },
  rm_rf:                      { policy: 'escalate_immediately',    riskLevel: 'critical' },

  // ---- Docker maintenance ----
  docker_prune:               { policy: 'auto_execute',            riskLevel: 'low' },
  docker_image_rm:            { policy: 'auto_execute',            riskLevel: 'low' },

  // ---- External / financial ----
  send_email:                 { policy: 'ask_confirmation',        riskLevel: 'medium' },
  send_whatsapp_message:      { policy: 'auto_execute',            riskLevel: 'low' },
  stripe_refund:              { policy: 'escalate_immediately',    riskLevel: 'critical' },
  stripe_cancel_sub:          { policy: 'ask_confirmation',        riskLevel: 'high' },
  spend_money:                { policy: 'escalate_immediately',    riskLevel: 'critical' },

  // ---- Security ----
  disable_fail2ban:           { policy: 'escalate_immediately',    riskLevel: 'critical' },
  modify_firewall:            { policy: 'escalate_immediately',    riskLevel: 'critical' },
  expose_port:                { policy: 'ask_confirmation',        riskLevel: 'high' },
  modify_ssl_cert:            { policy: 'ask_confirmation',        riskLevel: 'high' },

  // ---- Log/diagnostic (safe reads) ----
  read_logs:                  { policy: 'auto_execute',            riskLevel: 'none' },
  check_disk:                 { policy: 'auto_execute',            riskLevel: 'none' },
  check_memory:               { policy: 'auto_execute',            riskLevel: 'none' },
  docker_stats:               { policy: 'auto_execute',            riskLevel: 'none' },
};

const DEFAULT_POLICY = { policy: 'auto_execute', riskLevel: 'low' };

export function getPolicy(actionType) {
  return ACTION_POLICIES[actionType] || DEFAULT_POLICY;
}

export function requiresConfirmation(actionType) {
  const { policy } = getPolicy(actionType);
  return policy === 'ask_confirmation' || policy === 'escalate_immediately';
}

export function isAutoExecutable(actionType) {
  const { policy } = getPolicy(actionType);
  return policy === 'auto_execute' || policy === 'auto_execute_and_verify';
}

export function shouldVerifyAfter(actionType) {
  const { policy } = getPolicy(actionType);
  return policy === 'auto_execute_and_verify';
}

export function getPolicyConfig() {
  return ACTION_POLICIES;
}

/**
 * Format policy table for display.
 */
export function formatPolicyList() {
  const lines = ['*Action Policy Config:*', ''];
  const byPolicy = {};
  for (const [action, config] of Object.entries(ACTION_POLICIES)) {
    if (!byPolicy[config.policy]) byPolicy[config.policy] = [];
    byPolicy[config.policy].push(`${action} (${config.riskLevel})`);
  }
  for (const [policy, actions] of Object.entries(byPolicy)) {
    lines.push(`*${policy}:*`);
    actions.forEach(a => lines.push(`  • ${a}`));
    lines.push('');
  }
  return lines.join('\n').trim();
}
