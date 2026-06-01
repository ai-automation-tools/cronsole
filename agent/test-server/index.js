const { Server } = require("socket.io");
const http = require("http");

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`
    <h1>TaskHub Test Server</h1>
    <p>Status: <strong>Running</strong></p>
    <p>Socket.io is listening for agent connections.</p>
    <hr>
    <p>Check the CLI console for task lists and trigger logs.</p>
  `);
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  }
});

console.log("TaskHub Test Server starting on port 3000...");

io.on("connection", (socket) => {
  console.log("Agent connected:", socket.id);

  socket.emit("task:list", (tasks) => {
    if (tasks.error) {
      console.error("Agent reported error:", tasks.error);
      return;
    }
    console.log(`Received ${tasks.length} tasks from agent.`);
    tasks.slice(0, 5).forEach(t => console.log(` - ${t.name} (${t.state}) [${t.path}]`));
  });

  socket.on("disconnect", () => {
    console.log("Agent disconnected.");
  });
});

httpServer.listen(3000, () => {
  console.log("Server listening on http://localhost:3000");
});
