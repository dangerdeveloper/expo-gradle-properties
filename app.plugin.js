// Expo resolves `['expo-gradle-properties', {...}]` by looking for this file at the
// package root. Keep it a plain CJS re-export of the compiled plugin.
module.exports = require('./build/index.js')
