// -----------------------------
// WebRTC Matching App Frontend
// -----------------------------

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream;
let peerConnection;

// Khi người dùng nhấn nút “Tìm người”
async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) {
    alert("⚠️ Hãy nhập mục tiêu của bạn.");
    return;
  }

  // Truy cập camera và micro
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Không thể truy cập camera/micro: " + err.message);
    return;
  }

  // Gọi API đến server để tìm người cùng “goal”
  const response = await fetch("https://dotcool-back2.onrender.com/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });

  const data = await response.json();
  const isCaller = data.isCaller;
  const roomId = data.roomId;

  console.log(`🎯 Kết nối với room: ${roomId} | Caller: ${isCaller}`);
  startWebRTC(isCaller, roomId);
}

// Hàm khởi tạo WebRTC + WebSocket
async function startWebRTC(isCaller, roomId) {
  // ✅ Cấu hình ICE server (STUN + TURN)
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "openai",
        credential: "openai",
      },
    ],
  });

  // Gửi luồng video/audio của mình
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // Nhận video từ người bên kia
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Tạo WebSocket kết nối tới backend
  const socket = new WebSocket(
    "wss://dotcool-back2.onrender.com/ws?roomId=" + roomId
  );

  // ✅ Hàm chờ WebSocket sẵn sàng
  async function waitForSocketOpen() {
    if (socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve) =>
      socket.addEventListener("open", resolve, { once: true })
    );
  }

  socket.onopen = () => console.log("✅ Đã kết nối WebSocket");

  // Khi nhận dữ liệu qua WebSocket
  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.offer) {
      console.log("📩 Nhận offer");
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(msg.offer)
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await waitForSocketOpen();
      socket.send(JSON.stringify({ answer }));
      console.log("📤 Gửi answer");
    }

    if (msg.answer) {
      console.log("📩 Nhận answer");
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription(msg.answer)
      );
    }

    if (msg.iceCandidate) {
      console.log("📩 Nhận ICE");
      try {
        await peerConnection.addIceCandidate(msg.iceCandidate);
      } catch (e) {
        console.error("Lỗi ICE:", e);
      }
    }
  };

  // Khi trình duyệt tạo ICE candidate mới
  peerConnection.onicecandidate = async ({ candidate }) => {
    if (candidate) {
      await waitForSocketOpen();
      socket.send(JSON.stringify({ iceCandidate: candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // ✅ Caller sẽ gửi offer đầu tiên
  if (isCaller) {
    await waitForSocketOpen();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.send(JSON.stringify({ offer }));
    console.log("📤 Gửi offer");
  }
}
