async function startWebRTC(isCaller, roomId) {
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "turn:global.relay.metered.ca:80", username: "openai", credential: "openai" }
    ],
  });

  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  peerConnection.ontrack = event => {
    remoteVideo.srcObject = event.streams[0];
  };

  const socket = new WebSocket("wss://dotcool-back2.onrender.com/ws?roomId=" + roomId);

  // ✅ Helper: chờ socket mở hoàn toàn
  async function waitForSocketOpen() {
    if (socket.readyState === WebSocket.OPEN) return;
    await new Promise(resolve => {
      socket.addEventListener("open", resolve, { once: true });
    });
  }

  socket.onopen = () => console.log("✅ Đã kết nối WebSocket");

  socket.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);

    if (msg.offer) {
      console.log("📩 Nhận offer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      await waitForSocketOpen();
      socket.send(JSON.stringify({ answer }));
      console.log("📤 Gửi answer");
    }

    if (msg.answer) {
      console.log("📩 Nhận answer");
      await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
    }

    if (msg.iceCandidate) {
      console.log("📩 Nhận ICE");
      await peerConnection.addIceCandidate(msg.iceCandidate);
    }
  };

  peerConnection.onicecandidate = async ({ candidate }) => {
    if (candidate) {
      await waitForSocketOpen();
      socket.send(JSON.stringify({ iceCandidate: candidate }));
      console.log("📤 Gửi ICE candidate");
    }
  };

  // ✅ Caller gửi offer sau khi socket sẵn sàng
  if (isCaller) {
    await waitForSocketOpen();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.send(JSON.stringify({ offer }));
    console.log("📤 Gửi offer");
  }
}
