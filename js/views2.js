import {
  doc, setDoc, deleteDoc, updateDoc, query, where, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  auth, db, secondaryAuth, state, isAdmin, CLASSES, className, DAYS, PAY_TYPES, EXPENSE_CATS,
  $, $$, esc, todayStr, monthStr, monthsBetween, num, sum, money, byName, empty, options,
  col, getAll, toast, modal, isWorkday,
} from "./core.js";

/* ======================================================================
   جداول المعلمات
   ====================================================================== */
export async function viewSchedule(el) {
  const admin = isAdmin();
  const p = state.profile;
  let teachers = [];
  if (admin) teachers = (await getAll(col("users"))).filter((u) => u.role === "teacher" && u.active !== false).sort(byName);
  const load = () => (admin ? getAll(col("schedules")) : getAll(query(col("schedules"), where("teacherId", "==", p.uid))));
  let items = await load();
  const f = { t: "all" };

  el.innerHTML = `
    <div class="page-head"><h2>${admin ? "جداول المعلمات" : "جدولي الأسبوعي"}</h2>
      <div class="toolbar" style="margin:0">
        ${admin ? '<button class="btn" id="scheduleHelp">طريقة تحديث صورة الجدول</button><button class="btn primary" id="add">+ إضافة حصة</button>' : ""}
        <button class="btn" id="print">طباعة</button>
      </div></div>
    ${admin ? `<div class="toolbar"><select id="tf" style="max-width:240px"><option value="all">كل المعلمات</option>${options(teachers, "")}</select></div>` : ""}
    <div id="list"></div>
    <div id="scheduleImageBox" class="card"></div>`;

  const draw = () => {
    const shown = items.filter((i) => f.t === "all" || i.teacherId === f.t);
    if (!shown.length) { $("#list", el).innerHTML = empty("لا توجد حصص مسجَّلة بعد"); return; }
    $("#list", el).innerHTML = DAYS.map((dn, d) => {
      const list = shown.filter((i) => i.day === d).sort((a, b) => a.from.localeCompare(b.from));
      if (!list.length) return "";
      return `<div class="card sched-day"><h4>${dn}</h4>
        ${list.map((i) => `<div class="sched-item">
          <span class="t">${esc(i.from)} - ${esc(i.to)}</span>
          ${admin ? `<b>${esc(i.teacherName || "")}</b>` : ""}
          <span>${esc(i.subject || "")}</span>
          <span class="badge">${i.classId ? className(i.classId) : "كل الفصول"}</span>
          ${admin ? `<span style="margin-inline-start:auto;display:flex;gap:6px"><button class="btn small" data-edit="${i.id}">تعديل</button><button class="btn small danger" data-del="${i.id}">حذف</button></span>` : ""}
        </div>`).join("")}
      </div>`;
    }).join("");
  };
  const reload = async () => { items = await load(); draw(); };
  draw();
  function drawScheduleImage() {
    const box = $("#scheduleImageBox", el); if (!box) return;
    box.innerHTML = `<h3>صورة الجدول الأسبوعي</h3><img src="assets/schedule.jpg" alt="صورة الجدول" style="max-width:100%;border-radius:12px;display:block;margin:auto" onerror="this.style.display='none';this.nextElementSibling.style.display='block'"><p class="muted" style="display:none">لم يتم إضافة صورة الجدول بعد. راجعي التعليمات أعلى الصفحة.</p>`;
  }
  drawScheduleImage();

  $("#print", el).onclick = () => window.print();
  if (admin) {
    const help = $("#scheduleHelp", el);
    help.onclick = () => modal("تحديث صورة الجدول", `<p>لرفع صورة جديدة بدون Firebase Storage:</p><ol><li>سمّي الصورة <b>schedule.jpg</b>.</li><li>ضعيها داخل مجلد <b>assets</b> في GitHub.</li><li>اختاري استبدال الملف القديم ثم اعملي Commit changes.</li><li>حدّثي الموقع بعد دقيقة أو دقيقتين.</li></ol><p class="hint">يجب أن تكون الصورة بصيغة JPG وباسم schedule.jpg بالضبط.</p>`);
  }
  if (!admin) return;
  $("#tf", el).onchange = (e) => { f.t = e.target.value; draw(); };

  const form = (i = {}) => {
    if (!teachers.length) return toast("أضيفي معلمات من شاشة المستخدمين أولًا", "error");
    modal(i.id ? "تعديل حصة" : "إضافة حصة", `
      <label class="f"><span>المعلمة *</span><select name="teacherId" required>${options(teachers, i.teacherId)}</select></label>
      <div class="row3">
        <label class="f"><span>اليوم *</span><select name="day">${DAYS.map((d, k) => `<option value="${k}" ${i.day === k ? "selected" : ""}>${d}</option>`).join("")}</select></label>
        <label class="f"><span>من *</span><input type="time" name="from" required value="${esc(i.from || "08:00")}"></label>
        <label class="f"><span>إلى *</span><input type="time" name="to" required value="${esc(i.to || "09:00")}"></label>
      </div>
      <div class="row2">
        <label class="f"><span>الفصل</span><select name="classId"><option value="">كل الفصول</option>${options(CLASSES, i.classId)}</select></label>
        <label class="f"><span>النشاط / المادة</span><input name="subject" value="${esc(i.subject)}" placeholder="مثال: حلقة / أنشطة / قرآن"></label>
      </div>`, {
      onSubmit: async (fd) => {
        if (fd.get("from") >= fd.get("to")) { toast("وقت النهاية لازم يكون بعد البداية", "error"); return false; }
        const t = teachers.find((x) => x.id === fd.get("teacherId"));
        const ref = i.id ? doc(db, "schedules", i.id) : doc(col("schedules"));
        await setDoc(ref, {
          teacherId: t.id, teacherName: t.name, day: Number(fd.get("day")),
          from: fd.get("from"), to: fd.get("to"), classId: fd.get("classId"), subject: fd.get("subject").trim(),
        });
        toast("تم الحفظ");
        reload();
      },
    });
  };
  $("#add", el).onclick = () => form();
  el.onclick = async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) return form(items.find((x) => x.id === ed.dataset.edit));
    const del = e.target.closest("[data-del]");
    if (del && confirm("حذف هذه الحصة؟")) { await deleteDoc(doc(db, "schedules", del.dataset.del)); toast("تم الحذف"); reload(); }
  };
}

/* ======================================================================
   التحصيل (الاشتراك الشهري + الزي + الكتب)
   ====================================================================== */
export async function viewFees(el) {
  let students, fees = {}, pays;
  const load = async () => {
    const [s, fl, p] = await Promise.all([getAll(col("students")), getAll(col("fees")), getAll(col("payments"))]);
    students = s.sort(byName);
    fees = Object.fromEntries(fl.map((x) => [x.id, x]));
    pays = p;
  };
  await load();
  let sel = monthStr();
  const f = { cls: "all", q: "", due: false };

  el.innerHTML = `
    <div class="page-head"><h2>التحصيل</h2></div>
    <div class="toolbar">
      <label style="display:flex;gap:8px;align-items:center"><span>الشهر</span><input type="month" id="mo" value="${sel}" style="max-width:180px"></label>
      <select id="cls" style="max-width:160px"><option value="all">كل الفصول</option>${options(CLASSES, "")}</select>
      <input type="search" id="q" placeholder="بحث بالاسم…">
      <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="due"> عليهم متبقي فقط</label>
    </div>
    <div class="grid" id="sum"></div>
    <div id="list"></div>`;

  const calc = (s) => {
    const fee = fees[s.id] || { monthly: 0, uniform: 0, books: 0 };
    const my = pays.filter((p) => p.studentId === s.id);
    const months = monthsBetween(s.startMonth || sel, sel);
    const paidM = sum(my.filter((p) => p.type === "monthly" && (p.forMonth || "") <= sel));
    const paidMonth = sum(my.filter((p) => p.type === "monthly" && p.forMonth === sel));
    const remM = num(fee.monthly) * months - paidM;
    const remU = num(fee.uniform) - sum(my.filter((p) => p.type === "uniform"));
    const remB = num(fee.books) - sum(my.filter((p) => p.type === "books"));
    const total = Math.max(0, remM) + Math.max(0, remU) + Math.max(0, remB);
    return { fee, remM, remU, remB, total, paidMonth, months, paidM };
  };
  const remCell = (r) => (r > 0 ? `<b style="color:var(--red)">${money(r)}</b>` : r < 0 ? `<span class="muted">مقدَّم ${money(-r)}</span>` : '<span style="color:var(--green)">✓</span>');
  const monthBadge = (c) => {
    if (!num(c.fee.monthly)) return '<span class="badge none">—</span>';
    if (c.remM <= 0) return '<span class="badge ok">مسدَّد</span>';
    if (c.paidMonth > 0) return '<span class="badge partial">جزئي</span>';
    return '<span class="badge bad">غير مسدَّد</span>';
  };

  const draw = () => {
    const rows = students
      .filter((s) => s.active !== false && (f.cls === "all" || s.classId === f.cls) && (!f.q || s.name.includes(f.q)))
      .map((s) => ({ s, c: calc(s) }))
      .filter((r) => !f.due || r.c.total > 0);
    const collected = sum(pays.filter((p) => p.ym === sel && (f.cls === "all" || p.classId === f.cls)));
    const remaining = rows.reduce((t, r) => t + r.c.total, 0);
    $("#sum", el).innerHTML = `
      <div class="stat g"><small>المحصَّل في هذا الشهر</small><b>${money(collected)}</b></div>
      <div class="stat r"><small>إجمالي المتبقي (على المعروضين)</small><b>${money(remaining)}</b></div>
      <div class="stat y"><small>عدد الأطفال المعروضين</small><b>${rows.length}</b></div>`;
    $("#list", el).innerHTML = rows.length
      ? `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الفصل</th><th>الاشتراك الشهري (المتبقي)</th><th>حالة الشهر</th><th>الزي</th><th>الكتب</th><th>إجمالي المتبقي</th><th></th></tr></thead><tbody>
        ${rows.map(({ s, c }) => `<tr>
          <td><b>${esc(s.name)}</b></td><td>${className(s.classId)}</td>
          <td>${remCell(c.remM)}</td><td>${monthBadge(c)}</td>
          <td>${num(c.fee.uniform) ? remCell(c.remU) : "—"}</td><td>${num(c.fee.books) ? remCell(c.remB) : "—"}</td>
          <td><b>${money(c.total)}</b></td>
          <td class="actions"><button class="btn small primary" data-pay="${s.id}">تحصيل</button><button class="btn small" data-st="${s.id}">كشف حساب</button></td>
        </tr>`).join("")}
      </tbody></table></div>
      <p class="hint">الاشتراك يُحسب من «بداية الاشتراك» لكل طفل حتى الشهر المختار. المتأخرات من شهور سابقة تظهر ضمن المتبقي.</p>`
      : empty("لا توجد نتائج");
  };
  const reload = async () => { await load(); draw(); };
  draw();

  $("#mo", el).onchange = (e) => { if (e.target.value) { sel = e.target.value; draw(); } };
  $("#cls", el).onchange = (e) => { f.cls = e.target.value; draw(); };
  $("#q", el).oninput = (e) => { f.q = e.target.value.trim(); draw(); };
  $("#due", el).onchange = (e) => { f.due = e.target.checked; draw(); };

  function openCollect(id) {
    const s = students.find((x) => x.id === id), c = calc(s);
    const suggest = (type) =>
      type === "monthly" ? (c.remM > 0 ? c.remM : num(c.fee.monthly)) : type === "uniform" ? Math.max(0, c.remU) : Math.max(0, c.remB);
    const m = modal(`تحصيل من ${s.name}`, `
      <div class="row2">
        <label class="f"><span>نوع المبلغ</span><select name="type">${Object.entries(PAY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label class="f" id="mrow"><span>عن شهر</span><input type="month" name="forMonth" value="${sel}"></label>
      </div>
      <div class="row2">
        <label class="f"><span>المبلغ (ج) *</span><input type="number" min="0" step="0.5" name="amount" required value="${suggest("monthly")}"></label>
        <label class="f"><span>تاريخ الاستلام</span><input type="date" name="date" value="${todayStr()}"></label>
      </div>
      <label class="f"><span>ملاحظة</span><input name="note" placeholder="اختياري"></label>`, {
      submitText: "تسجيل التحصيل",
      onSubmit: async (fd) => {
        const amount = num(fd.get("amount"));
        if (amount <= 0) { toast("اكتبي مبلغًا صحيحًا", "error"); return false; }
        const type = fd.get("type"), date = fd.get("date") || todayStr();
        await setDoc(doc(col("payments")), {
          studentId: s.id, studentName: s.name, classId: s.classId, type,
          forMonth: type === "monthly" ? fd.get("forMonth") || sel : null,
          amount, date, ym: date.slice(0, 7), note: fd.get("note").trim(),
          by: state.profile.uid, createdAt: serverTimestamp(),
        });
        toast("تم تسجيل التحصيل ✅");
        reload();
      },
    });
    const t = m.form.elements.type, amt = m.form.elements.amount, row = $("#mrow", m.el);
    t.onchange = () => { row.style.display = t.value === "monthly" ? "" : "none"; amt.value = suggest(t.value); };
  }

  function openStatement(id) {
    const s = students.find((x) => x.id === id), c = calc(s);
    const my = pays.filter((p) => p.studentId === id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const m = modal(`كشف حساب: ${s.name}`, `
      <div class="grid" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><small>اشتراك (${c.months} شهر)</small><b>${money(num(c.fee.monthly) * c.months)}</b></div>
        <div class="stat g"><small>المدفوع منه</small><b>${money(c.paidM)}</b></div>
        <div class="stat r"><small>إجمالي المتبقي</small><b>${money(c.total)}</b></div>
      </div>
      <p class="hint">الزي المتبقي: ${money(Math.max(0, c.remU))} • الكتب المتبقي: ${money(Math.max(0, c.remB))}</p>
      ${my.length ? `<div class="table-wrap" style="box-shadow:none"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الشهر</th><th>المبلغ</th><th></th></tr></thead><tbody>
        ${my.map((p) => `<tr><td>${esc(p.date)}</td><td>${PAY_TYPES[p.type] || ""}</td><td>${esc(p.forMonth || "—")}</td><td>${money(p.amount)}</td>
          <td><button type="button" class="btn small danger" data-delp="${p.id}">حذف</button></td></tr>`).join("")}
      </tbody></table></div>` : empty("لا توجد مدفوعات مسجَّلة")}`, { wide: true });
    m.el.addEventListener("click", async (e) => {
      const d = e.target.closest("[data-delp]");
      if (!d || !confirm("حذف هذه الدفعة؟")) return;
      await deleteDoc(doc(db, "payments", d.dataset.delp));
      m.close();
      await reload();
      openStatement(id);
    });
  }

  el.onclick = (e) => {
    const pay = e.target.closest("[data-pay]");
    if (pay) return openCollect(pay.dataset.pay);
    const st = e.target.closest("[data-st]");
    if (st) openStatement(st.dataset.st);
  };
}

/* ======================================================================
   المصروفات
   ====================================================================== */
export async function viewExpenses(el) {
  let month = monthStr();
  el.innerHTML = `
    <div class="page-head"><h2>المصروفات</h2><button class="btn primary" id="add">+ إضافة مصروف</button></div>
    <div class="toolbar"><input type="month" id="mo" value="${month}" style="max-width:190px"></div>
    <div class="grid" id="sum"></div>
    <div id="list"></div>`;

  async function draw() {
    const [exps, pays] = await Promise.all([
      getAll(query(col("expenses"), where("ym", "==", month))),
      getAll(query(col("payments"), where("ym", "==", month))),
    ]);
    exps.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const spent = sum(exps), got = sum(pays);
    $("#sum", el).innerHTML = `
      <div class="stat g"><small>المحصَّل</small><b>${money(got)}</b></div>
      <div class="stat r"><small>المصروفات</small><b>${money(spent)}</b></div>
      <div class="stat ${got - spent >= 0 ? "g" : "r"}"><small>الصافي</small><b>${money(got - spent)}</b></div>`;
    const cats = EXPENSE_CATS.map((c) => [c, sum(exps.filter((e) => e.category === c))]).filter((x) => x[1] > 0);
    $("#list", el).innerHTML =
      (cats.length ? `<div class="chips">${cats.map(([c, v]) => `<span class="chip">${esc(c)} <b>${money(v)}</b></span>`).join("")}</div>` : "") +
      (exps.length
        ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>ملاحظة</th><th></th></tr></thead><tbody>
          ${exps.map((x) => `<tr><td>${esc(x.date)}</td><td>${esc(x.category)}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.note || "")}</td>
            <td><button class="btn small danger" data-del="${x.id}">حذف</button></td></tr>`).join("")}
        </tbody></table></div>`
        : empty("لا توجد مصروفات في هذا الشهر"));
  }

  $("#mo", el).onchange = (e) => { if (e.target.value) { month = e.target.value; draw(); } };
  $("#add", el).onclick = () =>
    modal("إضافة مصروف", `
      <div class="row2">
        <label class="f"><span>البند *</span><select name="category">${EXPENSE_CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>
        <label class="f"><span>المبلغ (ج) *</span><input type="number" min="0" step="0.5" name="amount" required></label>
      </div>
      <label class="f"><span>التاريخ</span><input type="date" name="date" value="${todayStr()}"></label>
      <label class="f"><span>ملاحظة</span><input name="note" placeholder="اختياري"></label>`, {
      onSubmit: async (fd) => {
        const amount = num(fd.get("amount"));
        if (amount <= 0) { toast("اكتبي مبلغًا صحيحًا", "error"); return false; }
        const date = fd.get("date") || todayStr();
        await setDoc(doc(col("expenses")), {
          category: fd.get("category"), amount, date, ym: date.slice(0, 7),
          note: fd.get("note").trim(), by: state.profile.uid, createdAt: serverTimestamp(),
        });
        toast("تم التسجيل");
        draw();
      },
    });
  el.onclick = async (e) => {
    const d = e.target.closest("[data-del]");
    if (d && confirm("حذف هذا المصروف؟")) { await deleteDoc(doc(db, "expenses", d.dataset.del)); toast("تم الحذف"); draw(); }
  };
  draw();
}

/* ======================================================================
   المستخدمون (المعلمات والمديرات)
   ====================================================================== */
export async function viewUsers(el) {
  el.innerHTML = `
    <div class="page-head"><h2>المستخدمون</h2><button class="btn primary" id="add">+ إضافة معلمة</button></div>
    <div id="list"></div>
    <p class="hint">المعلمة تدخل بالبريد وكلمة المرور اللي تحطيهم هنا، وترى فقط: جدولها، أطفال فصلها، وحضورها. لا ترى أي بيانات مالية.</p>`;
  let users = [];

  async function draw() {
    users = (await getAll(col("users"))).sort(byName);
    $("#list", el).innerHTML = `<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الفصول</th><th>الحالة</th><th></th></tr></thead><tbody>
      ${users.map((u) => `<tr class="${u.active === false ? "muted" : ""}">
        <td><b>${esc(u.name)}</b></td><td dir="ltr" style="text-align:right">${esc(u.email)}</td>
        <td>${u.role === "admin" ? "مديرة" : "معلمة"}</td>
        <td>${u.role === "admin" ? "—" : (u.classIds || []).map(className).join("، ") || "—"}</td>
        <td><span class="badge ${u.active === false ? "none" : "ok"}">${u.active === false ? "موقوف" : "نشط"}</span></td>
        <td class="actions"><button class="btn small" data-edit="${u.id}">تعديل</button>
          <button class="btn small" data-reset="${u.id}">إعادة كلمة المرور</button></td></tr>`).join("")}
    </tbody></table></div>`;
  }

  const classBoxes = (sel = []) =>
    `<div class="f"><span class="muted" style="font-weight:600;font-size:.92rem;display:block;margin-bottom:4px">الفصول المسؤولة عنها</span>
     <div class="chips">${CLASSES.map((c) => `<label class="chip"><input type="checkbox" name="classIds" value="${c.id}" ${sel.includes(c.id) ? "checked" : ""}> ${c.name}</label>`).join("")}</div></div>`;

  $("#add", el).onclick = () =>
    modal("إضافة مستخدم", `
      <label class="f"><span>الاسم *</span><input name="name" required></label>
      <label class="f"><span>البريد الإلكتروني *</span><input type="email" name="email" required dir="ltr"></label>
      <label class="f"><span>كلمة مرور مبدئية (6 أحرف على الأقل) *</span><input name="password" minlength="6" required dir="ltr"></label>
      <label class="f"><span>الدور</span><select name="role"><option value="teacher">معلمة</option><option value="admin">مديرة (كل الصلاحيات)</option></select></label>
      ${classBoxes()}`, {
      onSubmit: async (fd) => {
        const email = fd.get("email").trim();
        const cred = await createUserWithEmailAndPassword(secondaryAuth, email, fd.get("password"));
        await signOut(secondaryAuth);
        await setDoc(doc(db, "users", cred.user.uid), {
          name: fd.get("name").trim(), email, role: fd.get("role"), active: true,
          classIds: fd.get("role") === "admin" ? [] : fd.getAll("classIds"), createdAt: serverTimestamp(),
        });
        toast("تمت إضافة المستخدم. أعطيها البريد وكلمة المرور.");
        draw();
      },
    });

  el.onclick = async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) {
      const u = users.find((x) => x.id === ed.dataset.edit);
      const me = u.id === state.profile.uid;
      return modal(`تعديل ${u.name}`, `
        <label class="f"><span>الاسم</span><input name="name" required value="${esc(u.name)}"></label>
        ${me ? '<p class="hint">هذا حسابك، لا يمكن تغيير دورك أو إيقافه.</p>' : `
          <label class="f"><span>الدور</span><select name="role"><option value="teacher" ${u.role === "teacher" ? "selected" : ""}>معلمة</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>مديرة</option></select></label>
          ${classBoxes(u.classIds || [])}
          <label class="f" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${u.active !== false ? "checked" : ""}> الحساب نشط (يستطيع الدخول)</label>`}`, {
        onSubmit: async (fd) => {
          const data = { name: fd.get("name").trim() };
          if (!me) {
            data.role = fd.get("role");
            data.classIds = data.role === "admin" ? [] : fd.getAll("classIds");
            data.active = fd.get("active") === "on";
          }
          await updateDoc(doc(db, "users", u.id), data);
          toast("تم الحفظ");
          draw();
        },
      });
    }
    const rs = e.target.closest("[data-reset]");
    if (rs) {
      const u = users.find((x) => x.id === rs.dataset.reset);
      if (!confirm(`إرسال رابط تغيير كلمة المرور إلى ${u.email}؟`)) return;
      try { await sendPasswordResetEmail(auth, u.email); toast("تم إرسال الرابط على البريد"); }
      catch (err) { toast(err.message, "error"); }
    }
  };
  draw();
}
