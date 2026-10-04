import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// تطبيق ثانٍ يُستخدم فقط لإنشاء حسابات المعلمات دون تسجيل خروج المديرة
export const secondaryAuth = getAuth(initializeApp(firebaseConfig, "secondary"));

export const state = { user: null, profile: null, settingUp: false, flash: null };
export const isAdmin = () => state.profile?.role === "admin";

/* ---------- ثوابت ---------- */
export const LOGO = "logo.jpg";
export const CLASSES = [
  { id: "pre1", name: "Pre 1" },
  { id: "pre2", name: "Pre 2" },
  { id: "kg1", name: "KG 1" },
  { id: "kg2", name: "KG 2" },
];
export const className = (id) => CLASSES.find((c) => c.id === id)?.name || "—";
export const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس"]; // 0..4 (أيام العمل)
export const isWorkday = (dateOrDay) => {
  const day = typeof dateOrDay === "number" ? dateOrDay : new Date(`${dateOrDay}T00:00:00`).getDay();
  return day <= 4;
};
export const START_MIN = 8 * 60;   // بداية الدوام 8:00
export const GRACE = 15;           // سماح بالدقائق
export const END_MIN = 13 * 60;    // نهاية الدوام 1:00
export const PAY_TYPES = { monthly: "اشتراك شهري", uniform: "الزي", books: "الكتب" };
export const EXPENSE_CATS = ["إيجار", "رواتب", "فواتير (كهرباء/مياه)", "أدوات ومستلزمات", "تغذية", "صيانة", "أخرى"];

/* ---------- أدوات عامة ---------- */
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = (n) => String(n).padStart(2, "0");
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const daysInMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
};
export const monthsBetween = (start, end) => {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(0, (ey - sy) * 12 + (em - sm) + 1);
};
export const num = (v) => Number(v) || 0;
export const sum = (arr) => arr.reduce((t, p) => t + num(p.amount), 0);
export const money = (n) => `${(Math.round(num(n) * 100) / 100).toLocaleString("en-US")} ج`;
export const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  let h = d.getHours();
  const ap = h >= 12 ? "م" : "ص";
  h = h % 12 || 12;
  return `${h}:${pad(d.getMinutes())} ${ap}`;
};
export const fmtDateAr = (str) =>
  new Date(str + "T00:00:00").toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const byName = (a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar");
export const empty = (msg) => `<div class="empty">${esc(msg)}</div>`;
export const options = (items, sel, vk = "id", lk = "name") =>
  items.map((i) => `<option value="${esc(i[vk])}" ${i[vk] === sel ? "selected" : ""}>${esc(i[lk])}</option>`).join("");

export const col = (n) => collection(db, n);
export async function getAll(q) {
  const s = await getDocs(q);
  return s.docs.map((d) => ({ ...d.data(), id: d.id }));
}

/* ---------- حالة حضور المعلمة ---------- */
export function classify(rec) {
  if (!rec) return { key: "none", label: "لم يُسجَّل" };
  if (rec.status === "absent") return { key: "absent", label: "غائبة" };
  if (rec.status === "excused") return { key: "excused", label: "إجازة" };
  if (rec.checkIn) {
    const t = rec.checkIn.toDate();
    const mins = t.getHours() * 60 + t.getMinutes();
    return mins > START_MIN + GRACE ? { key: "late", label: "متأخرة" } : { key: "present", label: "حاضرة" };
  }
  return { key: "none", label: "لم يُسجَّل" };
}

/* ---------- رسائل ---------- */
export function toast(msg, type = "ok") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export function errMsg(err) {
  const c = err?.code || "";
  const map = {
    "auth/invalid-credential": "البريد الإلكتروني أو كلمة المرور غير صحيحة",
    "auth/invalid-email": "البريد الإلكتروني غير صحيح",
    "auth/user-not-found": "لا يوجد حساب بهذا البريد",
    "auth/wrong-password": "كلمة المرور غير صحيحة",
    "auth/email-already-in-use": "هذا البريد مستخدم من قبل",
    "auth/weak-password": "كلمة المرور ضعيفة (6 أحرف على الأقل)",
    "auth/too-many-requests": "محاولات كثيرة، حاولي بعد قليل",
    "auth/network-request-failed": "لا يوجد اتصال بالإنترنت",
    "permission-denied": "ليس لديك صلاحية لهذا الإجراء",
    unavailable: "تعذّر الاتصال، تأكدي من الإنترنت",
  };
  for (const k in map) if (c.includes(k)) return map[k];
  return err?.message || "حدث خطأ غير متوقع";
}

/* ---------- نافذة منبثقة ---------- */
export function modal(title, bodyHtml, { onSubmit, submitText = "حفظ", wide = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal-back";
  wrap.innerHTML = `
    <div class="modal ${wide ? "wide" : ""}">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" type="button" data-close>✕</button></div>
      <form class="modal-body">
        ${bodyHtml}
        <div class="modal-actions">
          ${onSubmit ? `<button class="btn primary" type="submit">${esc(submitText)}</button>` : ""}
          <button class="btn" type="button" data-close>إغلاق</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("mousedown", (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) close();
  });
  const form = $("form", wrap);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $("[type=submit]", form);
    btn.disabled = true;
    try {
      const r = await onSubmit(new FormData(form), form);
      if (r !== false) close();
    } catch (err) {
      console.error(err);
      toast(errMsg(err), "error");
    } finally {
      btn.disabled = false;
    }
  });
  return { close, el: wrap, form };
}
