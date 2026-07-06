#!/usr/bin/env node
/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

const fs = require('fs')
const path = require('path')

// ── Per-add-on configuration ──
const PACKAGE_NAME = '@adobedjangir/commerce-admin-audit-log'
const RUNTIME_KEY  = 'AuditLog'
const INCLUDE_REL  = 'node_modules/@adobedjangir/commerce-admin-audit-log/actions/ext.config.yaml'
const REGISTER_IMPORT = "import registerAuditLog from '@adobedjangir/commerce-admin-audit-log/web'"
const REGISTER_CALL   = 'registerAuditLog()'
const MARKER = `# ${PACKAGE_NAME} (auto-linked on npm install)`

// ── Boilerplate (identical across add-ons; small enough to inline) ──
function findProjectRoot (startDir) {
  let dir = startDir
  while (dir && dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'app.config.yaml'))) return dir
    dir = path.dirname(dir)
  }
  return null
}
function resolveProjectRoot () {
  return (process.env.INIT_CWD && findProjectRoot(process.env.INIT_CWD)) ||
         findProjectRoot(process.cwd())
}

/**
 * Add (or replace) an `application.runtimeManifest.packages.<RUNTIME_KEY>`
 * block that $includes our fragment. Idempotent.
 */
function patchAppConfig (content) {
  // Look for our own marker to detect prior installs.
  // Escape marker special chars before interpolating into the regex —
  // `(auto-linked on npm install)` previously broke the detection.
  const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const blockRe = new RegExp(
    "^[ \\t]*" + ESC(MARKER) + "\\n[ \\t]+" + RUNTIME_KEY + ":[ \\t]*\\n[ \\t]+\\$include:[^\\n]*\\n", "m"
  )
  const desiredBody = `      ${MARKER}\n      ${RUNTIME_KEY}:\n        $include: ${INCLUDE_REL}\n`

  if (blockRe.test(content)) {
    // Already linked — leave it.
    return { content, changed: false, reason: 'already-linked' }
  }

  // Robust idempotency guard: the $include path is unique to this add-on, so
  // if it appears anywhere already, we are linked — even when a YAML
  // re-serialization (e.g. `npx @adobe/aio-commerce-lib-app init` adding the
  // commerce/extensibility/1 extension) moved our marker comment or reflowed
  // blank lines, which defeats the stricter block regex above and would
  // otherwise append a DUPLICATE key → "duplicated mapping key" build error.
  const includeRe = new RegExp("\\$include:[ \\t]*" + ESC(INCLUDE_REL), "m")
  if (includeRe.test(content)) {
    return { content, changed: false, reason: 'already-linked' }
  }

  // 1. application.runtimeManifest.packages exists → append our subkey.
  if (/^application:[ \t]*\n([ \t]+[^\n]*\n)*[ \t]+runtimeManifest:[ \t]*\n([ \t]+[^\n]*\n)*[ \t]+packages:[ \t]*\n/m.test(content)) {
    const next = content.replace(
      /([ \t]+packages:[ \t]*\n)/m,
      (m) => m + desiredBody
    )
    return { content: next, changed: next !== content, reason: 'appended-under-packages' }
  }

  // 2. application.runtimeManifest exists but no `packages:` → add one.
  if (/^application:[ \t]*\n([ \t]+[^\n]*\n)*[ \t]+runtimeManifest:[ \t]*\n/m.test(content)) {
    const next = content.replace(
      /([ \t]+runtimeManifest:[ \t]*\n)/m,
      (m) => m + `    packages:\n${desiredBody}`
    )
    return { content: next, changed: next !== content, reason: 'added-packages' }
  }

  // 3. application: exists but no runtimeManifest → add the whole tree.
  if (/^application:[ \t]*\n/m.test(content)) {
    const next = content.replace(
      /^application:[ \t]*\n/m,
      `application:\n  runtimeManifest:\n    packages:\n${desiredBody}`
    )
    return { content: next, changed: next !== content, reason: 'added-runtimeManifest' }
  }

  // 4. No application: → append the whole block.
  const trimmed = content.replace(/\s+$/, '')
  const sep = trimmed ? '\n\n' : ''
  return {
    content: `${trimmed}${sep}application:\n  runtimeManifest:\n    packages:\n${desiredBody}`,
    changed: true,
    reason: 'appended-application'
  }
}

/**
 * Patch the host's web-src/src/addons.js to import + call our register fn.
 *
 * addons.js (created + owned by core, never overwritten) has two managed
 * regions: an IMPORTS region at module top, and a CALLS region inside the
 * registerAddons() function body. We insert our import into the first and
 * our call into the second. Idempotent — skips if already present.
 */
const IMPORTS_START = '// --- COMMERCE-ADMIN ADDON IMPORTS (auto-managed) ---'
const CALLS_START   = '// --- COMMERCE-ADMIN ADDON CALLS (auto-managed) ---'

// Standard addons.js scaffold. Identical to what core writes — duplicated
// here so an add-on whose postinstall runs BEFORE core's (npm doesn't
// guarantee order) can still create the file and self-register. Core's
// writeIfMissing then leaves it alone; other add-ons just patch it.
function addonsScaffold () {
  return `/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/

// Add-on registry — HOST-OWNED, created once and NEVER overwritten.
// Each optional add-on appends its registration in the marked regions
// below on \`npm install\`. The bootstrap (index.js) imports registerAddons
// and calls it after configureWeb.

${IMPORTS_START}
${'// --- COMMERCE-ADMIN ADDON IMPORTS END ---'}

export default function registerAddons () {
  ${CALLS_START}
  ${'// --- COMMERCE-ADMIN ADDON CALLS END ---'}
}
`
}

function patchAddons (content) {
  if (content.includes(REGISTER_IMPORT) && content.includes(REGISTER_CALL)) {
    return { content, changed: false, reason: 'already-registered' }
  }
  if (!content.includes(IMPORTS_START) || !content.includes(CALLS_START)) {
    // addons.js doesn't have the managed regions — core too old or the
    // file was hand-replaced. Don't guess; leave it.
    return { content, changed: false, reason: 'no-managed-regions' }
  }
  let next = content
  if (!next.includes(REGISTER_IMPORT)) {
    next = next.replace(IMPORTS_START + '\n', IMPORTS_START + '\n' + REGISTER_IMPORT + '\n')
  }
  if (!next.includes(REGISTER_CALL)) {
    next = next.replace(CALLS_START + '\n', CALLS_START + '\n  ' + REGISTER_CALL + '\n')
  }
  return { content: next, changed: next !== content, reason: 'registered' }
}

function main () {
  if (process.env.CONFIGURATION_MANAGEMENT_SKIP_SETUP === '1') return
  const root = resolveProjectRoot()
  if (!root) {
    console.log(`[${PACKAGE_NAME}] No app.config.yaml found — skip setup.`)
    return
  }

  // 1. app.config.yaml
  const cfg = path.join(root, 'app.config.yaml')
  if (fs.existsSync(cfg)) {
    const before = fs.readFileSync(cfg, 'utf8')
    const { content, changed, reason } = patchAppConfig(before)
    if (changed) {
      fs.writeFileSync(cfg, content, 'utf8')
      console.log(`[${PACKAGE_NAME}] app.config.yaml: ${reason}`)
    } else {
      console.log(`[${PACKAGE_NAME}] app.config.yaml: ${reason}`)
    }
  }

  // 2. addon registry (web-src/src/addons.js). Host-owned; normally core
  // creates it, but we create it ourselves when missing so registration
  // doesn't depend on postinstall ordering. Only create when a web-src/
  // shell actually exists (i.e. this is a UI host project).
  const webSrcDir = path.join(root, 'web-src', 'src')
  // Prefer the TS addons file; fall back to a legacy .js; create .tsx if neither.
  let addons = [path.join(webSrcDir, 'addons.tsx'), path.join(webSrcDir, 'addons.js')]
    .find((p) => fs.existsSync(p))
  if (!addons) {
    if (!fs.existsSync(path.join(root, 'web-src'))) {
      console.log(`[${PACKAGE_NAME}] no web-src/ — skip UI registration.`)
      return
    }
    fs.mkdirSync(webSrcDir, { recursive: true })
    addons = path.join(webSrcDir, 'addons.tsx')
    fs.writeFileSync(addons, addonsScaffold(), 'utf8')
    console.log(`[${PACKAGE_NAME}] web-src/src/addons.tsx: created`)
  }
  const before = fs.readFileSync(addons, 'utf8')
  const { content, changed, reason } = patchAddons(before)
  if (changed) fs.writeFileSync(addons, content, 'utf8')
  console.log(`[${PACKAGE_NAME}] ${path.basename(addons)}: ${reason}`)
}

if (require.main === module) {
  try { main() } catch (err) {
    // Never fail npm install on scaffold issues.
    console.error(`[${PACKAGE_NAME}] setup error (install continues):`, err.message)
  }
}

module.exports = { patchAppConfig, patchAddons }
