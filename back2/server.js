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

// TỰ ĐỘNG TẠO BẢNG KHI KHỞI ĐỘNG
async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("Bắt đầu migration...");

    // 1. Tạo bảng users
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        firebase_uid TEXT PRIMARY KEY,
        name TEXT,
        email TEXT UNIQUE,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 2. Tạo bảng waiting_users
    await client.query(`
      CREATE TABLE IF NOT EXISTS waiting_users (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
        room_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
        goal TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 3. Tạo bảng matches
    await client.query(`
      CREATE TABLE IF NOT EXISTS matches (
        id SERIAL PRIMARY KEY,
        room_id UUID UNIQUE NOT NULL,
        user1_id TEXT NOT NULL REFERENCES users(firebase_uid),
        user2_id TEXT NOT NULL REFERENCES users(firebase_uid),
        user1_goal TEXT NOT NULL,
        user2_goal TEXT NOT NULL,
        similarity_score FLOAT DEFAULT 0,
        matched_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 4. Tạo index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_waiting_room ON waiting_users(room_id);
      CREATE INDEX IF NOT EXISTS idx_waiting_user ON waiting_users(user_id);
    `);

    console.log("Migration thành công!");
  } catch (err) {
    console.error("Migration lỗi:", err.message);
  } finally {
    client.release();
  }
}
runMigration();

// =============================
// KHỞI TẠO SERVER
// =============================
const app = express();
app.use(cors());
app.use(express.json());

const AI_URL = "https://stereo-generator-undertake-casa.trycloudflare.com";
const rooms = {};

// =============================
// API /match
// =============================
app.post("/match", async (req, res) => {
  const { goal, user_id } = req.body;

  if (!goal || !user_id) {
    return res.status(400).json({ error: "Thiếu goal hoặc user_id" });
  }

  try {
    // 1. ĐẢM BẢO USER TỒN TẠI (chỉ thêm nếu chưa có)
    await pool.query(
      `INSERT INTO users (firebase_uid, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [user_id, user_id, `${user_id}@temp.com`]
    );

    // 2. TÌM NGƯỜI ĐANG CHỜ
    const { rows: waitingUsers } = await pool.query(
      `SELECT * FROM waiting_users ORDER BY created_at ASC`
    );

    let bestMatch = null;
    let bestScore = 0;

    // 3. SO SÁNH VỚI AI
    for (const user of waitingUsers) {
      if (user.user_id === user_id) continue;

      try {
        const response = await fetch(`${AI_URL}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: [goal, user.goal] }),
        });

        if (!response.ok) continue;
        const { similarity_score = 0 } = await response.json();

        if (similarity_score > bestScore) {
          bestScore = similarity_score;
          bestMatch = user;
        }
      } catch (err) {
        console.error("Lỗi AI:", err.message);
      }
    }

    // 4. GHÉP ĐÔI
    if (bestMatch && bestScore >= 0.6) {
      const roomId = bestMatch.room_id;

      // Xóa khỏi hàng chờ
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);

      // Lưu lịch sử match
      await pool.query(
        `INSERT INTO matches 
         (room_id, user1_id, user2_id, user1_goal, user2_goal, similarity_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomId, user_id, bestMatch.user_id, goal, bestMatch.goal, bestScore]
      );

      console.log(`MATCHED: ${user_id} ↔ ${bestMatch.user_id} | score: ${bestScore.toFixed(2)}`);
      return res.json({ roomId, isCaller: false });
    }

    // 5. TẠO PHÒNG CHỜ MỚI
    const { rows } = await pool.query(
      `INSERT INTO waiting_users (user_id, goal) 
       VALUES ($1, $2) RETURNING room_id`,
      [user_id, goal]
    );

    const roomId = rows[0].room_id;
    console.log(`Tạo phòng chờ: ${user_id} | "${goal}" | ${roomId}`);
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

  console.log(`Kết nối mới → room: ${roomId} (${rooms[roomId].length}/2)`);

  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ ready: true }));
      }
    });
    console.log(`Room ${roomId} sẵn sàng gọi`);
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const others = rooms[roomId].filter(c => c !== ws && c.readyState === WebSocket.OPEN);
      others.forEach(c => c.send(JSON.stringify(data)));
    } catch (err) {
      console.error("Lỗi message:", err);
    }
  });

  ws.on("close", async () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);
      console.log(`Room ${roomId} đã xóa`);
    }
  });
});

// =============================
// HEALTH CHECK
// =============================
app.get("/health", (req, res) => res.json({ status: "OK", time: new Date() }));

// =============================
// KHỞI CHẠY
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Backend chạy trên cổng ${PORT}`);
});
