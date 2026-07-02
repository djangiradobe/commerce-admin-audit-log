/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Audit log viewer — paginated reader for the `system_config_audit` collection
// written by system-config-save. Filters narrow the result set client+server
// (server applies most filters; path is a client-side substring match).
//
// Each row also exposes a Revert action. "Revert" semantics:
//   - create  → there was no value before, so revert means delete the row
//               (we send USE_DEFAULT_SENTINEL to system-config-save).
//   - update  → write `oldValue` back at the same scope:scopeId/path.
//   - delete  → re-insert `oldValue` at the same scope:scopeId/path.
//
// Sensitive fields are blocked from revert because audit stores
// `[ENCRYPTED]` instead of plaintext — there's nothing to restore.

import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Flex,
  Heading,
  Text,
  TextField,
  Picker,
  Item,
  Button,
  SearchField,
  ProgressCircle,
  Well,
  StatusLight,
  DialogTrigger,
  Dialog,
  Content,
  Header,
  Divider,
  ButtonGroup,
  Checkbox
} from '@adobe/react-spectrum'
import { callAction, resolveActor } from '@adobedjangir/commerce-admin-management/web'
import { getActionKey, getUserRoleProvider } from '@adobedjangir/commerce-admin-management/web'
import { PALETTE, RADIUS, SHADOW } from '@adobedjangir/commerce-admin-management/web'

const PAGE_SIZE_OPTIONS = [
  { id: '25',  label: '25 / page' },
  { id: '50',  label: '50 / page' },
  { id: '100', label: '100 / page' },
  { id: '200', label: '200 / page' }
]
const DEFAULT_PAGE_SIZE = 50
const SENSITIVE_TOKEN = '[ENCRYPTED]'
const USE_DEFAULT_SENTINEL = '__USE_DEFAULT__'
const ACTION_OPTIONS = [
  { id: 'any',    label: 'Any action' },
  { id: 'create', label: 'Create' },
  { id: 'update', label: 'Update' },
  { id: 'delete', label: 'Delete' }
]
const SCOPE_OPTIONS = [
  { id: 'any',      label: 'Any scope' },
  { id: 'default',  label: 'Default' },
  { id: 'websites', label: 'Websites' },
  { id: 'stores',   label: 'Stores' }
]

function actionTone (a) {
  if (a === 'create') return 'positive'
  if (a === 'delete') return 'negative'
  if (a === 'update') return 'notice'
  return 'neutral'
}

function fmtTime (iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString() } catch (_) { return iso }
}

function fmtValue (v) {
  if (v == null) return '∅'
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch (_) { return String(v) }
}

/**
 * Build the payload for system-config-save that reverses an audit row.
 * Returns `{ ok, payload, message }` — when `ok=false`, surface the message
 * to the operator instead of attempting the save.
 */
function buildRevertPayload (row) {
  if (!row || !row.path) {
    return { ok: false, message: 'Audit row is malformed.' }
  }
  if (row.oldValue === SENSITIVE_TOKEN || row.newValue === SENSITIVE_TOKEN) {
    return {
      ok: false,
      message: 'This change is for a sensitive (encrypted) field — the original value is not stored in the audit log, so it cannot be reverted from here.'
    }
  }
  // 'create' had no prior value, so reverting means "delete the override".
  if (row.action === 'create' || row.oldValue == null) {
    return {
      ok: true,
      payload: {
        values: { [row.path]: USE_DEFAULT_SENTINEL },
        scope: row.scope || 'default',
        scopeId: row.scope_id || '0'
      }
    }
  }
  // update / delete: write oldValue back.
  return {
    ok: true,
    payload: {
      values: { [row.path]: row.oldValue },
      scope: row.scope || 'default',
      scopeId: row.scope_id || '0'
    }
  }
}

export default function AuditLog ({ runtime, ims }) {
  // Revert is admin-only. Resolve the caller's role via core's role provider
  // (the ims-access hook); defaults to admin when RBAC isn't installed.
  const useRole = getUserRoleProvider()
  const { role: userRole } = useRole({ runtime, ims })
  const canRevert = (userRole || 'admin') === 'admin'
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [returned, setReturned] = useState(0)
  const [status, setStatus] = useState({ tone: 'neutral', message: '' })

  // Confirmation dialog state — null while closed, the row to revert when open.
  const [confirmRow, setConfirmRow] = useState(null)
  const [reverting, setReverting] = useState(false)

  // Delete (single + multi-select) state. Admin-only.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // { ids: [...] } | null

  // Filters — kept as draft state; user clicks Search to apply (no live
  // re-fetch on every keystroke since the action is a real HTTP call).
  const [scope, setScope] = useState('any')
  const [actionFilter, setActionFilter] = useState('any')
  const [pathFilter, setPathFilter] = useState('')
  const [actor, setActor] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')

  /**
   * Each fetch replaces the current page (skip = page * pageSize). The
   * audit-list action returns `{ items, returned }` — we treat
   * `returned < pageSize` as "no more pages after this one".
   */
  const fetchPage = useCallback(async (nextPage = 0, sizeOverride = null) => {
    const size = sizeOverride || pageSize
    setLoading(true)
    setError(null)
    try {
      const params = { limit: size, skip: nextPage * size }
      if (scope !== 'any') params.scope = scope
      if (actionFilter !== 'any') params.action = actionFilter
      if (pathFilter.trim()) params.path = pathFilter.trim()
      if (actor.trim()) params.actor = actor.trim()
      if (since.trim()) params.since = since.trim()
      if (until.trim()) params.until = until.trim()
      const res = await callAction(
        { runtime, ims },
        getActionKey('systemConfigAuditList'),
        '',
        params
      )
      const body = res?.body || res
      const next = Array.isArray(body?.items) ? body.items : []
      setItems(next)
      setReturned(body?.returned ?? next.length)
      setPage(nextPage)
    } catch (e) {
      setError(e.message || 'Failed to load audit log')
    } finally {
      setLoading(false)
    }
  }, [runtime, ims, scope, actionFilter, pathFilter, actor, since, until, pageSize])

  useEffect(() => {
    fetchPage(0)
    // initial load only — filters refresh on user action
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onSearch = () => fetchPage(0)
  const onPrev = () => { if (page > 0) fetchPage(page - 1) }
  const onNext = () => { if (returned >= pageSize) fetchPage(page + 1) }
  const onChangePageSize = (next) => {
    const n = Number(next) || DEFAULT_PAGE_SIZE
    setPageSize(n)
    fetchPage(0, n) // reset to page 0 when page size changes
  }
  const hasNext = returned >= pageSize
  const hasPrev = page > 0

  /**
   * Pagination bar — rendered above the table. Kept as a local component so
   * we don't repeat the markup if we ever want one at the bottom too.
   */
  const Pagination = () => (
    <View
      paddingX="size-200"
      paddingY="size-150"
      UNSAFE_style={{
        background: PALETTE.surfaceMuted,
        borderBottom: `1px solid ${PALETTE.border}`
      }}
    >
      <Flex gap="size-200" alignItems="center" justifyContent="space-between" wrap>
        <Flex gap="size-150" alignItems="center" wrap>
          <Picker
            aria-label="Rows per page"
            selectedKey={String(pageSize)}
            onSelectionChange={onChangePageSize}
            width="size-1700"
            isDisabled={loading}
          >
            {PAGE_SIZE_OPTIONS.map((o) => <Item key={o.id}>{o.label}</Item>)}
          </Picker>
          <Text UNSAFE_style={{ color: PALETTE.textMuted, fontSize: 12 }}>
            {items.length === 0
              ? 'No rows'
              : <>Page <strong>{page + 1}</strong> · showing rows {page * pageSize + 1}–{page * pageSize + returned}</>}
          </Text>
        </Flex>
        <Flex gap="size-100">
          <Button variant="secondary" onPress={onPrev} isDisabled={!hasPrev || loading}>
            ← Prev
          </Button>
          <Button variant="secondary" onPress={onNext} isDisabled={!hasNext || loading}>
            Next →
          </Button>
        </Flex>
      </Flex>
    </View>
  )

  /** Attempt to revert a row. Confirmation has already been given. */
  const doRevert = useCallback(async (row) => {
    const built = buildRevertPayload(row)
    if (!built.ok) {
      setStatus({ tone: 'negative', message: built.message })
      setConfirmRow(null)
      return
    }
    // Tag the revert audit row with the operator's identity AND the source
    // entry — easier to trace "X reverted Y" in the audit later.
    const baseActor = resolveActor(ims)
    const tagged = row.changedAt
      ? `${baseActor} (revert of ${row.changedAt})`
      : baseActor
    setReverting(true)
    setStatus({ tone: 'notice', message: 'Reverting…' })
    try {
      const res = await callAction(
        { runtime, ims },
        getActionKey('systemConfigSave'),
        '',
        { ...built.payload, actor: tagged }
      )
      const body = res?.body || res
      if (body && body.fieldErrors) {
        const first = Object.values(body.fieldErrors)[0]
        setStatus({ tone: 'negative', message: first || 'Revert rejected by validation' })
      } else {
        setStatus({
          tone: 'positive',
          message: `Reverted ${row.path} at ${row.scope}:${row.scope_id}`
        })
        // The new audit entry lands at the top; jump to page 0 so the user
        // sees it without having to navigate back.
        await fetchPage(0)
      }
    } catch (e) {
      setStatus({ tone: 'negative', message: e.message || 'Revert failed' })
    } finally {
      setReverting(false)
      setConfirmRow(null)
    }
  }, [runtime, ims, fetchPage])

  const startRevert = (row) => {
    // Pre-flight to surface "can't revert sensitive" before opening the dialog.
    const built = buildRevertPayload(row)
    if (!built.ok) {
      setStatus({ tone: 'negative', message: built.message })
      return
    }
    setStatus({ tone: 'neutral', message: '' })
    setConfirmRow(row)
  }

  // ── Delete (admin-only) ──
  const rowId = (row) => row._id || `${row.changedAt}-${row.path}`
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const allVisibleSelected = items.length > 0 && items.every((r) => selectedIds.has(rowId(r)))
  const toggleSelectAll = () => setSelectedIds((prev) => {
    if (allVisibleSelected) return new Set()
    return new Set(items.map(rowId))
  })

  const runDelete = useCallback(async (ids) => {
    if (!ids || ids.length === 0) return
    setDeleting(true)
    setStatus({ tone: 'notice', message: `Deleting ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}…` })
    try {
      const res = await callAction({ runtime, ims }, getActionKey('systemConfigAuditDelete'), '', { ids })
      const body = res?.body || res
      if (body && body.ok) {
        setStatus({ tone: 'positive', message: `Deleted ${body.deleted} of ${body.requested}` })
        setSelectedIds(new Set())
        await fetchPage(0)
      } else {
        setStatus({ tone: 'negative', message: (body && body.error) || 'Delete failed' })
      }
    } catch (e) {
      setStatus({ tone: 'negative', message: e.message || 'Delete failed' })
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }, [runtime, ims, fetchPage])

  // Grid columns — admins get a leading checkbox + wider Actions column.
  const GRID = canRevert
    ? '40px minmax(140px, 180px) minmax(120px, 200px) 110px minmax(180px, 1.2fr) minmax(180px, 1.5fr) minmax(180px, 1.5fr) 180px'
    : 'minmax(140px, 180px) minmax(120px, 200px) 110px minmax(180px, 1.2fr) minmax(180px, 1.5fr) minmax(180px, 1.5fr) 100px'

  return (
    <View padding="size-400" UNSAFE_style={{ background: PALETTE.bg, minHeight: '100vh' }}>
      <Heading level={2} marginTop={0}>Audit Log</Heading>
      <Text UNSAFE_style={{ color: PALETTE.textMuted }}>
        Every save to system_config_data is recorded here with old → new
        values. Sensitive fields show <code>[ENCRYPTED]</code> and cannot be
        reverted from here. Newest entries first.
      </Text>

      {status.message && (
        <View marginTop="size-150">
          <StatusLight variant={status.tone}>{status.message}</StatusLight>
        </View>
      )}

      <View
        marginTop="size-200"
        padding="size-200"
        UNSAFE_style={{
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.xs
        }}
      >
        <Flex gap="size-150" wrap alignItems="end">
          <Picker label="Scope" selectedKey={scope} onSelectionChange={setScope} width="size-1700">
            {SCOPE_OPTIONS.map((s) => <Item key={s.id}>{s.label}</Item>)}
          </Picker>
          <Picker label="Action" selectedKey={actionFilter} onSelectionChange={setActionFilter} width="size-1700">
            {ACTION_OPTIONS.map((s) => <Item key={s.id}>{s.label}</Item>)}
          </Picker>
          <SearchField
            label="Path contains"
            value={pathFilter}
            onChange={setPathFilter}
            onSubmit={onSearch}
            width="size-2400"
            placeholder="section/group/field"
          />
          <TextField
            label="Actor"
            value={actor}
            onChange={setActor}
            width="size-2400"
            placeholder="email or org id"
          />
          <TextField
            label="Since (ISO)"
            value={since}
            onChange={setSince}
            width="size-2400"
            placeholder="2026-01-01T00:00:00Z"
          />
          <TextField
            label="Until (ISO)"
            value={until}
            onChange={setUntil}
            width="size-2400"
            placeholder="2026-12-31T23:59:59Z"
          />
          <Button variant="cta" onPress={onSearch} isDisabled={loading}>
            {loading ? 'Loading…' : 'Search'}
          </Button>
        </Flex>
      </View>

      {error && (
        <Well marginTop="size-200" UNSAFE_style={{ borderColor: PALETTE.danger }}>
          <Text UNSAFE_style={{ color: PALETTE.danger }}>{error}</Text>
        </Well>
      )}

      <View
        marginTop="size-200"
        UNSAFE_style={{
          background: PALETTE.surface,
          border: `1px solid ${PALETTE.border}`,
          borderRadius: RADIUS.lg,
          boxShadow: SHADOW.xs,
          overflow: 'hidden'
        }}
      >
        <Pagination />

        {/* Bulk-delete bar — admin-only, shown when rows are selected. */}
        {canRevert && selectedIds.size > 0 && (
          <View paddingX="size-200" paddingY="size-100" UNSAFE_style={{ background: PALETTE.surfaceMuted, borderBottom: `1px solid ${PALETTE.border}` }}>
            <Flex gap="size-150" alignItems="center">
              <Text UNSAFE_style={{ fontSize: 12, fontWeight: 600 }}>{selectedIds.size} selected</Text>
              <Button variant="negative" onPress={() => setConfirmDelete({ ids: Array.from(selectedIds) })} isDisabled={deleting}>
                Delete selected
              </Button>
              <Button variant="secondary" isQuiet onPress={() => setSelectedIds(new Set())} isDisabled={deleting}>Clear</Button>
            </Flex>
          </View>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          padding: '12px 16px',
          gap: 12,
          background: PALETTE.surfaceMuted,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: PALETTE.textMuted,
          borderBottom: `1px solid ${PALETTE.border}`
        }}>
          {canRevert && (
            <div><Checkbox aria-label="Select all" isSelected={allVisibleSelected} onChange={toggleSelectAll} isDisabled={deleting} /></div>
          )}
          <div>Time</div>
          <div>Actor</div>
          {/* StatusLight's coloured dot takes ~22px before the text, so
              indent the column header to line up with the row content. */}
          <div style={{ paddingLeft: 22 }}>Action</div>
          <div>Path</div>
          <div>Old</div>
          <div>New</div>
          <div>Actions</div>
        </div>

        {loading && items.length === 0 ? (
          <Flex justifyContent="center" margin="size-400">
            <ProgressCircle aria-label="Loading" isIndeterminate />
          </Flex>
        ) : items.length === 0 ? (
          <View padding="size-400">
            <Text UNSAFE_style={{ color: PALETTE.textMuted }}>
              No audit entries match these filters.
            </Text>
          </View>
        ) : (
          items.map((row, i) => {
            const isEncrypted = row.oldValue === SENSITIVE_TOKEN || row.newValue === SENSITIVE_TOKEN
            // Common cell style — preserve whitespace + break long unbroken
            // tokens (URLs, hashes, JSON blobs) so nothing is clipped.
            const cell = {
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              minWidth: 0
            }
            return (
              <div
                key={row._id || `${row.changedAt}-${row.path}-${i}`}
                style={{
                  display: 'grid',
                  // Min/max so columns flex but never collapse below readable.
                  gridTemplateColumns: GRID,
                  padding: '12px 16px',
                  gap: 12,
                  borderBottom: `1px solid ${PALETTE.border}`,
                  fontSize: 13,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  background: i % 2 === 0 ? PALETTE.surface : PALETTE.surfaceSubtle,
                  alignItems: 'start'
                }}
              >
                {canRevert && (
                  <div><Checkbox aria-label="Select row" isSelected={selectedIds.has(rowId(row))} onChange={() => toggleSelect(rowId(row))} isDisabled={deleting} /></div>
                )}
                <div style={{ ...cell, color: PALETTE.text }}>{fmtTime(row.changedAt)}</div>
                <div style={{ ...cell, color: PALETTE.textMuted }}>
                  {row.changedBy || 'system'}
                </div>
                <div>
                  <StatusLight variant={actionTone(row.action)}>
                    {row.action || '?'}
                  </StatusLight>
                </div>
                <div style={cell}>
                  <div>{row.path}</div>
                  <div style={{ color: PALETTE.textMuted, fontSize: 11 }}>{row.scope}:{row.scope_id}</div>
                </div>
                <div style={{ ...cell, color: PALETTE.danger }}>
                  {fmtValue(row.oldValue)}
                </div>
                <div style={{ ...cell, color: PALETTE.success }}>
                  {fmtValue(row.newValue)}
                </div>
                <div>
                  <Flex gap="size-100" wrap>
                    <Button
                      variant="secondary"
                      onPress={() => startRevert(row)}
                      isDisabled={reverting || isEncrypted || !canRevert}
                      UNSAFE_style={{ fontFamily: 'inherit' }}
                    >
                      {isEncrypted ? 'N/A' : (!canRevert ? 'Admin only' : 'Revert')}
                    </Button>
                    {canRevert && (
                      <Button
                        variant="negative"
                        isQuiet
                        onPress={() => setConfirmDelete({ ids: [rowId(row)] })}
                        isDisabled={deleting}
                        UNSAFE_style={{ fontFamily: 'inherit' }}
                      >
                        Delete
                      </Button>
                    )}
                  </Flex>
                </div>
              </div>
            )
          })
        )}

      </View>

      {/* Delete confirmation dialog (single or selected). */}
      <DialogTrigger isOpen={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}>
        <div style={{ display: 'none' }} aria-hidden="true">trigger</div>
        <Dialog>
          <Heading>Delete audit {confirmDelete && confirmDelete.ids.length === 1 ? 'entry' : 'entries'}?</Heading>
          <Divider />
          <Content>
            <Text>
              Permanently delete <strong>{confirmDelete ? confirmDelete.ids.length : 0}</strong> audit
              {confirmDelete && confirmDelete.ids.length === 1 ? ' entry' : ' entries'}? This can't be undone.
            </Text>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={() => setConfirmDelete(null)} isDisabled={deleting}>Cancel</Button>
            <Button variant="negative" onPress={() => runDelete(confirmDelete.ids)} isDisabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </ButtonGroup>
        </Dialog>
      </DialogTrigger>

      {/* Revert confirmation dialog. */}
      <DialogTrigger isOpen={!!confirmRow} onOpenChange={(o) => { if (!o) setConfirmRow(null) }}>
        <div style={{ display: 'none' }} aria-hidden="true">trigger</div>
        <Dialog>
          <Heading>Revert this change?</Heading>
          <Header>
            <Text>{confirmRow?.path} at {confirmRow?.scope}:{confirmRow?.scope_id}</Text>
          </Header>
          <Divider />
          <Content>
            <Text>
              {confirmRow?.action === 'create'
                ? <>This will <strong>delete</strong> the scope-level override and fall back to the inherited default.</>
                : confirmRow?.action === 'delete'
                  ? <>This will <strong>re-insert</strong> the previous value.</>
                  : <>This will replace the current value with the previous value.</>}
            </Text>
            <div style={{
              marginTop: 12,
              padding: 12,
              background: PALETTE.surfaceMuted,
              border: `1px solid ${PALETTE.border}`,
              borderRadius: RADIUS.md,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              wordBreak: 'break-all'
            }}>
              <div style={{ color: PALETTE.textMuted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 }}>
                will be set to
              </div>
              <div style={{ color: PALETTE.success }}>
                {confirmRow?.action === 'create'
                  ? '(inherit from default)'
                  : fmtValue(confirmRow?.oldValue)}
              </div>
            </div>
          </Content>
          <ButtonGroup>
            <Button variant="secondary" onPress={() => setConfirmRow(null)} isDisabled={reverting}>
              Cancel
            </Button>
            <Button variant="cta" onPress={() => doRevert(confirmRow)} isDisabled={reverting}>
              {reverting ? 'Reverting…' : 'Revert'}
            </Button>
          </ButtonGroup>
        </Dialog>
      </DialogTrigger>
    </View>
  )
}
