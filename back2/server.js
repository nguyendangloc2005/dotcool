const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const rooms = {};       // roomId -> [ws clients]
const waitingByGoal = {}; // goal -> roomId

app.post("/match", (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  let roomId;
  if (waitingByGoal[goal]) {
    roomId = waitingByGoal[goal];
    delete waitingByGoal[goal];
    res.json({ roomId, isCaller: false });
  } else {
    roomId = uuidv4();
    waitingByGoal[goal] = roomId;
    rooms[roomId] = [];
    res.json({ roomId, isCaller: true });
  }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) return ws.close();

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const others = rooms[roomId].filter(c => c !== ws && c.readyState === WebSocket.OPEN);
    others.forEach(client => client.send(JSON.stringify(data)));
  });

  ws.on("close", () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].length === 0) delete rooms[roomId];
      }, 2 * 60 * 1000);
    }
  });
});

server.listen(process.env.PORT || 10000, () => console.log("Server running"));
