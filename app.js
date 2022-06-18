const fs = require('fs');
const path = require('path');
const rl = require('readline').createInterface(process.stdin, process.stdout);
const Express = require('express');
const ExpressLP = require('express-longpoll');
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
let wsApp = ExpressWS(app, rawServer);
let sockets = [];
app.ws('/', (ws, req) => {
    log('ws opened');
    sockets.push(ws);
    ws.on('close', () => {
        let idx = sockets.indexOf(ws);
        if (idx != -1) sockets.splice(idx, 1);
        log('ws closed');
    });
    sendIncomingPhonesCount();
});

function sendIncomingPhonesCount() {
    let data = connectedPhones.length == 0 ? incomingPhones.length : 0;
    massSend('inc:' + data);
}
function massSend(data) {
    sockets.forEach(s => s.send(data));
}

function question(txt) {
    return new Promise(resolve => rl.question(txt, ans => resolve(ans)));
}

let logFilePath;
let position = 0;
const regexp = /^[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{4} \[THREAD-[0-9]{1}\] >>> CounterPathPhone:client_OnCallStatus: sip:/g;
async function init() {
    logFilePath = (await question('Log file path: ')).replace(/"/g, '');
    control();
    if (logFilePath == 'dbg' || !logFilePath) return log('Debugging');
    if (!fs.existsSync(logFilePath)) {
        console.log('File does not exist');
        process.exit(0);
    }
    position = fs.statSync(logFilePath).size;
    let fd = fs.openSync(logFilePath);

    fs.watch(logFilePath, {}, () => {
        let newSize = fs.statSync(logFilePath).size;
        if (newSize != position) {
            let buf = Buffer.alloc(1024 * 16);
            fs.readSync(fd, buf, 0, buf.length, position);
            let raw = buf.toString().replace(/\u0000+$/gm, '');
            let lines = raw.split('\r\n');
            lines.forEach(ln => {
                if (regexp.test(ln)) {
                    ln = ln.replace(regexp, '').replace('@192.168.93.254', '');
                    let phone = ln.split(' ')[0];
                    let status = ln.split(' ')[1];
                    action(phone, status);
                }
            });
            position = newSize;
        }
    });
    log('Listening...');
}
init();

function action(phone, status) {
    switch (status) {
        case 'ECS_Incoming': case 'ECS_Dialing': case 'i': case '4':
            incoming(phone);
            break;
        case 'ECS_Connected': case 'c': case '1': case '2': case '5':
            connected(phone);
            break;
        case 'ECS_Disconnected': case 'd': case '6':
            disconnected(phone);
            break;
    }
    sendIncomingPhonesCount();
}

let incomingPhones = [];
let connectedPhones = [];
function incoming(phone) {
    const idxInc = incomingPhones.indexOf(phone);
    const idxCon = connectedPhones.indexOf(phone);

    if (idxInc == -1 && idxCon == -1) {
        incomingPhones.push(phone);
        log('Incoming ' + phone);
    }
}
function connected(phone) {
    const idxInc = incomingPhones.indexOf(phone);
    const idxCon = connectedPhones.indexOf(phone);

    if (idxInc != -1) incomingPhones.splice(idxInc, 1);
    if (idxCon == -1) {
        connectedPhones.push(phone);
        massSend('con');
        log('Connected ' + phone);
    }
}
function disconnected(phone) {
    const idxInc = incomingPhones.indexOf(phone);
    const idxCon = connectedPhones.indexOf(phone);
    
    if (idxInc != -1) incomingPhones.splice(idxInc, 1);
    if (idxCon != -1) connectedPhones.splice(idxCon, 1);
    if (idxCon != idxInc) {
        if (idxCon != -1) massSend('discon');
        log('Disconnected ' + phone);
    }
}

async function control() {
    let txt = await question('cmd: ');
    let cmd = txt.split(' ')[0];
    let args = txt.split(' ').slice(1);
    switch (cmd) {
        case 'reset':
            incomingPhones = [];
            connectedPhones = [];
            sendIncomingPhonesCount();
            massSend('discon');
            break;
        case 'a':
            if (args[0] && args[1]) action(args[0], args[1]);
            else log('a', args);
            break;
    }
    control();
}