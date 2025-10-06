const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const rooms = {};

// API POST /match
app.post("/match", (req, res) => {
  const { goal } = req.body;
  const roomId = matchGoal(goal);
  const isCaller = rooms[roomId].length === 1;
  res.json({ roomId, isCaller });
});

// Hàm tìm hoặc tạo phòng
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

// Tạo HTTP server
const server = http.createServer(app);

// Tạo WebSocket server (không đặt path)
const wss = new WebSocket.Server({ server });

// Xử lý WebSocket kết nối
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");

  console.log("✅ New connection, room:", roomId);

  if (!roomId) {
    ws.close();
    return;
  }

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);

  console.log("👥 Clients in room:", rooms[roomId].length);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log("📩 Message in room", roomId, ":", Object.keys(data));

      const others = rooms[roomId].filter(
        (client) => client !== ws && client.readyState === WebSocket.OPEN
      );
      for (const client of others) {
        client.send(JSON.stringify(data));
      }
    } catch (err) {
      console.error("❌ Lỗi parse message:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("❌ Client left room", roomId);
    rooms[roomId] = rooms[roomId].filter((client) => client !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log("🗑️ Room deleted:", roomId);
    }
  });
});

// Khởi động server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`✅ Backend WebSocket server running on port ${PORT}`);
});
