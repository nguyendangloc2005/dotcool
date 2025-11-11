// ========================
// app.js – TẤT CẢ TRONG MỘT
// Login + Video Call + Firebase Auth + WebRTC
// ========================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';

// === CẤU HÌNH FIREBASE ===
const firebaseConfig = {
  apiKey: "AIzaSyBM2VDBGfP3NQO4XHUvH3AksjtSDunyhus",
  authDomain: "ddsdcadc.firebaseapp.com",
  projectId: "ddsdcadc",
  storageBucket: "ddsdcadc.firebasestorage.app",
  messagingSenderId: "816654820680",
  appId: "1:816654820680:web:586f286cb42cba71afbf7d",
  measurementId: "G-32T5G1PV75"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// === BIẾN WEBRTC (CHỈ DÙNG TRÊN index.html) ===
let localVideo, remoteVideo, localStream, peerConnection, socket, isCallerGlobal = false;

const iceServers = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:openrelay.metered.ca:80",
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

// ========================
// 1. TRANG ĐĂNG NHẬP (login.html)
// ========================
if (document.getElementById('loginForm')) {
  // Chuyển tab
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.form').forEach(f => f.classList.remove('active'));
      document.getElementById(tab + 'Form').classList.add('active');
    });
  });

  // Đăng nhập Email
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(['loginEmailError', 'loginPasswordError']);
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('loginEmailError', 'Email không hợp lệ.');
    }
    if (!password) {
      return showError('loginPasswordError', 'Vui lòng nhập mật khẩu.');
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      handleAuthError(err, 'login');
    }
  });

  // Đăng ký
  document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(['emailError', 'passwordError', 'confirmPasswordError']);
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showError('emailError', 'Email không hợp lệ.');
    }
    if (password.length < 6) {
      return showError('passwordError', 'Mật khẩu phải ít nhất 6 ký tự.');
    }
    if (password !== confirm) {
      return showError('confirmPasswordError', 'Mật khẩu không khớp.');
    }

    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (err) {
      handleAuthError(err, 'register');
    }
  });

  // Google Login
  document.getElementById('googleLogin').addEventListener('click', () => {
    signInWithPopup(auth, provider).catch(err => {
      if (err.code !== 'auth/popup-closed-by-user') {
        alert('Lỗi Google Login: ' + err.message);
      }
    });
  });
}

// ========================
// 2. TRANG VIDEO CALL (index.html)
// ========================
if (document.getElementById('goalInput')) {
  localVideo = document.getElementById("localVideo");
  remoteVideo = document.getElementById("remoteVideo");

  // Hiển thị thông tin người dùng
  onAuthStateChanged(auth, (user) => {
    if (user) {
      const name = user.displayName || user.email.split('@')[0];
      const photo = user.photoURL || 'https://via.placeholder.com/36?text=U';
      document.getElementById('userName').textContent = name;
      document.getElementById('userAvatar').src = photo;
    } else {
      window.location.href = '/login.html';
    }
  });

  // Đăng xuất
  document.getElementById('logoutBtn').addEventListener('click', () => {
    signOut(auth).then(() => {
      window.location.href = '/login.html';
    }).catch(err => {
      alert('Lỗi đăng xuất: ' + err.message);
    });
  });

  // Tìm người phù hợp
  window.findMatch = async function() {
    const goal = document.getElementById("goalInput").value.trim();
    if (!goal) return alert("Hãy nhập mục tiêu của bạn.");

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
    } catch (err) {
      return alert("Không thể truy cập camera/micro: " + err.message);
    }

    try {
      const res = await fetch("https://dotcool-back2.onrender.com/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal }),
      });
      const { roomId, isCaller } = await res.json();
      isCallerGlobal = isCaller;
      startWebRTC(isCaller, roomId);
    } catch (err) {
      console.error("Lỗi kết nối server:", err);
      alert("Không thể kết nối server. Vui lòng thử lại.");
    }
  };

  // WebRTC
  function startWebRTC(isCaller, roomId) {
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
      remoteVideo.srcObject = event.streams[0];
    };

    peerConnection.onconnectionstatechange = () => {
      console.log("Trạng thái kết nối:", peerConnection.connectionState);
    };

    socket = new WebSocket(`wss://dotcool-back2.onrender.com/ws?roomId=${roomId}`);
    socket.onopen = () => console.log("WebSocket kết nối thành công");

    socket.onmessage = async ({ data }) => {
      const msg = JSON.parse(data);

      if (msg.ready && isCallerGlobal) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.send(JSON.stringify({ offer }));
      }

      if (msg.offer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.send(JSON.stringify({ answer }));
      }

      if (msg.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(msg.answer));
      }

      if (msg.iceCandidate) {
        try {
          await peerConnection.addIceCandidate(msg.iceCandidate);
        } catch (err) {
          console.error("Lỗi ICE candidate:", err);
        }
      }
    };

    peerConnection.onicecandidate = ({ candidate }) => {
      if (candidate && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ iceCandidate: candidate }));
      }
    };

    socket.onclose = () => {
      alert("Kết nối đã đóng. Đang tìm người mới...");
    };
  }

  // Dọn dẹp khi rời trang
  window.addEventListener('beforeunload', () => {
    if (socket) socket.close();
    if (peerConnection) peerConnection.close();
  });
}

// ========================
// HÀM HỖ TRỢ
// ========================
function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearErrors(ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
}

function handleAuthError(err, type) {
  const code = err.code;
  if (code === 'auth/email-already-in-use') {
    showError('emailError', 'Email này đã được sử dụng.');
  } else if (code === 'auth/weak-password') {
    showError('passwordError', 'Mật khẩu quá yếu.');
  } else if (code === 'auth/user-not-found' || code === 'auth/wrong-password') {
    showError('loginPasswordError', 'Email hoặc mật khẩu không đúng.');
  } else if (code === 'auth/too-many-requests') {
    alert('Quá nhiều lần thử. Vui lòng thử lại sau.');
  } else {
    alert('Lỗi: ' + err.message);
  }
}

// === CHUYỂN HƯỚNG THEO TRẠNG THÁI ===
onAuthStateChanged(auth, (user) => {
  const isLoginPage = window.location.pathname.includes('login.html');
  const isVideoPage = window.location.pathname.includes('index.html') || window.location.pathname === '/';

  if (user && isLoginPage) {
    window.location.replace('/index.html');
  } else if (!user && isVideoPage) {
    window.location.replace('/login.html');
  }
});