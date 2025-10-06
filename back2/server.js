const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Mỗi phòng chứa danh sách client WebSocket và goal chung
const rooms = {};
const waiting = {}; // goal → roomId (nếu có người đang chờ)

// API POST /match
app.post("/match", (req, res) => {
  const { goal } = req.body;

  // Nếu đã có người chờ cùng goal → ghép cặp vào cùng phòng đó
  if (waiting[goal]) {
    const roomId = waiting[goal];
    delete waiting[goal];
    console.log(`🔁 Found waiting room for goal "${goal}": ${roomId}`);
    res.json({ roomId, isCaller: false });
    return;
  }

  // Nếu chưa có ai chờ → tạo phòng mới và đánh dấu đang chờ
  const newRoomId = uuidv4();
  waiting[goal] = newRoomId;
  rooms[newRoomId] = { goal, clients: [] };
  console.log(`🆕 Created new room for goal "${goal}": ${newRoomId}`);
  res.json({ roomId: newRoomId, isCaller: true });
});

// Tạo HTTP server
const server = http.createServer(app);

// Tạo WebSocket server
const wss = new WebSocket.Server({ server });

// Khi có client kết nối WebSocket
wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");

  if (!roomId || !rooms[roomId]) {
    ws.close();
    return;
  }

  ws.roomId = roomId;
  const room = rooms[roomId];
  room.clients.push(ws);

  console.log(`✅ New connection, goal "${room.goal}", room: ${roomId}`);
  console.log(`👥 Clients in room ${roomId}: ${room.clients.length}`);

  // Khi nhận được tín hiệu WebRTC
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const others = room.clients.filter(
        (client) => client !== ws && client.readyState === WebSocket.OPEN
      );
      for (const client of others) {
        client.send(JSON.stringify(data));
      }
    } catch (err) {
      console.error("❌ Error parsing message:", err.message);
    }
  });

  // Khi client rời đi
  ws.on("close", () => {
    room.clients = room.clients.filter((c) => c !== ws);
    console.log(`❌ Client left room ${roomId}`);

    if (room.clients.length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room deleted: ${roomId}`);
    }
  });
});

// Khởi động server
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`✅ Backend WebSocket server running on port ${PORT}`);
});
