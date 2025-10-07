const backendUrl = "https://dotcool-back2.onrender.com"; // ⚠️ sửa thành backend Render URL của bạn
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const goalInput = document.getElementById("goal");
const startButton = document.getElementById("startBtn");

let socket;
let peerConnection;

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
  ],
};

startButton.onclick = async () => {
  const goal = goalInput.value.trim();
  if (!goal) return alert("Vui lòng nhập mục tiêu!");

  // Gửi yêu cầu match lên backend
  const res = await fetch(`${backendUrl}/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  const { roomId } = await res.json();

  console.log("🎯 Kết nối với room:", roomId);

  // Kết nối WebSocket
  socket = new WebSocket(backendUrl.replace("https", "wss"));

  socket.onopen = () => {
    console.log("✅ Đã kết nối WebSocket");
    socket.send(JSON.stringify({ type: "join", roomId }));
  };

  socket.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === "ready") {
      console.log("⚡ Ready signal nhận được:", data);
      createPeerConnection();
      if (data.isCaller) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: "offer", offer }));
        console.log("📤 Gửi offer");
      }
    } else if (data.type === "offer") {
      createPeerConnection();
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ type: "answer", answer }));
      console.log("📤 Gửi answer");
    } else if (data.type === "answer") {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      console.log("📥 Nhận answer");
    } else if (data.type === "ice" && data.candidate) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log("📥 Thêm ICE candidate");
      } catch (e) {
        console.error("❌ Lỗi thêm ICE:", e);
      }
    }
  };
};

// -------------------- Tạo kết nối WebRTC --------------------
async function createPeerConnection() {
  peerConnection = new RTCPeerConnection(iceServers);

  // Khi có ICE candidate mới
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // Khi nhận track (video/audio từ người kia)
  peerConnection.ontrack = (event) => {
    console.log("🎥 Nhận remote stream");
    remoteVideo.srcObject = event.streams[0];
  };

  // Lấy camera/mic cục bộ
  const localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
  localStream.getTracks().forEach((track) => peerConnection.addTrack(track, localStream));
}
