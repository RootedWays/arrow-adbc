const fs = require('fs');
const path = require('path');

const profile = process.argv[2] === 'debug' ? 'debug' : 'release';
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

const libName = isWindows ? 'driver_manager_napi_rs' : 'libdriver_manager_napi_rs';
const libExt = isWindows ? '.dll' : isMac ? '.dylib' : '.so';

const source = path.join(__dirname, '..', 'native', 'target', profile, `${libName}${libExt}`);
const dest = path.join(__dirname, '..', 'native', 'index.node');

if (!fs.existsSync(source)) {
  throw new Error(`Compiled native module not found at ${source}. Did cargo build succeed?`);
}

fs.copyFileSync(source, dest);
console.log(`Copied ${source} -> ${dest}`);
