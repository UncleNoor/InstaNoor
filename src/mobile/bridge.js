'use strict';

// Request/response messaging with the Android app over the `InoorNative` object
// that the WebView injects (androidx.webkit WebMessageListener). Messages are
// JSON strings: {id, method, args} out; {id, result|error} or {event, data} in.
function createBridge(native) {
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();

  native.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch (err) { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg.result);
    } else if (msg.event) {
      for (const cb of handlers.get(msg.event) || []) {
        try { cb(msg.data); } catch (err) { console.error(err); }
      }
    }
  });

  return {
    invoke(method, args) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        native.postMessage(JSON.stringify({ id, method, args: args === undefined ? null : args }));
      });
    },
    send(method, args) {
      native.postMessage(JSON.stringify({ method, args: args === undefined ? null : args }));
    },
    on(event, cb) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(cb);
    },
  };
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

module.exports = { createBridge, base64ToBytes };
