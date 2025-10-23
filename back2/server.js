import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import fetch from "node-fetch"; // Import fetch ESM

const app = express();
app.use(cors());
app.use(express.json());

// 🔗 URL AI server của bạn (qua Cloudflare Tunnel)
const AI_URL = "https://places-celebrate-chain-mention.trycloudflare.com";

const rooms = {}; // roomId -> [WebSocket clients]
const waitingUsers = []; // Danh sách người đang chờ: { goal, roomId }

// =============================
// 🧩 API POST /match
// =============================
app.post("/match", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  // Nếu có người đang chờ, so sánh qua AI server
  if (waitingUsers.length > 0) {
    let bestMatch = null;
    let bestScore = 0.0;

    for (const user of waitingUsers) {
      try {
        const response = await fetch(`${AI_URL}/match`, {
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
        console.error("❌ Lỗi gọi AI:", err);
      }
    }

    // Ghép nếu có điểm đủ cao
    if (bestMatch && bestScore >= 0.7) {
      const roomId = bestMatch.roomId;
      waitingUsers.splice(waitingUsers.indexOf(bestMatch), 1);
      console.log(`🔗 Ghép thành công giữa "${goal}" và "${bestMatch.goal}" | roomId: ${roomId}`);
      return res.json({ roomId, isCaller: false });
    }
  }

  // Nếu chưa ai phù hợp, tạo phòng chờ mới
  const roomId = uuidv4();
  waitingUsers.push({ goal, roomId });
  rooms[roomId] = [];
  console.log(`🆕 Tạo phòng chờ mới cho "${goal}": ${roomId}`);
  res.json({ roomId, isCaller: true });
});

// =============================
// ⚡ WebSocket Signaling
// =============================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) return ws.close();

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);

  console.log(`✅ Kết nối mới tới room: ${roomId}`);
  console.log(`👥 Room ${roomId} có ${rooms[roomId].length} client`);

  // Khi đủ 2 người → báo ready
  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === ws.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} sẵn sàng cho cuộc gọi`);
  }

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const others = rooms[roomId].filter(c => c !== ws && c.readyState === ws.OPEN);
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
