import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, state, isAdmin, $, $$, esc, toast, errMsg, LOGO } from "./core.js";
import * as V from "./views.js";

const ADMIN_NAV = [
  { id: "dashboard", label: "الرئيسية", icon: "🏠", fn: V.viewDashboard },
  { id: "students", label: "الأطفال والفصول", icon: "🧒", fn: V.viewStudents },
  { id: "attendance", label: "حضور الأطفال", icon: "✅", fn: V.viewChildAttendance },
  { id: "staff", label: "حضور المعلمات", icon: "🕗", fn: V.viewStaffAttendance },
  { id: "schedule", label: "جداول المعلمات", icon: "📅", fn: V.viewSchedule },
  { id: "fees", label: "التحصيل", icon: "💰", fn: V.viewFees },
  { id: "expenses", label: "المصروفات", icon: "🧾", fn: V.viewExpenses },
  { id: "users", label: "المستخدمون", icon: "👩‍🏫", fn: V.viewUsers },
];
const TEACHER_NAV = [
  { id: "home", label: "الرئيسية", icon: "🏠", fn: V.viewTeacherHome },
  { id: "students", label: "أطفال فصلي", icon: "🧒", fn: V.viewStudents },
  { id: "attendance", label: "حضور الأطفال", icon: "✅", fn: V.viewChildAttendance },
  { id: "schedule", label: "جدولي", icon: "📅", fn: V.viewSchedule },
];
const navItems = () => (isAdmin() ? ADMIN_NAV : TEACHER_NAV);

/* ---------- تسجيل الدخول ---------- */
async function isInitialized() {
  try {
    return (await getDoc(doc(db, "settings", "init"))).exists();
  } catch {
    return true;
  }
}

async function showLogin() {
  const note = state.flash;
  state.flash = null;
  const initialized = await isInitialized();
  $("#app").innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <img class="logo" src="${LOGO}" alt="مس داليا كيدز" onerror="this.style.display='none'">
        <h1>مس داليا كيدز</h1>
        <p class="sub">نظام إدارة الحضانة</p>
        ${note ? `<div class="note">${esc(note)}</div>` : ""}
        <form id="loginForm">
          <label class="f"><span>البريد الإلكتروني</span><input type="email" name="email" required autocomplete="username" dir="ltr"></label>
          <label class="f"><span>كلمة المرور</span><input type="password" name="password" required autocomplete="current-password" dir="ltr"></label>
          <button class="btn primary" style="width:100%" type="submit">دخول</button>
        </form>
        <button class="link-btn" id="forgot">نسيت كلمة المرور؟</button>
        ${initialized ? "" : `<hr style="border:0;border-top:1px solid var(--line);margin:12px 0"><button class="link-btn" id="setup">أول استخدام؟ إنشاء حساب المديرة</button>`}
      </div>
    </div>`;

  $("#loginForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $("[type=submit]", e.target);
    btn.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, f.get("email").trim(), f.get("password"));
    } catch (err) {
      toast(errMsg(err), "error");
      btn.disabled = false;
    }
  };
  $("#forgot").onclick = async () => {
    const email = $("[name=email]").value.trim();
    if (!email) return toast("اكتبي بريدك الإلكتروني أولًا ثم اضغطي نسيت كلمة المرور", "error");
    try {
      await sendPasswordResetEmail(auth, email);
      toast("تم إرسال رابط تغيير كلمة المرور على بريدك");
    } catch (err) {
      toast(errMsg(err), "error");
    }
  };
  const setup = $("#setup");
  if (setup) setup.onclick = showSetup;
}

function showSetup() {
  $("#app").innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <img class="logo" src="${LOGO}" alt="" onerror="this.style.display='none'">
        <h1>إنشاء حساب المديرة</h1>
        <p class="sub">تُنفَّذ مرة واحدة فقط عند أول استخدام</p>
        <form id="setupForm">
          <label class="f"><span>الاسم</span><input name="name" required></label>
          <label class="f"><span>البريد الإلكتروني</span><input type="email" name="email" required dir="ltr"></label>
          <label class="f"><span>كلمة المرور (6 أحرف على الأقل)</span><input type="password" name="password" minlength="6" required dir="ltr"></label>
          <button class="btn primary" style="width:100%" type="submit">إنشاء الحساب</button>
        </form>
        <button class="link-btn" id="back">رجوع</button>
      </div>
    </div>`;
  $("#back").onclick = showLogin;
  $("#setupForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = $("[type=submit]", e.target);
    btn.disabled = true;
    state.settingUp = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.get("email").trim(), f.get("password"));
      try {
        const b = writeBatch(db);
        b.set(doc(db, "users", cred.user.uid), {
          name: f.get("name").trim(), email: f.get("email").trim(), role: "admin",
          active: true, classIds: [], createdAt: serverTimestamp(),
        });
        b.set(doc(db, "settings", "init"), { by: cred.user.uid, at: serverTimestamp() });
        await b.commit();
      } catch (err) {
        await signOut(auth);
        throw err;
      }
      state.settingUp = false;
      await handleUser(auth.currentUser);
    } catch (err) {
      state.settingUp = false;
      toast(errMsg(err), "error");
      btn.disabled = false;
    }
  };
}

/* ---------- بعد تسجيل الدخول ---------- */
async function handleUser(user) {
  state.user = user;
  state.profile = null;
  if (!user) return showLogin();
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists() || snap.data().active === false) {
      state.flash = snap.exists()
        ? "هذا الحساب موقوف. تواصلي مع المديرة."
        : "هذا الحساب غير مسجّل في النظام. تواصلي مع المديرة.";
      await signOut(auth);
      return;
    }
    state.profile = { classIds: [], ...snap.data(), uid: user.uid };
    showShell();
  } catch (e) {
    console.error(e);
    state.flash = errMsg(e);
    await signOut(auth);
  }
}

function showShell() {
  const items = navItems();
  $("#app").innerHTML = `
    <header class="topbar">
      <div class="brand">
        <img src="${LOGO}" alt="" onerror="this.style.display='none'">
        <div><b>مس داليا كيدز</b><small>${isAdmin() ? "لوحة المديرة" : "لوحة المعلمة"}</small></div>
      </div>
      <div class="user"><span>${esc(state.profile.name)}</span><button class="btn small" id="logout">خروج</button></div>
    </header>
    <div class="shell">
      <nav class="nav" id="nav">
        ${items.map((i) => `<a href="#/${i.id}" data-id="${i.id}"><span>${i.icon}</span>${i.label}</a>`).join("")}
      </nav>
      <main id="view" class="view"></main>
    </div>`;
  $("#logout").onclick = () => signOut(auth);
  window.onhashchange = navigate;
  navigate();
}

async function navigate() {
  if (!state.profile) return;
  const items = navItems();
  const id = location.hash.replace("#/", "") || items[0].id;
  const item = items.find((i) => i.id === id) || items[0];
  $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.id === item.id));
  const holder = document.createElement("div");
  holder.innerHTML = '<div class="loading">جاري التحميل…</div>';
  $("#view").replaceChildren(holder); // كل شاشة لها حاوية جديدة لتفادي تداخل الشاشات
  try {
    await item.fn(holder); // كل شاشة تستبدل نص "جاري التحميل" بمحتواها
  } catch (e) {
    console.error(e);
    holder.innerHTML = `<div class="empty">حدث خطأ: ${esc(errMsg(e))}</div>`;
  }
}

onAuthStateChanged(auth, (user) => {
  if (state.settingUp) return;
  handleUser(user);
});
