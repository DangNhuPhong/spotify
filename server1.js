const express = require("express");
const mongoose = require("mongoose"); // Dùng mongoose thay cho mssql
const cors = require("cors");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
// 1. Cấu hình kết nối MongoDB Atlas
// ==========================================
const mongoURI =
  "mongodb+srv://24521329_db_user:123@phong.si6ldnv.mongodb.net/?appName=phongy";

mongoose
  .connect(mongoURI)
  .then(() => console.log("✅ Đã kết nối tới MongoDB Atlas!"))
  .catch((err) => console.log("❌ Lỗi kết nối Database: ", err));

// ==========================================
// 2. KHỞI TẠO SCHEMAS (Cấu trúc các bảng)
// ==========================================
const trackSchema = new mongoose.Schema({
  track_id: { type: String, required: true, unique: true },
  title: String,
  artist: String,
  duration_ms: { type: Number, default: 0 },
});
const Track = mongoose.model("Track", trackSchema);

const userSchema = new mongoose.Schema({
  user_id: { type: String, required: true, unique: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  spotify_premium: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  // Gộp UI_Settings vào User
  ui_settings: {
    theme_color: { type: String, default: "#000000" },
    sticker_coordinates: { type: String },
  },
});
const User = mongoose.model("User", userSchema);

const interactionSchema = new mongoose.Schema({
  user_id: { type: String, required: true },
  track_id: { type: String, required: true },
  action_type: { type: String, required: true },
  played_duration_ms: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now },
});
const Interaction = mongoose.model("Interaction", interactionSchema);

// ==========================================
// API 1: HỨNG DỮ LIỆU TỪ FRONTEND (Của Châu)
// ==========================================
app.post("/api/interactions", async (req, res) => {
  try {
    const {
      user_id,
      track_id,
      title,
      artist,
      duration_ms,
      action_type,
      played_duration_ms,
    } = req.body;

    const validActions = ["PLAY", "PAUSE", "NEXT", "PREV"];
    if (!validActions.includes(action_type)) {
      return res.status(400).json({ error: "Hành động không hợp lệ!" });
    }

    // 1. Kiểm tra và thêm bài hát vào bảng Tracks (upsert)
    if (title && artist) {
      await Track.findOneAndUpdate(
        { track_id: track_id },
        { title: title, artist: artist, duration_ms: duration_ms || 0 },
        { upsert: true, new: true },
      );
    }

    // 2. Lưu vào bảng Interactions
    const newInteraction = new Interaction({
      user_id,
      track_id,
      action_type,
      played_duration_ms: played_duration_ms || 0,
    });

    const savedInteraction = await newInteraction.save();

    res.status(201).json({
      message: "Đã ghi nhận hành vi thành công!",
      interaction_id: savedInteraction._id, // MongoDB tự sinh _id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi khi lưu vào Database" });
  }
});

// ==========================================
// API 2: NHẢ DỮ LIỆU CHO THUẬT TOÁN (Của Nguyên)
// ==========================================
app.get("/api/interactions/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;

    // Tìm các interactions của user và sắp xếp giảm dần theo thời gian (mới nhất xếp trước)
    const interactions = await Interaction.find({ user_id: userId }).sort({
      timestamp: -1,
    });

    res.status(200).json({
      user_id: userId,
      total_interactions: interactions.length,
      data: interactions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi khi truy xuất Database" });
  }
});

// ==========================================
// API 3: LƯU TÙY CHỈNH GIAO DIỆN (UI Customization)
// ==========================================
app.post("/api/ui-settings", async (req, res) => {
  try {
    const { user_id, theme_color, sticker_coordinates } = req.body;
    const stickersStr =
      typeof sticker_coordinates === "string"
        ? sticker_coordinates
        : JSON.stringify(sticker_coordinates);

    // Cập nhật ui_settings trực tiếp vào bảng User
    const updatedUser = await User.findOneAndUpdate(
      { user_id: user_id },
      {
        $set: {
          "ui_settings.theme_color": theme_color,
          "ui_settings.sticker_coordinates": stickersStr,
        },
      },
      { new: true }, // Trả về document mới sau khi update
    );

    if (!updatedUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng này!" });
    }

    res.status(200).json({ message: "Đã lưu thiết lập giao diện!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi lưu cài đặt UI" });
  }
});

// ==========================================
// API 4: ĐĂNG KÝ TÀI KHOẢN (SIGN UP)
// ==========================================
app.post("/api/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập đủ Username và Password!" });
    }

    // Kiểm tra User đã tồn tại chưa
    const checkUser = await User.findOne({ username: username });
    if (checkUser) {
      return res
        .status(400)
        .json({ error: "Username đã tồn tại, vui lòng chọn tên khác!" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const newUserId = crypto.randomUUID();

    const newUser = new User({
      user_id: newUserId,
      username: username,
      password: hashedPassword,
      spotify_premium: false,
    });

    await newUser.save();

    res.status(201).json({
      message: "Đăng ký thành công!",
      user_id: newUserId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi Server khi đăng ký" });
  }
});

// ==========================================
// API 5: ĐĂNG NHẬP (LOGIN)
// ==========================================
app.post("/api/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Vui lòng nhập đủ Username và Password!" });
    }

    // Tìm User
    const user = await User.findOne({ username: username });
    if (!user) {
      return res.status(401).json({ error: "Tên đăng nhập không tồn tại!" });
    }

    // Kiểm tra mật khẩu
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Mật khẩu không chính xác!" });
    }

    res.status(200).json({
      message: "Đăng nhập thành công!",
      data: {
        user_id: user.user_id,
        username: user.username,
        spotify_premium: user.spotify_premium,
        ui_settings: user.ui_settings, // Trả về luôn thiết lập UI lúc đăng nhập
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi Server khi đăng nhập" });
  }
});

// ==========================================
// API 6: TỰ ĐỘNG LẤY SPOTIFY ACCESS TOKEN
// ==========================================
const SPOTIFY_CLIENT_ID = "d0d7a472bc5541c1b32efd788b378a20";
const SPOTIFY_CLIENT_SECRET = "cd68bb8bb28d48a1b013107bab16962e";

app.get("/api/spotify-token", async (req, res) => {
  try {
    // Sửa link fetch token chuẩn của Spotify API
    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: SPOTIFY_CLIENT_ID,
        client_secret: SPOTIFY_CLIENT_SECRET,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(400).json({ error: "Lỗi từ Spotify", details: data });
    }

    res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
    });
  } catch (err) {
    console.error("Lỗi khi lấy Spotify Token:", err);
    res.status(500).json({ error: "Lỗi Server Backend" });
  }
});
// ==========================================
// API 7: LẤY DANH SÁCH BÀI HÁT (TRACKS)
// ==========================================
app.get("/api/tracks", async (req, res) => {
  try {
    // Lấy toàn bộ dữ liệu trong collection Tracks
    const tracks = await Track.find({});

    res.status(200).json({
      message: "Lấy danh sách bài hát thành công!",
      total_tracks: tracks.length,
      data: tracks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi Server khi truy xuất danh sách Track" });
  }
});

// ==========================================
// API 8: LẤY DANH SÁCH NGƯỜI DÙNG (USERS)
// ==========================================
app.get("/api/users", async (req, res) => {
  try {
    // Lấy toàn bộ dữ liệu User nhưng BỎ QUA trường password (.select("-password"))
    const users = await User.find({}).select("-password");

    res.status(200).json({
      message: "Lấy danh sách người dùng thành công!",
      total_users: users.length,
      data: users,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi Server khi truy xuất danh sách User" });
  }
});
// ==========================================
// KHỞI ĐỘNG SERVER (LUÔN NẰM Ở DƯỚI CÙNG)
// ==========================================
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Backend Server đang chạy tại http://localhost:${PORT}`);
});
