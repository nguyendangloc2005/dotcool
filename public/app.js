const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
let localStream;
let peerConnection;

async function findMatch() {
  const goal = document.getElementById("goalInput").value.trim();
  if (!goal) {
    alert("Hãy nhập mục tiêu của bạn.");
    return;
  }

  // Lấy media stream
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (err) {
    alert("Không thể truy cập camera/micro: " + err.message);
    return;
  }

  // Gửi mục tiêu đến server để match (gọi API backend)
  const response = await fetch("https://dotcool-back2.onrender.com/match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });

  const data = await response.json();
  const isCaller = data.isCaller;
  const roomId = data.roomId;

  startWebRTC(isCaller, roomId);
}

async function startWebRTC(isCaller, roomId) {
  // ✅ Thêm STUN server để hoạt động qua Internet
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  });

  // Thêm luồng video/audio cục bộ
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Khi nhận được stream từ đối phương
  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  // Kết nối WebSocket bảo mật qua HTTPS
  const socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);

  socket.onopen = () => {
    console.log("🔗 WebSocket connected to room:", roomId);
  };

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.answer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    }

    if (msg.offer) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.send(JSON.stringify({ answer }));
    }

    if (msg.iceCandidate) {
      try {
        await peerConnection.addIceCandidate(msg.iceCandidate);
      } catch (e) {
        console.error("Lỗi ICE", e);
      }
    }
  };

  peerConnection.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send(JSON.stringify({ iceCandidate: candidate }));
    }
  };

  if (isCaller) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.send(JSON.stringify({ offer }));
  }
}
