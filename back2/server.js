const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Lưu trữ các phòng
const rooms = {};

// Xử lý POST /match
app.post("/match", (req, res) => {
  const { goal } = req.body;
  const roomId = matchGoal(goal);
  res.json({ roomId });
});

// Hàm ghép người có cùng mục tiêu
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

// Tạo server
const server = http.createServer(app);

// WebSocket path theo room
const wss = new WebSocket.Server({ server, path: "/ws/:roomId" });

// Xử lý kết nối WebSocket
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");


  if (!rooms[roomId]) rooms[roomId] = [];

  ws.goal = null;
  ws.roomId = roomId;
  rooms[roomId].push(ws);

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

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

// Khởi động server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`✅ Backend WebSocket server running on port ${PORT}`);
});
