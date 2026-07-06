/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Delete one or more audit-log entries by _id. Admin-only (destructive).
// Accepts a single `id` (string) or `ids` (array of strings) — the same
// endpoint powers per-row delete and multi-select "delete selected".

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('@adobedjangir/commerce-admin-management/actions/utils')
const { getClient } = require('@adobedjangir/commerce-admin-management/abdb')

// Soft RBAC hook — deleting audit entries is admin-only (literal require so
// esbuild bundles it; see core system-config-save for the rationale).
let rbacHook = null
try { rbacHook = require('@adobedjangir/commerce-admin-ims-access/hook') } catch (_) { rbacHook = null }

const COLLECTION = 'system_config_audit'

function normalizeIds (params) {
  if (Array.isArray(params.ids)) return params.ids.map((x) => String(x)).filter(Boolean)
  if (params.id != null && String(params.id).trim()) return [String(params.id).trim()]
  return []
}

// Composite keys identify an entry by its content, not its _id. This is the
// reliable path: entries written before explicit string _ids carry a
// driver-assigned ObjectId that a hex string won't match in an _id filter.
// A (changedAt, path, scope, scope_id, action) tuple uniquely identifies an
// entry (a given path is recorded once per scope per save timestamp).
function normalizeKeys (params) {
  if (!Array.isArray(params.keys)) return []
  return params.keys
    .filter((k) => k && (k.changedAt || k.path))
    .map((k) => {
      const f: any = {}
      if (k.changedAt != null) f.changedAt = String(k.changedAt)
      if (k.path != null) f.path = String(k.path)
      if (k.scope != null) f.scope = String(k.scope)
      if (k.scope_id != null) f.scope_id = String(k.scope_id)
      if (k.action != null) f.action = String(k.action)
      return f
    })
}

async function main (params) {
  const logger = Core.Logger('system-config-audit-delete', { level: params.LOG_LEVEL || 'info' })

  if (rbacHook && rbacHook.assertMinRole) {
    let roleErr = null
    try { roleErr = await rbacHook.assertMinRole(params, 'admin') } catch (_) { roleErr = null }
    if (roleErr) return { statusCode: 403, body: { ok: false, error: roleErr } }
  }

  const ids = normalizeIds(params)
  const keys = normalizeKeys(params)
  const requested = keys.length || ids.length
  if (requested === 0) return { statusCode: 400, body: { ok: false, error: 'Provide keys (or ids) to delete.' } }

  let handle
  try { handle = await getClient(params) } catch (e) {
    return errorResponse(500, `ABDB connect failed: ${e.message}`, logger)
  }
  const { client, close } = handle
  try {
    const col = await client.collection(COLLECTION)
    let deleted = 0
    const countOf = (r) => (r && (r.deletedCount ?? r.deleted)) || 0

    // Preferred: content-key delete (works regardless of _id type).
    for (const key of keys) {
      try { deleted += countOf(await col.deleteMany(key)) } catch (_) {
        try { deleted += countOf(await col.deleteOne(key)) } catch (_) {}
      }
    }
    // Fallback: string-_id delete (new entries carry explicit string _ids).
    if (keys.length === 0 && ids.length) {
      try { deleted += countOf(await col.deleteMany({ _id: { $in: ids } })) } catch (_) {
        for (const id of ids) { try { deleted += countOf(await col.deleteOne({ _id: id })) } catch (_) {} }
      }
    }
    return { statusCode: 200, body: { ok: true, requested, deleted } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'audit delete failed', logger)
  } finally {
    try { await close() } catch (_) {}
  }
}

export { main }
