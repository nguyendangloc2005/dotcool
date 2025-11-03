// =============================
// 📦 Import thư viện cần thiết
// =============================
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import fetch from "node-fetch"; // Cần cài: npm install node-fetch
import pkg from "pg";
const { Pool } = pkg;

// =============================
// 🧩 Kết nối PostgreSQL
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log("✅ PostgreSQL connected"))
  .catch(err => console.error("❌ PostgreSQL connection error:", err));

// =============================
// ⚙️ Cấu hình Express + WebSocket
// =============================
const app = express();
app.use(cors());
app.use(express.json());

// 🧠 AI server public (qua ngrok hoặc Cloudflare)
const AI_URL = "https://presidential-birds-decisions-perspective.trycloudflare.com";

const rooms = {}; // roomId → [WebSocket clients]
let waitingUsers = []; // [{ goal, roomId, timestamp }]

// =============================
// 🧩 API: /match
// =============================
app.post("/match", async (req, res) => {
  const { goal, userId } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  // 🗂️ Lưu vào DB
  try {
    await pool.query(
      "INSERT INTO user_goals (user_id, goal, created_at) VALUES ($1, $2, NOW())",
      [userId || uuidv4(), goal]
    );
  } catch (err) {
    console.error("⚠️ Lỗi lưu mục tiêu vào DB:", err.message);
  }

  // 🧹 Xóa người chờ quá 2 phút
  const now = Date.now();
  waitingUsers = waitingUsers.filter(u => now - u.timestamp < 120000);

  // Nếu đã có người đang chờ → gọi AI so sánh
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
        console.error("❌ Lỗi gọi AI:", err.message);
      }
    }

    // Nếu có người phù hợp
    if (bestMatch && bestScore >= 0.75) {
      const roomId = bestMatch.roomId;
      waitingUsers = waitingUsers.filter(u => u !== bestMatch);

      console.log(`🔗 Ghép thành công "${goal}" ↔ "${bestMatch.goal}" | room: ${roomId}`);

      // 📦 Lưu match vào DB
      try {
        await pool.query(
          "INSERT INTO matches (room_id, goal_a, goal_b, score, created_at) VALUES ($1, $2, $3, $4, NOW())",
          [roomId, goal, bestMatch.goal, bestScore]
        );
      } catch (dbErr) {
        console.error("⚠️ Lỗi lưu match vào DB:", dbErr.message);
      }

      return res.json({ roomId, isCaller: false });
    }
  }

  // Nếu chưa có ai → tạo phòng mới
  const roomId = uuidv4();
  waitingUsers.push({ goal, roomId, timestamp: Date.now() });
  rooms[roomId] = [];

  console.log(`🆕 Tạo phòng chờ mới cho "${goal}": ${roomId}`);

  // 📦 Lưu người chờ vào DB
  try {
    await pool.query(
      "INSERT INTO waiting_users (room_id, goal, created_at) VALUES ($1, $2, NOW())",
      [roomId, goal]
    );
  } catch (dbErr) {
    console.error("⚠️ Lỗi lưu người chờ vào DB:", dbErr.message);
  }

  res.json({ roomId, isCaller: true });
});

// =============================
// ⚡ WebSocket signaling
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

  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === ws.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} sẵn sàng cho cuộc gọi`);
  }

  ws.on("message", msg => {
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
// 🚀 Chạy server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Backend WebSocket server running on port ${PORT}`));
