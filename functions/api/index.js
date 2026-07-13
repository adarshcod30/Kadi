// index.js — Catalyst Advanced I/O Function entry point.
// Catalyst invokes an Express-style handler; we reuse the same app as local dev.
// Deploy: this directory is the function `source`; catalyst-config.json sets stack=node.
const { buildApp } = require('./app');

const app = buildApp();

// Catalyst Advanced I/O passes (req, res) like Express — the app handles routing.
module.exports = app;
