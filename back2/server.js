// server.js – HOÀN CHỈNH, KHÔNG CẦN SQL, CHẠY NGAY!
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
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

// TỰ ĐỘNG TẠO BẢNG MỚI – XÓA BẢNG CŨ NẾU CẦN
async function runMigration() {
  const client = await pool.connect();
  try {
    console.log("Bắt đầu migration...");

    // 1. XÓA BẢNG CŨ (nếu có) → ĐẢM BẢO SẠCH
    await client.query(`
      DROP TABLE IF EXISTS matches CASCADE;
      DROP TABLE IF EXISTS waiting_users CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `);

    // 2. TẠO BẢNG users – DÙNG firebase_uid LÀM KHÓA CHÍNH
    await client.query(`
      CREATE TABLE users (
        firebase_uid TEXT PRIMARY KEY,
        name TEXT,
        email TEXT,
        photo_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 3. TẠO BẢNG waiting_users – user_id TEXT
    await client.query(`
      CREATE TABLE waiting_users (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(firebase_uid) ON DELETE CASCADE,
        room_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
        goal TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // 4. TẠO BẢNG matches – user1_id, user2_id TEXT
    await client.query(`
      CREATE TABLE matches (
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

    // 5. TẠO INDEX
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_waiting_room ON waiting_users(room_id);
      CREATE INDEX IF NOT EXISTS idx_waiting_user ON waiting_users(user_id);
    `);

    console.log("Migration thành công! DB đã được tạo mới.");
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

const AI_URL = "https://engineer-buf-sbjct-reno.trycloudflare.com";
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
    // 1. THÊM USER (firebase_uid là khóa chính)
    await pool.query(
      `INSERT INTO users (firebase_uid, name, email)
       VALUES ($1, $2, $3)
       ON CONFLICT (firebase_uid) DO NOTHING`,
      [user_id, user_id, `${user_id}@temp.com`]
    );

    // 2. TÌM NGƯỜI ĐANG CHỜ (loại chính mình)
    const { rows: waitingUsers } = await pool.query(
      `SELECT * FROM waiting_users WHERE user_id != $1 ORDER BY created_at ASC`,
      [user_id]
    );

    let bestMatch = null;
    let bestScore = 0;

    // 3. SO SÁNH VỚI AI (bỏ qua nếu lỗi)
    for (const user of waitingUsers) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${AI_URL}/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: [goal, user.goal] }),
          signal: controller.signal
        });

        clearTimeout(timeout);
        if (!response.ok) continue;

        const { similarity_score = 0 } = await response.json();
        if (similarity_score > bestScore) {
          bestScore = similarity_score;
          bestMatch = user;
        }
      } catch (err) {
        console.warn("AI server lỗi, bỏ qua:", err.message);
      }
    }

    // 4. GHÉP ĐÔI
    if (bestMatch && bestScore >= 0.6) {
      const roomId = bestMatch.room_id;

      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);

      await pool.query(
        `INSERT INTO matches 
         (room_id, user1_id, user2_id, user1_goal, user2_goal, similarity_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [roomId, user_id, bestMatch.user_id, goal, bestMatch.goal, bestScore]
      );

      console.log(`MATCHED: ${user_id} ↔ ${bestMatch.user_id} | score: ${bestScore.toFixed(2)}`);
      return res.json({ roomId, isCaller: false });
    }

    // 5. TẠO PHÒNG MỚI
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
// WEBSOCKET
// =============================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const roomId = new URL(req.url, `http://${req.headers.host}`).searchParams.get("roomId");
  if (!roomId) return ws.close();

  rooms[roomId] ??= [];
  rooms[roomId].push(ws);

  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ ready: true }));
    });
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      rooms[roomId]
        ?.filter(c => c !== ws && c.readyState === WebSocket.OPEN)
        .forEach(c => c.send(JSON.stringify(data)));
    } catch {}
  });

  ws.on("close", async () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);
    }
  });
});

// =============================
// HEALTH + START
// =============================
app.get("/health", (req, res) => res.json({ status: "OK", time: new Date() }));

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Backend chạy trên cổng ${PORT} – SẴN SÀNG KẾT NỐI!`);
});
