/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Paginated audit-log reader. Returns newest entries first; supports filtering
// by scope, path substring, actor, and date range. The save action writes
// the docs; this action only reads. Sensitive values are already redacted at
// write time, so this endpoint is safe to expose to read-only roles.

const { Core } = require('@adobe/aio-sdk')
const { errorResponse } = require('@adobedjangir/commerce-admin-management/actions/utils')
const { getClient } = require('@adobedjangir/commerce-admin-management/abdb')

const COLLECTION = 'system_config_audit'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

function buildFilter (params) {
  const f = {}
  if (params.scope) f.scope = String(params.scope)
  if (params.scopeId) f.scope_id = String(params.scopeId)
  if (params.actor) f.changedBy = String(params.actor)
  if (params.action && ['create', 'update', 'delete'].includes(params.action)) {
    f.action = params.action
  }
  if (params.since) f.changedAt = { ...(f.changedAt || {}), $gte: String(params.since) }
  if (params.until) f.changedAt = { ...(f.changedAt || {}), $lte: String(params.until) }
  return f
}

async function main (params) {
  const logger = Core.Logger('system-config-audit-list', { level: params.LOG_LEVEL || 'info' })

  const limit = Math.min(
    Math.max(parseInt(params.limit, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const skip = Math.max(parseInt(params.skip, 10) || 0, 0)
  const filter = buildFilter(params)
  // Client-side path filter — $regex isn't reliably supported across ABDB
  // driver versions, so we do a substring match in app-land after fetch.
  const pathFilter = params.path ? String(params.path).toLowerCase() : null

  let dbHandle
  try {
    dbHandle = await getClient(params)
  } catch (e) {
    return errorResponse(500, `ABDB connect failed: ${e.message}`, logger)
  }
  const { client, close } = dbHandle

  try {
    // The collection is created lazily by the first audit write. If nothing
    // has been saved yet it may not exist — tolerate that and return empty
    // rather than 500ing on a missing collection.
    try {
      await client.createCollection(COLLECTION)
    } catch (e) {
      const m = (e && e.message) ? String(e.message) : String(e)
      if (!/exist|already|duplicate/i.test(m)) logger.warn(`ensureCollection: ${m}`)
    }
    const col = await client.collection(COLLECTION)
    // Newest first. Without an index ABDB will scan, but the cap on audit
    // doc count keeps this bounded.
    let cursor = col.find(filter).sort({ changedAt: -1 })
    if (!pathFilter) {
      cursor = cursor.skip(skip).limit(limit)
    }
    let docs = await cursor.toArray()
    if (pathFilter) {
      docs = docs.filter((d) => (d.path || '').toLowerCase().includes(pathFilter))
      docs = docs.slice(skip, skip + limit)
    }
    return {
      statusCode: 200,
      body: { ok: true, items: docs, limit, skip, returned: docs.length }
    }
  } catch (error) {
    logger.error(error)
    return errorResponse(500, error.message || 'audit list failed', logger)
  } finally {
    try { await close() } catch (_) {}
  }
}

exports.main = main
