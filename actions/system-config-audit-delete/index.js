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

async function main (params) {
  const logger = Core.Logger('system-config-audit-delete', { level: params.LOG_LEVEL || 'info' })

  if (rbacHook && rbacHook.assertMinRole) {
    let roleErr = null
    try { roleErr = await rbacHook.assertMinRole(params, 'admin') } catch (_) { roleErr = null }
    if (roleErr) return { statusCode: 403, body: { ok: false, error: roleErr } }
  }

  const ids = normalizeIds(params)
  if (ids.length === 0) return { statusCode: 400, body: { ok: false, error: 'Provide id or ids to delete.' } }

  let handle
  try { handle = await getClient(params) } catch (e) {
    return errorResponse(500, `ABDB connect failed: ${e.message}`, logger)
  }
  const { client, close } = handle
  try {
    const col = await client.collection(COLLECTION)
    let deleted = 0
    try {
      const res = await col.deleteMany({ _id: { $in: ids } })
      deleted = (res && (res.deletedCount ?? res.deleted)) || 0
    } catch (_) {
      // Fallback for drivers without deleteMany: per-id deleteOne.
      for (const id of ids) {
        try { const r = await col.deleteOne({ _id: id }); deleted += (r && (r.deletedCount ?? r.deleted)) || 0 } catch (_) {}
      }
    }
    return { statusCode: 200, body: { ok: true, requested: ids.length, deleted } }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'audit delete failed', logger)
  } finally {
    try { await close() } catch (_) {}
  }
}

exports.main = main
