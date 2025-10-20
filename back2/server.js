// server.js
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
import fetch from "node-fetch";
 // Đã thêm: cần chạy npm install node-fetch@2 (phiên bản CommonJS)

// Lưu ý: Nếu dự án dùng ES Modules ("type": "module" trong package.json), hãy dùng:
// import fetch from 'node-fetch';
// Và cài node-fetch@3: npm install node-fetch@3
// Nhưng code hiện tại dùng require (CommonJS), nên dùng node-fetch@2.

const app = express();
app.use(cors());
app.use(express.json());

// 🧠 URL AI server (qua Cloudflare tunnel) - Hãy đảm bảo URL này ổn định và AI endpoint trả về { similarity_score: number }
const AI_URL = "https://crucial-battle-protein-costa.trycloudflare.com";

const rooms = {};              // roomId -> [WebSocket clients]
const waitingUsers = [];       // danh sách người chờ: { goal, roomId }

// =============================
// 🧩 POST /match — ghép người
// =============================
app.post("/match", async (req, res) => {
  const { goal } = req.body;
  if (!goal) return res.status(400).json({ error: "Thiếu goal" });

  // Nếu đã có người đang chờ, dùng AI để tìm người giống nhất
  if (waitingUsers.length > 0) {
    let bestMatch = null;
    let bestScore = 0;

    for (const user of waitingUsers) {
      try {
        // Thêm timeout để tránh treo nếu AI server chậm hoặc lỗi mạng
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Timeout 10 giây

        const response = await fetch(AI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goals: [goal, user.goal] }),
          signal: controller.signal, // Hỗ trợ abort nếu timeout
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`AI server error: ${response.status}`);
        }

        const data = await response.json();
        const score = data.similarity_score || 0;
        console.log(`🧠 So sánh "${goal}" vs "${user.goal}" = ${score}`);

        if (score > bestScore) {
          bestScore = score;
          bestMatch = user;
        }
      } catch (err) {
        console.error("❌ Lỗi gọi AI:", err.message || err);
        // Tiếp tục với user tiếp theo nếu lỗi
      }
    }

    // Nếu tìm được người phù hợp (ngưỡng 0.7, có thể điều chỉnh)
    if (bestMatch && bestScore >= 0.7) {
      const roomId = bestMatch.roomId;
      waitingUsers.splice(waitingUsers.indexOf(bestMatch), 1);
      console.log(`🤝 Ghép "${goal}" với "${bestMatch.goal}" (score=${bestScore})`);
      return res.json({ roomId, isCaller: false });
    }
  }

  // Nếu không có ai tương tự → tạo phòng chờ mới
  const roomId = uuidv4();
  waitingUsers.push({ goal, roomId });
  rooms[roomId] = [];
  console.log(`🆕 Tạo phòng chờ mới cho "${goal}": ${roomId}`);
  res.json({ roomId, isCaller: true });
});

// =============================
// ⚡ WebSocket signaling
// =============================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/ws" });

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
      if (client.readyState === WebSocket.OPEN)
        client.send(JSON.stringify({ ready: true }));
    });
    console.log(`🚀 Room ${roomId} sẵn sàng gọi video`);
  }

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      const others = rooms[roomId].filter(c => c !== ws && c.readyState === WebSocket.OPEN);
      others.forEach(client => client.send(JSON.stringify(data)));
    } catch (err) {
      console.error("Lỗi parse message WebSocket:", err);
    }
  });

  ws.on("close", () => {
    if (!rooms[roomId]) return;
    rooms[roomId] = rooms[roomId].filter(c => c !== ws);
    if (rooms[roomId].length === 0) {
      delete rooms[roomId];
      // Xóa phòng khỏi waitingUsers nếu còn (tránh rò rỉ)
      const waitingIndex = waitingUsers.findIndex(u => u.roomId === roomId);
      if (waitingIndex !== -1) waitingUsers.splice(waitingIndex, 1);
      console.log(`🗑️ Room ${roomId} đã xóa`);
    } else {
      console.log(`❌ Client rời khỏi room ${roomId}`);
    }
  });
});

// =============================
// 🚀 Khởi chạy
// =============================
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`✅ Backend WebSocket server running on port ${PORT}`));
