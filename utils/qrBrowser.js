'use strict';

const http = require('node:http');
const { spawn } = require('node:child_process');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const errorCorrectionLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const { logger } = require('./logger');

function qrSvg(value) {
  const qr = new QRCode(-1, errorCorrectionLevel.M);
  qr.addData(value);
  qr.make();

  const quietZone = 4;
  const size = qr.getModuleCount() + quietZone * 2;
  const squares = [];
  qr.modules.forEach((row, y) => row.forEach((dark, x) => {
    if (dark) squares.push(`<rect x="${x + quietZone}" y="${y + quietZone}" width="1" height="1"/>`);
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="#111">${squares.join('')}</g></svg>`;
}

function openBrowser(url) {
  let command;
  let args;
  if (process.platform === 'win32') {
    command = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', (error) => logger.warn(`Could not open the QR page automatically: ${error.message}`));
  child.unref();
}

function startQrBrowser() {
  let currentQr = null;
  let status = 'starting';
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/status.json') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ status }));
      return;
    }
    if (pathname === '/qr.svg') {
      response.writeHead(currentQr && status === 'waiting_for_scan' ? 200 : 204, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(currentQr && status === 'waiting_for_scan' ? qrSvg(currentQr) : '');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StudyPal WhatsApp connection</title><style>body{font:16px system-ui,sans-serif;background:#f4f7f5;color:#17231c;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:white;padding:2rem;border-radius:1rem;box-shadow:0 8px 32px #102a1a18;text-align:center;max-width:28rem}img{width:min(80vw,25rem);image-rendering:pixelated}p{color:#526257}</style><main class="card"><h1>StudyPal WhatsApp connection</h1><p id="status">Starting WhatsApp…</p><img id="qr" alt="WhatsApp login QR code" hidden><p id="instructions" hidden>In WhatsApp, open Linked devices and scan this code.</p></main><script>const img=document.querySelector('#qr'),statusText=document.querySelector('#status'),instructions=document.querySelector('#instructions');const messages={starting:'Starting WhatsApp…',waiting_for_scan:'Scan this code with WhatsApp to link the bot.',authenticating:'QR scanned. Connecting to WhatsApp…',ready:'Connected. StudyPal is ready to receive messages.',disconnected:'Disconnected from WhatsApp. Check the terminal, then restart the bot if needed.',auth_failure:'WhatsApp authentication failed. Check the terminal and scan a new QR code.'};async function refresh(){try{const response=await fetch('/status.json',{cache:'no-store'});const data=await response.json();statusText.textContent=messages[data.status]||'Connecting to WhatsApp…';instructions.hidden=data.status!=='waiting_for_scan';if(data.status==='waiting_for_scan'){const imageResponse=await fetch('/qr.svg',{cache:'no-store'});if(imageResponse.status===200){img.src='/qr.svg?t='+Date.now();img.hidden=false}}else{img.hidden=true;img.removeAttribute('src')}}catch{}setTimeout(refresh,1200)}refresh()</script></html>`);
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const url = `http://127.0.0.1:${address.port}`;
    logger.info(`WhatsApp QR page: ${url}`);
    openBrowser(url);
  });

  return {
    setQr(value) { currentQr = value; status = 'waiting_for_scan'; },
    setStatus(value) { status = value; if (value !== 'waiting_for_scan') currentQr = null; },
    close() { server.close(); },
  };
}

module.exports = { qrSvg, startQrBrowser };
