import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import cors from "cors";
import fetch from "node-fetch";
import pkg from "pg";
const { Pool } = pkg;

// =============================
// ⚙️ CẤU HÌNH KẾT NỐI DATABASE
// =============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// =============================
// 🚀 KHỞI TẠO SERVER EXPRESS
// =============================
const app = express();
app.use(cors());
app.use(express.json());

// 🔗 AI server (qua Cloudflare Tunnel)
const AI_URL = "https://mean-romantic-distinction-reflects.trycloudflare.com";

// Bộ nhớ tạm (WebSocket)
const rooms = {}; // roomId -> [WebSocket clients]

// =============================
// 🧩 API POST /match
// =============================
app.post("/match", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  try {
    // Lấy danh sách người đang chờ trong DB
    const { rows: waitingUsers } = await pool.query("SELECT * FROM waiting_users ORDER BY created_at ASC");

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

    // Nếu tìm được người phù hợp
    if (bestMatch && bestScore >= 0.7) {
      const roomId = bestMatch.room_id;

      // Xóa người kia khỏi hàng chờ
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);

      // Lưu kết quả match vào DB
      await pool.query(
        `INSERT INTO matches (room_id, user1_goal, user2_goal, similarity_score)
         VALUES ($1, $2, $3, $4)`,
        [roomId, goal, bestMatch.goal, bestScore]
      );

      console.log(`🔗 Ghép thành công giữa "${goal}" và "${bestMatch.goal}" | roomId: ${roomId}`);
      return res.json({ roomId, isCaller: false });
    }

    // Nếu chưa ai phù hợp → tạo phòng mới
    const roomId = uuidv4();
    await pool.query(
      "INSERT INTO waiting_users (room_id, goal) VALUES ($1, $2)",
      [roomId, goal]
    );

    console.log(`🆕 Tạo phòng chờ mới cho "${goal}": ${roomId}`);
    res.json({ roomId, isCaller: true });

  } catch (err) {
    console.error("❌ Lỗi xử lý /match:", err);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// =============================
// ⚡ WEBSOCKET SIGNALING
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

  // Khi đủ 2 người → gửi tín hiệu sẵn sàng
  if (rooms[roomId].length === 2) {
    rooms[roomId].forEach(client => {
      if (client.readyState === ws.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} sẵn sàng cho cuộc gọi`);
  }

  // Chuyển tiếp tín hiệu WebRTC giữa 2 người
  ws.on("message", (msg) => {
    const data = JSON.parse(msg);
    const others = rooms[roomId].filter(c => c !== ws && c.readyState === ws.OPEN);
    others.forEach(client => client.send(JSON.stringify(data)));
  });

  // Khi 1 người thoát
  ws.on("close", async () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      console.log(`🗑️ Room deleted: ${roomId}`);
      // Xóa luôn trong DB nếu chưa match
      await pool.query("DELETE FROM waiting_users WHERE room_id = $1", [roomId]);
    } else {
      console.log(`❌ Client left room ${roomId}`);
    }
  });
});

// =============================
// 🚀 KHỞI CHẠY SERVER
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Backend WebSocket server running on port ${PORT}`));
