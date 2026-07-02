/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Register Audit Log into the host's commerce-admin-management instance.
// Idempotent — calling twice just re-registers the same entries.
//
// Usage (host's web-src/src/index.js, scaffolded by this add-on's postinstall):
//   import registerAuditLog from '@adobedjangir/commerce-admin-audit-log/web'
//   registerAuditLog()
//
// configureWeb is core's own — extraNav/extraPages/actionKeys are merged
// (append + dedup by id), so every add-on can chain its own contribution
// without clobbering siblings.

import { configureWeb } from '@adobedjangir/commerce-admin-management/web'
import AuditLog from './AuditLog'

export default function registerAuditLog () {
  configureWeb({
    actionKeys: {
      systemConfigAuditList: 'AuditLog/system-config-audit-list',
      systemConfigAuditDelete: 'AuditLog/system-config-audit-delete'
    },
    extraNav: [{
      id: 'audit-log',
      path: '/audit-log',
      label: 'Audit Log',
      icon: 'Properties',
      parentId: 'system'
    }],
    extraPages: { 'audit-log': AuditLog }
  })
}

export { default as AuditLog } from './AuditLog'
