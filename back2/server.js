import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import fetch from "node-fetch";
import pkg from "pg";
const { Pool } = pkg;

// =============================
// 🧩 PostgreSQL (Render)
// =============================
// Render tự cấp biến môi trường DATABASE_URL, không cần viết tay
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Kiểm tra kết nối
pool.connect()
  .then(() => console.log("✅ Đã kết nối tới PostgreSQL Render"))
  .catch(err => console.error("❌ Lỗi kết nối PostgreSQL:", err));

const app = express();
app.use(cors());
app.use(express.json());

// 🔗 URL AI server (qua Cloudflare tunnel hoặc domain bạn)
const AI_URL = "https://presidential-birds-decisions-perspective.trycloudflare.com";

const rooms = {}; // roomId -> [WebSocket clients]
const waitingUsers = []; // Danh sách người đang chờ: { goal, roomId }

// =============================
// 🧩 API /match
// =============================
app.post("/match", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

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
        console.error("❌ Lỗi AI server:", err);
      }
    }

    // Nếu có người phù hợp
    if (bestMatch && bestScore >= 0.7) {
      const roomId = bestMatch.roomId;
      waitingUsers.splice(waitingUsers.indexOf(bestMatch), 1);

      console.log(`🔗 Ghép thành công giữa "${goal}" và "${bestMatch.goal}" | roomId: ${roomId}`);

      // Ghi log vào DB
      try {
        await pool.query(
          `INSERT INTO matches (room_id, similarity_score, matched_at)
           VALUES ($1, $2, NOW())`,
          [roomId, bestScore]
        );
      } catch (dbErr) {
        console.error("⚠️ Không thể lưu match:", dbErr.message);
      }

      return res.json({ roomId, isCaller: false });
    }
  }

  // Nếu chưa ai phù hợp → tạo phòng mới
  const roomId = uuidv4();
  waitingUsers.push({ goal, roomId });
  rooms[roomId] = [];

  console.log(`🆕 Tạo phòng chờ mới: ${roomId} cho "${goal}"`);

  // Lưu vào DB
  try {
    await pool.query(
      `INSERT INTO waiting_users (room_id, goal, created_at)
       VALUES ($1, $2, NOW())`,
      [roomId, goal]
    );
  } catch (dbErr) {
    console.error("⚠️ Không thể lưu waiting user:", dbErr.message);
  }

  res.json({ roomId, isCaller: true });
});

// =============================
// ⚡ WebSocket signaling server
// =============================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) return ws.close();

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);

  console.log(`✅ WebSocket kết nối tới room: ${roomId}`);

  // Nếu đủ 2 người → báo ready
  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === ws.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} sẵn sàng`);
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
      console.log(`🗑️ Xóa room ${roomId}`);
    }
  });
});

// =============================
// 🚀 Khởi động server
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Server chạy trên cổng ${PORT}`));
