// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fetch = require("node-fetch"); // cần thêm: npm install node-fetch

const app = express();
app.use(cors());
app.use(express.json());

// 🧠 URL AI server (tunnel public)
const AI_URL = "https://variation-toward-dinner-country.trycloudflare.com";

const rooms = {};              // roomId -> [WebSocket clients]
const waitingUsers = [];       // Danh sách người đang chờ: { goal, roomId }

// =============================
// 🧩 API POST /match
// =============================
app.post("/match", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  // Nếu có người đang chờ, thử xem ai có goal tương tự nhất
  if (waitingUsers.length > 0) {
    let bestMatch = null;
    let bestScore = 0.0;

    // Duyệt qua từng người đang chờ → tính độ tương đồng bằng AI server
    for (const user of waitingUsers) {
      try {
        const response = await fetch(AI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: [goal, user.goal] }),
        });
        const result = await response.json();
        const score = result.similarity_score || 0;
        console.log(`🤖 So sánh "${goal}" vs "${user.goal}" → điểm ${score}`);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = user;
        }
      } catch (err) {
        console.error("❌ Lỗi khi gọi AI server:", err);
      }
    }

    // Nếu có người phù hợp (>=0.7 chẳng hạn) → ghép
    if (bestMatch && bestScore >= 0.7) {
      const roomId = bestMatch.roomId;
      waitingUsers.splice(waitingUsers.indexOf(bestMatch), 1);
      console.log(`🔗 Ghép thành công giữa "${goal}" và "${bestMatch.goal}" | roomId: ${roomId}`);
      return res.json({ roomId, isCaller: false });
    }
  }

  // Nếu không tìm được ai phù hợp → tạo phòng mới, đợi
  const roomId = uuidv4();
  waitingUsers.push({ goal, roomId });
  rooms[roomId] = [];
  console.log(`🆕 Tạo phòng mới cho goal "${goal}": ${roomId}`);
  res.json({ roomId, isCaller: true });
});

// =============================
// ⚡ WebSocket Signaling
// =============================
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

  // Khi phòng đủ 2 người
  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} is ready for call`);
  }

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const others = rooms[roomId].filter(c => c !== ws && c.readyState === WebSocket.OPEN);
    others.forEach(client => client.send(JSON.stringify(data)));
  });

  ws.on("close", () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room deleted: ${roomId}`);
    } else {
      console.log(`❌ Client left room ${roomId}`);
    }
  });
});

// =============================
// 🚀 Khởi chạy server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Backend WebSocket server running on port ${PORT}`));
