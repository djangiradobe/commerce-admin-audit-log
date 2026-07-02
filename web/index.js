/*
Copyright 2025 Adobe. All rights reserved.
Licensed under the Apache License, Version 2.0
*/
// Thin re-export of the pre-built bundle. Adobe's Parcel resolver ignores
// the package.json "exports" map, so it loads THIS file for the "/web"
// import — which must point at the transpiled dist, never at raw JSX src.
export * from './dist/index.js'
export { default } from './dist/index.js'
