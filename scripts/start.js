// Starts the app. VS Code's terminal sets ELECTRON_RUN_AS_NODE, which makes Electron run main.js as plain Node.
const { spawn } = require('node:child_process');
const electron = require('electron'); // the path of the Electron binary
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
spawn(electron, [__dirname + '/..', ...process.argv.slice(2)], { stdio: 'inherit', env }).on('exit', (code) => process.exit(code ?? 0));
