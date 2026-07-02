# @adobedjangir/commerce-admin-audit-log

Audit-log + revert add-on for
[`@adobedjangir/commerce-admin-management`](https://www.npmjs.com/package/@adobedjangir/commerce-admin-management).

Records **every** system-config change (old → new, actor, timestamp) and adds an
**Audit Log** tab to inspect, filter, and revert changes.

---

## What it adds

| Piece | Where |
|---|---|
| **Audit Log** page | System nav — paginated, filterable table of every change |
| `system-config-audit-list` action | Reads the audit collection (newest first, filters) |
| Server-side hook (`./hook`) | Core's save action calls `recordAuditEntries(...)` on every write |

Each entry captures: `scope`, `scope_id`, `path`, `action` (create/update/delete),
`oldValue`, `newValue`, `changedBy`, `changedAt`. Sensitive fields are stored as
`[ENCRYPTED]` (never plaintext) and can't be reverted from the UI.

## Filtering & revert

- Filter by scope, action, path substring, actor, and date range.
- **Revert** an entry to roll a value back (create → deletes the override;
  update/delete → writes the previous value back).

> **Revert is admin-only** when the
> [`ims-access`](https://www.npmjs.com/package/@adobedjangir/commerce-admin-ims-access)
> RBAC add-on is installed. Without RBAC, revert is open.

---

## Install

```bash
npm install @adobedjangir/commerce-admin-audit-log
aio app deploy
```

`npm install` auto-registers the tab + action via the core discovery mechanism.
**`aio app deploy` is required** so that:
- the `AuditLog` action package deploys, and
- core's `system-config-save` action rebuilds and bundles this add-on's hook
  (so writes are actually recorded).

## How recording works

Core's save action soft-requires `@adobedjangir/commerce-admin-audit-log/hook`.
When installed, every successful config write is appended to the
`system_config_audit` ABDB collection (best-effort — a logging failure never
fails the save). When not installed, audit entries are computed but discarded.

## Notes

- The audit collection is capped (oldest entries compacted) to bound growth.
- Writes use `insertMany` with a per-document `insertOne` fallback for ABDB
  driver compatibility.

## License

Apache-2.0
