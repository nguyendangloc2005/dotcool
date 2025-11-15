// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import fetch from "node-fetch";
import pkg from "pg";
const { Pool } = pkg;

// =============================
// CẤU HÌNH DATABASE
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// =============================
// KHỞI TẠO SERVER
// =============================
const app = express();
app.use(cors());
app.use(express.json());

const AI_URL = "https://stereo-generator-undertake-casa.trycloudflare.com";
const rooms = {}; // roomId -> [WebSocket]

// =============================
// API /match – BẮT BUỘC user_id
// =============================
app.post("/match", async (req, res) => {
  const { goal, user_id } = req.body;

  if (!goal || !user_id) {
    return res.status(400).json({ error: "Thiếu goal hoặc user_id" });
  }

  try {
    // Lấy người đang chờ (loại chính mình)
    const { rows: waitingUsers } = await pool.query(
      `SELECT * FROM waiting_users 
       WHERE user_id != $1 
       ORDER BY created_at ASC`,
      [user_id]
    );

    let bestMatch = null;
    let bestScore = 0;

    for (const user of waitingUsers) {
      try {
        const response = await fetch(`${AI_URL}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: [goal, user.goal] }),
        });
        const { similarity_score = 0 } = await response.json();
        console.log(`So sánh "${goal}" vs "${user.goal}" → ${similarity_score}`);

        if (similarity_score > bestScore) {
          bestScore = similarity_score;
          bestMatch = user;
        }
      } catch (err) {
        console.error("Lỗi AI:", err);
      }
    }

    // GHÉP ĐÔI
    if (bestMatch && bestScore >= 0.6) { // Giảm ngưỡng cho dễ test
      const roomId = bestMatch.room_id;

      // Xóa người kia khỏi hàng chờ
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);

      // Lưu match
      await pool.query(
        `INSERT INTO matches 
         (room_id, user1_id, user2_id, user1_goal, user2_goal, similarity_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomId, user_id, bestMatch.user_id, goal, bestMatch.goal, bestScore]
      );

      console.log(`MATCHED: ${user_id} ↔ ${bestMatch.user_id} | room: ${roomId}`);
      return res.json({ roomId, isCaller: false });
    }

    // TẠO PHÒNG MỚI
    const roomId = uuidv4();
    await pool.query(
      `INSERT INTO waiting_users (room_id, user_id, goal) 
       VALUES ($1, $2, $3)`,
      [roomId, user_id, goal]
    );

    console.log(`Tạo phòng chờ: user ${user_id} | "${goal}" | ${roomId}`);
    res.json({ roomId, isCaller: true });

  } catch (err) {
    console.error("Lỗi /match:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// =============================
// WEBSOCKET SIGNALING
// =============================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  if (!roomId) return ws.close();

  if (!rooms[roomId]) rooms[roomId] = [];
  rooms[roomId].push(ws);

  console.log(`Kết nối mới tới room: ${roomId}`);
  console.log(`Room ${roomId} có ${rooms[roomId].length} client`);

  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ ready: true }));
      }
    });
    console.log(`Room ${roomId} sẵn sàng`);
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const others = rooms[roomId].filter(c => c !== ws && c.readyState === c.OPEN);
      others.forEach(c => c.send(JSON.stringify(data)));
    } catch (err) {
      console.error("Lỗi parse message:", err);
    }
  });

  ws.on("close", async () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log(`Room deleted: ${roomId}`);
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);
    }
  });
});

// =============================
// HEALTH CHECK
// =============================
app.get("/health", (req, res) => res.json({ status: "OK" }));

// =============================
// KHỞI CHẠY
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Backend chạy trên cổng ${PORT}`);
});
