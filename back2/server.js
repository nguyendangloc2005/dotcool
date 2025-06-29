// server.js
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/match") {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
    });
    req.on("end", () => {
      const { goal } = JSON.parse(body);
      const roomId = matchGoal(goal);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ roomId }));
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocket.Server({ server });
const rooms = {};

function matchGoal(goal) {
  for (const [roomId, clients] of Object.entries(rooms)) {
    if (clients.length === 1 && clients[0].goal === goal) {
      return roomId;
    }
  }
  const newRoomId = uuidv4();
  rooms[newRoomId] = [];
  return newRoomId;
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = url.pathname.split("/").pop();

  if (!rooms[roomId]) {
    rooms[roomId] = [];
  }

  ws.goal = null;
  ws.roomId = roomId;
  rooms[roomId].push(ws);

  ws.on("message", (msg) => {
    let data = JSON.parse(msg);
    if (data.goal) {
      ws.goal = data.goal;
      return;
    }

    const others = rooms[roomId].filter(client => client !== ws && client.readyState === WebSocket.OPEN);
    for (const client of others) {
      client.send(JSON.stringify(data));
    }
  });

  ws.on("close", () => {
    rooms[roomId] = rooms[roomId].filter(client => client !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
    }
  });
});

const os = require("os");
const PORT = 8000;

const ip = Object.values(os.networkInterfaces())
  .flat()
  .find(i => i.family === 'IPv4' && !i.internal).address;

server.listen(PORT, () => {
  console.log(`Backend running at http://${ip}:${PORT}`);
});


