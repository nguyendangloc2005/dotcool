// === DOM ===
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream;
let peerConnection;
let socket;

// === BẮT ĐẦU TÌM NGƯỜI ===
async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) {
    alert("Hãy nhập mục tiêu của bạn!");
    return;
  }

  try {
    // 🔹 Lấy camera & mic
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Không thể truy cập camera hoặc micro: " + err.message);
    return;
  }

  // 🔹 Gửi mục tiêu đến server Render (API backend)
  const response = await fetch("https://dotcool-back2.onrender.com/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });

  const { roomId, isCaller } = await response.json();
  console.log("🎯 Kết nối với room:", roomId, "| Caller:", isCaller);

  // 🔹 Bắt đầu WebRTC
  startWebRTC(isCaller, roomId);
}

// === KHỞI TẠO KẾT NỐI WEBRTC ===
async function startWebRTC(isCaller, roomId) {
  // 🔹 Thêm STUN + TURN server để hoạt động qua Internet
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: "turn:relay.metered.ca:80",
        username: "openai",
        credential: "openai",
      },
    ],
  });

  // 🔹 Gửi ICE candidate qua WebSocket
  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send(JSON.stringify({ type: "candidate", candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // 🔹 Khi nhận được stream từ người kia
  peerConnection.ontrack = (event) => {
    console.log("📺 Nhận stream từ người kia");
    remoteVideo.srcObject = event.streams[0];
  };

  // 🔹 Thêm local stream vào kết nối
  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  // === KẾT NỐI WEBSOCKET ===
  socket = new WebSocket(
    "wss://dotcool-back2.onrender.com?roomId=" + roomId
  );

  socket.onopen = async () => {
    console.log("✅ Đã kết nối WebSocket");

    if (isCaller) {
      // Caller tạo offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
      console.log("📤 Gửi offer");
    }
  };

  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    console.log("📩 Nhận:", data.type || Object.keys(data)[0]);

    if (data.type === "offer") {
      // Người nhận set offer
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp: data.sdp })
      );
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
      console.log("📤 Gửi answer");
    } else if (data.type === "answer") {
      await peerConnection.setRemoteDescription(
        new RTCSessionDescription({ type: "answer", sdp: data.sdp })
      );
      console.log("✅ Đã nhận answer");
    } else if (data.type === "candidate" && data.candidate) {
      try {
        await peerConnection.addIceCandidate(data.candidate);
        console.log("✅ Thêm ICE candidate");
      } catch (err) {
        console.error("Lỗi thêm ICE:", err);
      }
    }
  };

  socket.onclose = () => {
    console.log("❌ WebSocket đóng kết nối");
  };
}

// === GÁN NÚT BẮT ĐẦU ===
document.getElementById("findBtn").addEventListener("click", findMatch);
