#!/usr/bin/env node
"use strict";
/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/
Object.defineProperty(exports, "__esModule", { value: true });
// Pre-bundle this add-on's web entry so the host's Parcel build can
// consume a single JS file without having to transform JSX from
// node_modules. Mirrors core's build-web.js.
const fs = require('fs');
const path = require('path');
async function main() {
    let esbuild;
    try {
        esbuild = require('esbuild');
    }
    catch {
        console.error('[@adobedjangir/commerce-admin-audit-log] esbuild missing — run `npm install` in the package directory.');
        process.exit(1);
    }
    const pkgRoot = path.join(__dirname, '..');
    const entry = path.join(pkgRoot, 'web', 'src', 'index.tsx');
    const outdir = path.join(pkgRoot, 'web', 'dist');
    fs.mkdirSync(outdir, { recursive: true });
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'browser',
        outfile: path.join(outdir, 'index.js'),
        packages: 'external',
        jsx: 'automatic',
        loader: { '.tsx': 'tsx', '.ts': 'ts', '.js': 'jsx', '.css': 'css' },
        resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
        target: ['chrome79', 'firefox85', 'safari13'],
        logLevel: 'info'
    });
    console.log('[@adobedjangir/commerce-admin-audit-log] built web/dist/index.js');
}
if (require.main === module)
    main().catch((e) => { console.error(e.message); process.exit(1); });
