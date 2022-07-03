const fs = require('fs');
const path = require('path');
const rl = require('readline').createInterface(process.stdin, process.stdout);
const Express = require('express');
const ExpressWS = require('express-ws');
function formatDate(date, compact = false) {
    const adjustZeros = (x, required = 2) => {
        x = String(x);
        while (x.length < required) x = '0' + x;
        return x;
    }
    if (!(date instanceof Date)) date = new Date(+date);

    let Y = date.getFullYear();
    let M = adjustZeros(date.getMonth() + 1);
    let D = adjustZeros(date.getDate());

    let h = adjustZeros(date.getHours());
    let m = adjustZeros(date.getMinutes());
    let s = adjustZeros(date.getUTCSeconds());
    let ms = adjustZeros(date.getMilliseconds(), 3);

    return compact ? `${D}.${M}.${String(Y).slice(2)} ${h}:${m}` : `${D}.${M}.${Y} ${h}:${m}:${s}.${ms}`;
}
function log(...args) {
    console.log(`[${formatDate(new Date)}]`, ...args);
}

let app = Express();
let rawServer = app.listen(8089);
app.use((req, resp, next) => {
    resp.setHeader('Access-Control-Allow-Origin', '*');
    next();
});
ExpressWS(app, rawServer);
let sockets = [];
app.ws('/', (ws, req) => {
    sockets.push(ws);
    ws.on('close', () => {
        let idx = sockets.indexOf(ws);
        if (idx != -1) sockets.splice(idx, 1);
    });
});
app.post('/hive', (req, resp) => {
    //
});
function massSend(data) {
    sockets.forEach(s => s.send(data));
}

function question(txt) {
    return new Promise(resolve => rl.question(txt, ans => resolve(ans)));
}

let logsDir;
const logsDirCachePath = path.resolve(require('os').homedir(), '.kch-wp-logsDir');
if (fs.existsSync(logsDirCachePath)) logsDir = fs.readFileSync(logsDirCachePath).toString();
log('Logs dir:', logsDir || 'Not set');

let position = 0;
let usedCIDs = [];
let fsWatcher;
const phoneRegex = /^[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{4} \[THREAD-[0-9]{1}\] >>> CounterPathPhone:client_OnCallStatus: sip:/g;
async function loadLogFile() {
    if (!logsDir || !fs.existsSync(logsDir)) return log('Invalid logs dir');
    let logFilePath = fs.readdirSync(logsDir).filter(fn => fn.endsWith('.console')).map(fn => path.resolve(logsDir, fn)).sort((a, b) => {
        a = fs.statSync(a).mtime;
        b = fs.statSync(b).mtime;
        return b - a;
    })[0];
    control();
    if (logFilePath == 'dbg' || !logFilePath) return log('Debugging');
    if (!fs.existsSync(logFilePath)) {
        console.log('File does not exist');
        process.exit(0);
    }
    log('Log file:', logFilePath);
    position = fs.statSync(logFilePath).size;
    let fd = fs.openSync(logFilePath);
    if (fsWatcher) fsWatcher.close();

    fsWatcher = fs.watch(logFilePath, {}, () => {
        let newSize = fs.statSync(logFilePath).size;
        if (newSize != position) {
            let buf = Buffer.alloc(1024 * 16);
            fs.readSync(fd, buf, 0, buf.length, position);
            let raw = buf.toString().replace(/\u0000+$/gm, '');
            let lines = raw.split('\r\n');
            lines.forEach(ln => {
                if (phoneRegex.test(ln)) {
                    ln = ln.replace(phoneRegex, '').replace('@192.168.93.254', '');
                    let phone = ln.split(' ')[0];
                    let status = ln.split(' ')[1];
                    action(phone, status);
                }
                else if (ln.indexOf('pc-take-order') != -1) {
                    ln = ln.split(' >>> ').slice(1).join(' >>> ');
                    let json;
                    try {
                        json = JSON.parse(ln);
                    }
                    catch { return; }
                    if (!json['pc-take-order']) return;

                    let cid = +json['pc-take-order']._CID_;
                    if (usedCIDs.indexOf(cid) != -1) return;
                    usedCIDs.push(cid);
                    massSend('order');
                }
            });
            position = newSize;
        }
    });
    log('Listening...');
}

function action(phone, status) {
    switch (status) {
        case 'ECS_Incoming': case 'i': case '4':
            massSend(`action:${phone} incoming`);
            break;
        case 'ECS_Connected': case 'ECS_Dialing': case 'c': case '1': case '2': case '5':
            massSend(`action:${phone} connected`);
            break;
        case 'ECS_Disconnected': case 'd': case '6':
            massSend(`action:${phone} disconnected`);
            break;
    }
}

async function control() {
    let txt = await question('cmd: ');
    let cmd = txt.split(' ')[0];
    let args = txt.split(' ').slice(1);
    switch (cmd) {
        case 'r': case 'reset':
            massSend('reset');
            break;
        case 'a':
            if (args[0] && args[1]) action(args[0], args[1]);
            else log('a', args);
            break;
        case 'o':
            massSend('order');
            break;
        case 'l':
            loadLogFile();
            break;
        case 'd':
            let dir = (await question('Logs dir:')).replace(/"/g, '');
            logsDir = dir;
            fs.writeFileSync(logsDirCachePath, dir);
            log('Set logs dir to', dir);
            break;
    }
    control();
}
control();