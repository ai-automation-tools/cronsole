const { Server } = require("socket.io");
const http = require("http");
const crypto = require("crypto");

// Dev stub of the backend for manually exercising the .NET agent. It mirrors the
// real handshake + per-command signing (backend/src/ws/agentAuth.ts) so the agent
// accepts its commands. Set AGENT_PAIRING_SECRET to match the agent's
// TASKHUB_PAIRING_SECRET (defaults to the local dev value in backend/.env).
const PAIRING_SECRET =
  process.env.AGENT_PAIRING_SECRET ||
  "48ea0bf89b69253fc6695949f777097e16a64bce8cbef51f";

const hmac = (key, msg) =>
  crypto.createHmac("sha256", key).update(msg, "utf8").digest("hex");

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <h1>TaskHub Test Server</h1>
    <p>Status: <strong>Running</strong></p>
    <p>Socket.io is listening for authenticated agent connections.</p>
    <hr>
    <p>Check the CLI console for task lists and trigger logs.</p>
  `);
});

const io = new Server(httpServer, { cors: { origin: false } });

console.log("TaskHub Test Server starting on port 3000...");

// Authenticate the handshake exactly like agentAuthMiddleware.
io.use((socket, next) => {
  try {
    const { agentId, nonce, ts, hmac: mac } = socket.handshake.auth || {};
    if (!agentId || !nonce || !mac) throw new Error("malformed auth");
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 120)
      throw new Error("stale handshake");
    if (hmac(PAIRING_SECRET, `${agentId}|${nonce}|${ts}`) !== mac)
      throw new Error("bad signature");
    socket.data.sessionKey = hmac(PAIRING_SECRET, `session:${nonce}`);
    socket.data.agentId = agentId;
    next();
  } catch (err) {
    console.warn(`Rejected socket ${socket.id}: ${err.message}`);
    next(new Error("unauthorized"));
  }
});

// Sign and emit a command the same way emitSignedCommand does. `message` is the
// canonical string minus the trailing |nonce|ts (added here).
//
// The per-command nonce is REQUIRED and must be both signed and sent: the agent
// rebuilds the message locally and rejects anything it can't verify — silently,
// so a stub that forgot it would just look like the agent had stopped
// responding. It exists because `ts` is second-granular, so two identical
// commands in one second would otherwise sign identically and the agent's replay
// guard would drop the second (docs/troubleshooting/README.md #16).
function emitSigned(socket, event, fields, message) {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomBytes(16).toString("hex");
  const sig = hmac(socket.data.sessionKey, `${message}|${nonce}|${ts}`);
  socket.emit(event, { ...fields, nonce, ts, sig });
}

io.on("connection", (socket) => {
  console.log(`Agent connected: ${socket.id} (${socket.data.agentId})`);

  // Request a sync (task:list is an unsigned read request).
  socket.emit("task:list");

  socket.on("task:full_list", (payload) => {
    const tasks = payload?.tasks ?? [];
    console.log(`Received ${tasks.length} tasks from agent.`);
    tasks.slice(0, 5).forEach((t) => console.log(` - ${t.name} (${t.state}) [${t.path}]`));
  });

  // Example: uncomment to drive a signed run.
  // emitSigned(socket, "task:run", { taskPath: "\\SomeTask" }, "task:run|\\SomeTask");

  socket.on("disconnect", () => console.log("Agent disconnected."));
});

httpServer.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
