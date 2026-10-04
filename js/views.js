import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, query, where, writeBatch, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, isAdmin, CLASSES, className, DAYS, START_MIN, END_MIN, GRACE,
  $, $$, esc, pad, todayStr, monthStr, daysInMonth, num, sum, money, fmtTime, fmtDateAr,
  byName, empty, options, col, getAll, classify, toast, modal, isWorkday,
} from "./core.js";

export * from "./views2.js";

const myClasses = () => (isAdmin() ? CLASSES : CLASSES.filter((c) => state.profile.classIds.includes(c.id)));

export async function loadStudents() {
  if (isAdmin()) return (await getAll(col("students"))).sort(byName);
  const lists = await Promise.all(
    state.profile.classIds.map((c) => getAll(query(col("students"), where("classId", "==", c))))
  );
  return lists.flat().sort(byName);
}

/* ======================================================================
   لوحة المدير
   ====================================================================== */
export async function viewDashboard(el) {
  const today = todayStr(), ym = monthStr();
  const [students, users, att, pays, exps] = await Promise.all([
    getAll(col("students")),
    getAll(col("users")),
    getAll(query(col("staffAttendance"), where("date", "==", today))),
    getAll(query(col("payments"), where("ym", "==", ym))),
    getAll(query(col("expenses"), where("ym", "==", ym))),
  ]);
  const kids = students.filter((s) => s.active !== false);
  const teachers = users.filter((u) => u.role === "teacher" && u.active !== false);
  const attBy = Object.fromEntries(att.map((a) => [a.uid, a]));
  const cnt = { present: 0, late: 0, absent: 0, excused: 0, none: 0 };
  const watch = [];
  teachers.forEach((t) => {
    const c = classify(attBy[t.id]);
    cnt[c.key]++;
    if (["absent", "late", "none"].includes(c.key)) watch.push({ t, c, rec: attBy[t.id] });
  });
  const weekend = [5, 6].includes(new Date().getDay());
  const collected = sum(pays), spent = sum(exps);
  const net = collected - spent;

  el.innerHTML = `
    <div class="page-head"><h2>أهلًا ${esc(state.profile.name)} 🌸</h2><span class="muted">${fmtDateAr(today)}</span></div>
    <div class="grid">
      <div class="stat y"><small>إجمالي الأطفال</small><b>${kids.length}</b></div>
      <div class="stat b"><small>المعلمات</small><b>${teachers.length}</b></div>
      <div class="stat g"><small>المحصَّل هذا الشهر</small><b>${money(collected)}</b></div>
      <div class="stat r"><small>المصروفات هذا الشهر</small><b>${money(spent)}</b></div>
      <div class="stat ${net >= 0 ? "g" : "r"}"><small>الصافي</small><b>${money(net)}</b></div>
    </div>
    <div class="card">
      <h3>الأطفال حسب الفصل</h3>
      <div class="chips">${CLASSES.map((c) => `<span class="chip">${c.name} <b>${kids.filter((s) => s.classId === c.id).length}</b></span>`).join("")}</div>
    </div>
    <div class="card">
      <h3>حضور المعلمات اليوم</h3>
      ${weekend ? '<p class="muted">اليوم إجازة أسبوعية.</p>' : `
        <div class="chips">
          <span class="badge present">حاضرة ${cnt.present}</span>
          <span class="badge late">متأخرة ${cnt.late}</span>
          <span class="badge absent">غائبة ${cnt.absent}</span>
          <span class="badge excused">إجازة ${cnt.excused}</span>
          <span class="badge none">لم تُسجَّل ${cnt.none}</span>
        </div>
        ${watch.length ? `<div class="table-wrap"><table><thead><tr><th>المعلمة</th><th>الحالة</th><th>الحضور</th></tr></thead><tbody>
          ${watch.map((w) => `<tr><td>${esc(w.t.name)}</td><td><span class="badge ${w.c.key}">${w.c.label}</span></td><td>${fmtTime(w.rec?.checkIn)}</td></tr>`).join("")}
        </tbody></table></div>` : '<p class="muted">كل المعلمات حاضرات في المواعيد 👏</p>'}`}
    </div>`;
}

/* ======================================================================
   الأطفال
   ====================================================================== */

async function importStudentsFromExcel(file) {
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  const find = (row, names) => {
    const key = Object.keys(row).find((k) => names.some((n) => String(k).trim().toLowerCase().includes(n)));
    return key ? String(row[key]).trim() : "";
  };
  const classIdOf = (value) => {
    const v = String(value).trim().toLowerCase().replace(/\s+/g, "");
    const found = CLASSES.find((c) => c.id === v || c.name.toLowerCase().replace(/\s+/g, "") === v || c.name.toLowerCase().includes(v) || v.includes(c.id));
    return found?.id || "";
  };
  const clean = rows.map((r) => ({
    name: find(r, ["اسم الطفل", "الطفل", "الاسم", "name"]),
    classId: classIdOf(find(r, ["الفصل", "class", "group"])),
  })).filter((r) => r.name);
  if (!clean.length) throw new Error("لم يتم العثور على أسماء. يجب أن يحتوي الملف على عمود الاسم وعمود الفصل.");
  const invalid = clean.filter((r) => !r.classId);
  if (invalid.length) throw new Error(`يوجد ${invalid.length} صف بدون فصل صحيح. استخدمي: Pre 1 أو Pre 2 أو KG 1 أو KG 2`);
  for (let i = 0; i < clean.length; i += 400) {
    const b = writeBatch(db);
    clean.slice(i, i + 400).forEach((r) => b.set(doc(col("students")), {
      name: r.name, classId: r.classId, startMonth: monthStr(), guardianName: "", phone: "", notes: "", active: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await b.commit();
  }
  return clean.length;
}

export async function viewStudents(el) {
  const admin = isAdmin();
  const classes = myClasses();
  if (!classes.length) {
    el.innerHTML = empty("لم يتم تعيين فصل لحسابك بعد. تواصل مع المدير.");
    return;
  }
  let students = await loadStudents();
  let fees = {};
  const loadFees = async () => {
    fees = Object.fromEntries((await getAll(col("fees"))).map((x) => [x.id, x]));
  };
  if (admin) await loadFees();
  const f = { cls: "all", q: "", archived: false };

  el.innerHTML = `
    <div class="page-head"><h2>${admin ? "الأطفال والفصول" : "أطفال فصلي"}</h2>
      ${admin ? '<div class="toolbar" style="margin:0"><button class="btn" id="importExcel">استيراد Excel</button><input id="excelFile" type="file" accept=".xlsx,.xls,.csv" hidden><button class="btn primary" id="add">+ إضافة طفل</button></div>' : ""}</div>
    <div class="chips" id="chips"></div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="بحث بالاسم أو اسم ولي الأمر…">
      ${admin ? '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="arch"> عرض المؤرشفين</label>' : ""}
    </div>
    <div id="list"></div>`;

  const draw = () => {
    const activeAll = students.filter((s) => s.active !== false);
    const shown = students.filter(
      (s) =>
        (f.archived || s.active !== false) &&
        (f.cls === "all" || s.classId === f.cls) &&
        (!f.q || `${s.name} ${s.guardianName || ""}`.includes(f.q))
    );
    $("#chips", el).innerHTML =
      `<span class="chip ${f.cls === "all" ? "active" : ""}" data-c="all">الكل <b>${activeAll.length}</b></span>` +
      classes.map((c) => `<span class="chip ${f.cls === c.id ? "active" : ""}" data-c="${c.id}">${c.name} <b>${activeAll.filter((s) => s.classId === c.id).length}</b></span>`).join("");
    $("#list", el).innerHTML = shown.length
      ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>الاسم</th><th>الفصل</th><th>ولي الأمر</th><th>الهاتف</th>${admin ? "<th>الاشتراك</th><th></th>" : ""}</tr></thead><tbody>
        ${shown.map((s, i) => `<tr class="${s.active === false ? "muted" : ""}">
          <td>${i + 1}</td>
          <td><b>${esc(s.name)}</b>${s.active === false ? ' <span class="badge none">مؤرشف</span>' : ""}</td>
          <td>${className(s.classId)}</td>
          <td>${esc(s.guardianName || "—")}</td>
          <td dir="ltr" style="text-align:right">${s.phone ? `<a href="tel:${esc(s.phone)}">${esc(s.phone)}</a>` : "—"}</td>
          ${admin ? `<td>${money(fees[s.id]?.monthly)}</td>
            <td class="actions"><button class="btn small" data-edit="${s.id}">تعديل</button>
              <button class="btn small" data-arch="${s.id}">${s.active === false ? "استرجاع" : "أرشفة"}</button>
              <button class="btn small danger" data-del="${s.id}">حذف</button></td>` : ""}
        </tr>`).join("")}
      </tbody></table></div>`
      : empty("لا يوجد أطفال لعرضهم");
  };
  const reload = async () => {
    students = await loadStudents();
    if (admin) await loadFees();
    draw();
  };
  draw();

  $("#q", el).oninput = (e) => { f.q = e.target.value.trim(); draw(); };
  const arch = $("#arch", el);
  if (arch) arch.onchange = (e) => { f.archived = e.target.checked; draw(); };
  const add = $("#add", el);
  if (add) add.onclick = () => studentForm({}, {}, reload);
  const importBtn = $("#importExcel", el), excelFile = $("#excelFile", el);
  if (importBtn && excelFile) {
    importBtn.onclick = () => excelFile.click();
    excelFile.onchange = async () => {
      const file = excelFile.files?.[0]; if (!file) return;
      importBtn.disabled = true;
      try { const n = await importStudentsFromExcel(file); toast(`تم استيراد ${n} طفل بنجاح`); await reload(); }
      catch (err) { toast(err.message || "تعذّر استيراد الملف", "error"); }
      finally { importBtn.disabled = false; excelFile.value = ""; }
    };
  }

  el.onclick = async (e) => {
    const chip = e.target.closest("[data-c]");
    if (chip) { f.cls = chip.dataset.c; return draw(); }
    const edit = e.target.closest("[data-edit]");
    if (edit) { const s = students.find((x) => x.id === edit.dataset.edit); return studentForm(s, fees[s.id] || {}, reload); }
    const ar = e.target.closest("[data-arch]");
    if (ar) {
      const s = students.find((x) => x.id === ar.dataset.arch);
      const to = s.active === false;
      if (!to && !confirm("أرشفة الطفل؟ سيختفي من القوائم والتحصيل (يمكن استرجاعه لاحقًا).\nإذا كان عليه مبالغ متبقية يفضّل إبقاؤه نشطًا حتى يسدد.")) return;
      await updateDoc(doc(db, "students", s.id), { active: to });
      toast(to ? "تم الاسترجاع" : "تمت الأرشفة");
      return reload();
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const s = students.find((x) => x.id === del.dataset.del);
      if (!confirm(`حذف ${s.name} نهائيًا؟ لا يمكن التراجع.`)) return;
      const b = writeBatch(db);
      b.delete(doc(db, "students", s.id));
      b.delete(doc(db, "fees", s.id));
      await b.commit();
      toast("تم الحذف");
      reload();
    }
  };
}

function studentForm(s, fee, afterSave) {
  const isNew = !s.id;
  modal(
    isNew ? "إضافة طفل" : "تعديل بيانات الطفل",
    `<label class="f"><span>اسم الطفل *</span><input name="name" required value="${esc(s.name)}"></label>
     <div class="row2">
       <label class="f"><span>الفصل *</span><select name="classId" required>${options(CLASSES, s.classId)}</select></label>
       <label class="f"><span>بداية الاشتراك</span><input type="month" name="startMonth" value="${esc(s.startMonth || monthStr())}"></label>
     </div>
     <div class="row2">
       <label class="f"><span>اسم ولي الأمر</span><input name="guardianName" value="${esc(s.guardianName)}"></label>
       <label class="f"><span>رقم الهاتف</span><input name="phone" type="tel" dir="ltr" value="${esc(s.phone)}"></label>
     </div>
     <div class="row3">
       <label class="f"><span>الاشتراك الشهري</span><input type="number" min="0" name="monthly" value="${num(fee.monthly)}"></label>
       <label class="f"><span>سعر الزي</span><input type="number" min="0" name="uniform" value="${num(fee.uniform)}"></label>
       <label class="f"><span>سعر الكتب</span><input type="number" min="0" name="books" value="${num(fee.books)}"></label>
     </div>
     <label class="f"><span>ملاحظات</span><textarea name="notes" rows="2">${esc(s.notes)}</textarea></label>`,
    {
      onSubmit: async (fd) => {
        const ref = isNew ? doc(col("students")) : doc(db, "students", s.id);
        const b = writeBatch(db);
        b.set(
          ref,
          {
            name: fd.get("name").trim(),
            classId: fd.get("classId"),
            startMonth: fd.get("startMonth") || monthStr(),
            guardianName: fd.get("guardianName").trim(),
            phone: fd.get("phone").trim(),
            notes: fd.get("notes").trim(),
            active: s.active !== false,
            updatedAt: serverTimestamp(),
            ...(isNew ? { createdAt: serverTimestamp() } : {}),
          },
          { merge: true }
        );
        b.set(doc(db, "fees", ref.id), { monthly: num(fd.get("monthly")), uniform: num(fd.get("uniform")), books: num(fd.get("books")) });
        await b.commit();
        toast("تم الحفظ");
        await afterSave();
      },
    }
  );
}

/* ======================================================================
   لوحة المعلمة (حضور/انصراف + جدول اليوم)
   ====================================================================== */
export async function viewTeacherHome(el) {
  const p = state.profile;
  const date = todayStr();
  const ref = doc(db, "staffAttendance", `${date}_${p.uid}`);

  async function draw() {
    const [snap, kids, scheds] = await Promise.all([
      getDoc(ref),
      loadStudents(),
      getAll(query(col("schedules"), where("teacherId", "==", p.uid))),
    ]);
    const rec = snap.exists() ? snap.data() : null;
    const c = classify(rec);
    const day = new Date().getDay();
    const today = day <= 4 ? scheds.filter((s) => s.day === day).sort((a, b) => a.from.localeCompare(b.from)) : [];
    const activeKids = kids.filter((s) => s.active !== false);
    const weekend = day > 4;

    let action = "";
    if (weekend) action = '<p class="muted">اليوم إجازة أسبوعية 🌿</p>';
    else if (rec?.status === "absent" || rec?.status === "excused") action = `<p>تم تسجيل اليوم لك: <span class="badge ${c.key}">${c.label}</span> من الإدارة.</p>`;
    else if (!rec?.checkIn) action = '<button class="btn primary big" id="in">تسجيل الحضور</button>';
    else if (!rec.checkOut) action = '<button class="btn yellow big" id="out">تسجيل الانصراف</button>';
    else action = '<p>تم تسجيل الحضور والانصراف لهذا اليوم. شكرًا لك 🌸</p>';

    el.innerHTML = `
      <div class="page-head"><h2>أهلًا ${esc(p.name)} 🌸</h2><span class="muted">${fmtDateAr(date)}</span></div>
      <div class="card big-clock">
        <div class="muted">حالتك اليوم</div>
        <div style="margin:6px 0"><span class="badge ${c.key}">${c.label}</span></div>
        <div class="muted">الحضور: <b>${fmtTime(rec?.checkIn)}</b> &nbsp;•&nbsp; الانصراف: <b>${fmtTime(rec?.checkOut)}</b></div>
        <div style="margin-top:14px">${action}</div>
        <p class="hint">الدوام من 8:00 ص إلى 1:00 م. يتم تسجيل الوقت تلقائيًا من النظام.</p>
      </div>
      <div class="grid">
        <div class="stat y"><small>عدد أطفال فصلي</small><b>${activeKids.length}</b></div>
        ${p.classIds.map((id) => `<div class="stat b"><small>${className(id)}</small><b>${activeKids.filter((s) => s.classId === id).length}</b></div>`).join("")}
      </div>
      <div class="card"><h3>جدول اليوم</h3>
        ${today.length ? today.map((s) => `<div class="sched-item"><span class="t">${esc(s.from)} - ${esc(s.to)}</span><span>${esc(s.subject || "")}</span><span class="badge">${s.classId ? className(s.classId) : "كل الفصول"}</span></div>`).join("") : '<p class="muted">لا توجد حصص مسجلة لك اليوم.</p>'}
      </div>`;

    const inBtn = $("#in", el), outBtn = $("#out", el);
    if (inBtn) inBtn.onclick = async () => {
      inBtn.disabled = true;
      try {
        await setDoc(ref, { uid: p.uid, name: p.name, date, workday: isWorkday(date), checkIn: serverTimestamp() });
        toast("تم تسجيل حضورك ✅");
      } catch (e) { toast("تعذّر التسجيل. ربما سجّلتك الإدارة بحالة أخرى.", "error"); }
      draw();
    };
    if (outBtn) outBtn.onclick = async () => {
      if (!confirm("تأكيد تسجيل الانصراف؟")) return;
      outBtn.disabled = true;
      try {
        await updateDoc(ref, { checkOut: serverTimestamp() });
        toast("تم تسجيل انصرافك ✅");
      } catch (e) { toast("تعذّر التسجيل", "error"); }
      draw();
    };
  }
  draw();
}

/* ======================================================================
   حضور وانصراف المعلمات (المدير)
   ====================================================================== */
export async function viewStaffAttendance(el) {
  let date = todayStr();
  el.innerHTML = `
    <div class="page-head"><h2>حضور وانصراف المعلمات</h2></div>
    <div class="card">
      <div class="toolbar"><input type="date" id="d" value="${date}" style="max-width:190px">
        <span class="muted">الدوام 8:00 ص – 1:00 م، والتأخير بعد 8:15 ص</span></div>
      <div id="day"></div>
    </div>
    <div class="card"><h3>ملخص شهري</h3>
      <div class="toolbar"><input type="month" id="m" value="${monthStr()}" style="max-width:190px"></div>
      <div id="mon"></div></div>`;

  const toTime = (ts) => { if (!ts) return ""; const d = ts.toDate(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  async function drawDay() {
    const box = $("#day", el);
    if (!isWorkday(date)) { box.innerHTML = '<p class="hint">الجمعة والسبت إجازة أسبوعية، ولا يتم تسجيل حضور أو انصراف فيهما.</p>'; return; }
    const [users, recs] = await Promise.all([
      getAll(col("users")),
      getAll(query(col("staffAttendance"), where("date", "==", date))),
    ]);
    const teachers = users.filter((u) => u.role === "teacher" && u.active !== false).sort(byName);
    const by = Object.fromEntries(recs.map((r) => [r.uid, r]));
    if (!teachers.length) { box.innerHTML = empty("لا توجد معلمات مسجَّلات. أضيفيهن من شاشة المستخدمين."); return; }
    box.innerHTML = `<div class="table-wrap" style="box-shadow:none"><table><thead><tr><th>المعلمة</th><th>الحالة</th><th>الحضور</th><th>الانصراف</th><th></th></tr></thead><tbody>
      ${teachers.map((t) => {
        const r = by[t.id], c = classify(r);
        const early = r?.checkOut && (() => { const d = r.checkOut.toDate(); return d.getHours() * 60 + d.getMinutes() < END_MIN; })();
        return `<tr><td><b>${esc(t.name)}</b></td>
          <td><span class="badge ${c.key}">${c.label}</span></td>
          <td>${fmtTime(r?.checkIn)}</td>
          <td>${fmtTime(r?.checkOut)}${early ? ' <span class="badge late">مبكر</span>' : ""}</td>
          <td class="actions">
            <button class="btn small" data-time="${t.id}">تعديل الوقت</button>
            <button class="btn small danger" data-st="absent" data-u="${t.id}">غياب</button>
            <button class="btn small blue" data-st="excused" data-u="${t.id}">إجازة</button>
            ${r ? `<button class="btn small" data-clear="${t.id}">مسح</button>` : ""}
          </td></tr>`;
      }).join("")}
    </tbody></table></div>`;

    box.onclick = async (e) => {
      const t = (id) => teachers.find((x) => x.id === id);
      const ref = (id) => doc(db, "staffAttendance", `${date}_${id}`);
      const st = e.target.closest("[data-st]");
      if (st) {
        const u = t(st.dataset.u);
        if (by[u.id]?.checkIn && !confirm("هذه المعلمة لديها حضور مسجَّل. هل تريدين استبداله؟")) return;
        await setDoc(ref(u.id), { uid: u.id, name: u.name, date, workday: isWorkday(date), status: st.dataset.st });
        toast("تم التسجيل");
        return drawDay().then(drawMonth);
      }
      const clr = e.target.closest("[data-clear]");
      if (clr) {
        if (!confirm("مسح تسجيل هذا اليوم؟")) return;
        await deleteDoc(ref(clr.dataset.clear));
        toast("تم المسح");
        return drawDay().then(drawMonth);
      }
      const tm = e.target.closest("[data-time]");
      if (tm) {
        const u = t(tm.dataset.time), r = by[u.id];
        modal(`تعديل وقت ${u.name}`,
          `<div class="row2">
            <label class="f"><span>وقت الحضور</span><input type="time" name="in" value="${toTime(r?.checkIn)}" required></label>
            <label class="f"><span>وقت الانصراف</span><input type="time" name="out" value="${toTime(r?.checkOut)}"></label>
          </div><p class="hint">يُستخدم لو نسيت المعلمة التسجيل.</p>`,
          { onSubmit: async (fd) => {
            const data = { uid: u.id, name: u.name, date, workday: isWorkday(date), checkIn: Timestamp.fromDate(new Date(`${date}T${fd.get("in")}:00`)) };
            if (fd.get("out")) data.checkOut = Timestamp.fromDate(new Date(`${date}T${fd.get("out")}:00`));
            await setDoc(ref(u.id), data);
            toast("تم الحفظ");
            drawDay().then(drawMonth);
          } });
      }
    };
  }

  async function drawMonth() {
    const m = $("#m", el).value;
    const box = $("#mon", el);
    if (!m) return;
    const [users, recs] = await Promise.all([
      getAll(col("users")),
      getAll(query(col("staffAttendance"), where("date", ">=", `${m}-01`), where("date", "<=", `${m}-31`))),
    ]);
    const teachers = users.filter((u) => u.role === "teacher" && u.active !== false).sort(byName);
    const now = todayStr();
    const workdays = [];
    for (let d = 1; d <= daysInMonth(m); d++) {
      const ds = `${m}-${pad(d)}`;
      if (new Date(ds + "T00:00:00").getDay() <= 4 && ds <= now) workdays.push(ds);
    }
    if (!teachers.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<div class="table-wrap" style="box-shadow:none"><table><thead><tr><th>المعلمة</th><th>أيام الحضور</th><th>منها متأخرة</th><th>غياب مسجَّل</th><th>إجازة</th><th>أيام بلا تسجيل</th></tr></thead><tbody>
      ${teachers.map((t) => {
        const mine = recs.filter((r) => r.uid === t.id);
        const k = { present: 0, late: 0, absent: 0, excused: 0 };
        mine.forEach((r) => { const c = classify(r).key; if (c in k) k[c]++; });
        const recorded = new Set(mine.map((r) => r.date));
        const missing = workdays.filter((d) => !recorded.has(d)).length;
        return `<tr><td><b>${esc(t.name)}</b></td><td>${k.present + k.late}</td><td>${k.late}</td>
          <td><span class="badge ${k.absent ? "absent" : "present"}">${k.absent}</span></td><td>${k.excused}</td>
          <td><span class="badge ${missing ? "late" : "present"}">${missing}</span></td></tr>`;
      }).join("")}
    </tbody></table></div>
    <p class="hint">«أيام بلا تسجيل» = أيام عمل (الأحد–الخميس) لم يُسجَّل فيها حضور ولا غياب. سجّلي الإجازات الرسمية بزر «إجازة» حتى لا تُحتسب.</p>`;
  }

  $("#d", el).onchange = (e) => { if (e.target.value) { date = e.target.value; drawDay(); } };
  $("#m", el).onchange = drawMonth;
  await drawDay();
  drawMonth();
}
