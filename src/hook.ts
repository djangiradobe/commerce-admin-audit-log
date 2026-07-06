/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Server-side hook for core's system-config-save. Core soft-requires this
// module (`try { require('@adobedjangir/commerce-admin-audit-log/hook') } catch {}`)
// — when the add-on is not installed, audit writes silently no-op.

const AUDIT_COLLECTION = 'system_config_audit'
const AUDIT_MAX_DOCS = 10000
// Run the size-check/compaction on roughly 1 in N writes (not every write).
const COMPACT_EVERY = 20

async function ensureCollection (client, name) {
  try {
    await client.createCollection(name)
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : String(err)
    if (!/exist|already|duplicate/i.test(msg)) throw err
  }
}

// Create the indexes the audit-list query + compaction rely on (sort by
// changedAt, and the common scope-filtered view). Guarded by a per-cold-start
// flag so we don't pay a round-trip on every write; createIndex is idempotent
// (a no-op if the index already exists). Best-effort — never throws.
let auditIndexesEnsured = false
async function ensureAuditIndexes (col, log) {
  if (auditIndexesEnsured) return
  try {
    await col.createIndex({ changedAt: -1 })
    await col.createIndex({ scope: 1, changedAt: -1 })
    auditIndexesEnsured = true
  } catch (err) {
    if (log && log.info) log.info(`audit-log hook: index ensure skipped (${err && err.message})`)
  }
}

/**
 * Append a batch of audit entries. Best-effort; never throws.
 *
 * @param {object} client     ABDB client from core's getClient(...)
 * @param {Array}  entries    [{ scope, scope_id, path, action, oldValue, newValue, changedBy, changedAt }]
 * @param {object} [logger]   aio logger
 */
async function recordAuditEntries (client, entries, logger) {
  const log = logger || { warn: () => {}, info: () => {} }
  if (!client || !Array.isArray(entries) || entries.length === 0) return
  try {
    await ensureCollection(client, AUDIT_COLLECTION)
    const col = await client.collection(AUDIT_COLLECTION)
    await ensureAuditIndexes(col, log)
    // Assign an explicit string _id so entries can be deleted reliably later
    // (a driver-assigned ObjectId serialises to a hex string the UI can't
    // round-trip into a delete filter). Idempotent — keep any _id already set.
    for (const e of entries) {
      if (e && !e._id) {
        e._id = `audit_${String(e.changedAt || Date.now()).replace(/[:.]/g, '-')}_${Math.random().toString(36).slice(2, 8)}`
      }
    }
    // Prefer a single insertMany, but fall back to per-document insertOne on
    // ANY failure — some ABDB driver versions either don't implement
    // insertMany or reject the batch with a message we can't reliably match.
    // insertOne is the same call the core save action uses, so it's known-good.
    let inserted = 0
    try {
      await col.insertMany(entries)
      inserted = entries.length
    } catch (batchErr) {
      log.info(`audit-log hook: insertMany failed (${batchErr && batchErr.message}); falling back to insertOne`)
      for (const e of entries) {
        try {
          await col.insertOne(e)
          inserted += 1
        } catch (oneErr) {
          log.warn(`audit-log hook: insertOne failed for ${e.path} (${oneErr && oneErr.message})`)
        }
      }
    }
    log.info(`audit-log hook: recorded ${inserted}/${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} into ${AUDIT_COLLECTION}`)
    // Best-effort cap — throttled so we don't count on every write. Only ~1 in
    // COMPACT_EVERY writes checks the size, and uses estimatedDocumentCount
    // (metadata-based, O(1)) instead of countDocuments (a full scan).
    if (Math.random() < 1 / COMPACT_EVERY) {
      try {
        const total = await (col.estimatedDocumentCount ? col.estimatedDocumentCount() : col.countDocuments({}))
        if (total > AUDIT_MAX_DOCS) {
          const over = total - AUDIT_MAX_DOCS
          const oldest = await col.find({}, { projection: { _id: 1 } }).sort({ changedAt: 1 }).limit(over).toArray()
          for (const o of oldest) await col.deleteOne({ _id: o._id })
        }
      } catch (_) { /* compaction is best-effort */ }
    }
  } catch (err) {
    log.warn(`audit-log hook: write failed (${err.message})`)
  }
}

export { recordAuditEntries, AUDIT_COLLECTION }
