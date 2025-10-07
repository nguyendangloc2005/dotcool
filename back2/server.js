const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Lưu room và clients
const rooms = {};           // roomId -> [ws clients]
const waitingByGoal = {};   // goal -> roomId đang đợi

// API POST /match
app.post("/match", (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  let roomId;

  if (waitingByGoal[goal]) {
    roomId = waitingByGoal[goal];
    delete waitingByGoal[goal];
    console.log(`🔁 Found waiting room for goal "${goal}": ${roomId}`);
    res.json({ roomId, isCaller: false });
  } else {
    roomId = uuidv4();
    waitingByGoal[goal] = roomId;
    rooms[roomId] = [];
    console.log(`🆕 Created new room for goal "${goal}": ${roomId}`);
    res.json({ roomId, isCaller: true });
  }
});

// HTTP server & WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");

  if (!roomId) return ws.close();

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);
  console.log(`✅ New connection to room: ${roomId}`);
  console.log(`👥 Clients in room ${roomId}: ${rooms[roomId].length}`);

  // Nhận message và broadcast cho peer
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const others = rooms[roomId].filter(c => c !== ws && c.readyState === WebSocket.OPEN);
    others.forEach(client => client.send(JSON.stringify(data)));
  });

  // Khi client đóng kết nối
  ws.on("close", () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);

    if (rooms[roomId].length === 0) {
      // Xóa room sau 2 phút nếu trống để tránh client rời sớm xóa room ngay
      setTimeout(() => {
        if (rooms[roomId] && rooms[roomId].length === 0) {
          delete rooms[roomId];
          console.log(`🗑️ Room deleted: ${roomId}`);
        }
      }, 2 * 60 * 1000);
    } else {
      console.log(`❌ Client left room ${roomId}`);
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Backend WebSocket server running on port ${PORT}`));
