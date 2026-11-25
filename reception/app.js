// لوحة الاستقبال — تتحدث مع Supabase مباشرة. كل الحماية في قاعدة البيانات (RLS + دالة rahatak_set_status).
(function () {
  "use strict";
  var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"]'); return m ? m.content : ""; };
  var BASE = meta("supabase-url") || "";            // فارغ = نفس الخادم (بيئة الاختبار المحلية)
  var KEY = meta("supabase-anon-key") || "local";
  var COLS = "ref,created_at,service,service_price,customer_name,phone_e164,requested_date,requested_time,notes,source,ad_message,status,confirmed_at,attended_at,paid_amount";
  var SVC = { silver: "العرض الفضي (مساج 45د)", gold: "العرض الذهبي (مساج + حمام)", hammam: "حمام مغربي" };
  var ST = { new: "جديد", contacted: "تم التواصل", confirmed: "مؤكد", attended_paid: "حضر ودفع", no_show: "لم يحضر", cancelled: "ملغي", spam: "مزعج" };
  var SRC = { google_ads: "إعلان جوجل", gbp: "خرائط جوجل", google_organic: "بحث جوجل", direct: "مباشر" };
  var NEXT = {
    new: [["contacted", "تم التواصل", ""], ["confirmed", "تأكيد الموعد", "good"], ["cancelled", "إلغاء", "warn"], ["spam", "مزعج", "warn"]],
    contacted: [["confirmed", "تأكيد الموعد", "good"], ["cancelled", "إلغاء", "warn"], ["spam", "مزعج", "warn"]],
    confirmed: [["attended_paid", "حضر ودفع", "good"], ["no_show", "لم يحضر", "warn"], ["cancelled", "إلغاء", "warn"]]
  };
  var token = null, filter = "new", rows = [], timer = null;
  try { token = sessionStorage.getItem("rh_tok"); } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };

  function api(path, opts) {
    opts = opts || {};
    var h = { "apikey": KEY, "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch(BASE + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          if (r.status === 401) { logout(); throw new Error("انتهت الجلسة، سجّل الدخول مرة أخرى"); }
          if (!r.ok) throw new Error((j && (j.message || j.error_description || j.error)) || ("خطأ " + r.status));
          return j;
        });
      });
  }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmt(ts) { if (!ts) return ""; try { return new Date(ts).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }); } catch (e) { return ts; } }
  function slot(r) { var d = String(r.requested_date || "").slice(0, 10); return r.requested_time === "asap" ? d + " · أقرب وقت" : d + " · " + r.requested_time; }
  function todayKsa() { return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10); }

  function render() {
    var list = $("list"); list.textContent = "";
    var shown = rows.filter(function (r) { return !filter || r.status === filter; });
    if (!shown.length) list.appendChild(el("p", "muted card", "لا توجد طلبات في هذه القائمة."));
    shown.forEach(function (r) {
      var c = el("article", "card req");
      var top = el("div", "row"); top.appendChild(el("span", "ref", r.ref)); top.appendChild(el("span", "badge", ST[r.status] || r.status));
      top.appendChild(el("span", "muted grow", "وصل: " + fmt(r.created_at))); c.appendChild(top);
      c.appendChild(el("div", "", (SVC[r.service] || r.service) + " — " + r.service_price + " ريال"));
      c.appendChild(el("div", "", "الموعد المطلوب: " + slot(r)));
      var who = el("div", "row"); who.appendChild(el("span", "", r.customer_name));
      if (r.phone_e164 && r.phone_e164 !== "REDACTED") { var a = el("a", "tel", r.phone_e164.replace("+966", "0")); a.href = "tel:" + r.phone_e164; who.appendChild(a); }
      c.appendChild(who);
      if (r.notes) c.appendChild(el("div", "muted", "ملاحظات: " + r.notes));
      c.appendChild(el("div", "muted", "المصدر: " + (SRC[r.source] || r.source || "—") + (r.ad_message ? " / رسالة الإعلان: " + r.ad_message : "")));
      if (r.paid_amount) c.appendChild(el("div", "", "المدفوع: " + r.paid_amount + " ريال · " + fmt(r.attended_at)));
      var acts = el("div", "row");
      (NEXT[r.status] || []).forEach(function (n) {
        var b = el("button", n[2], n[1]); b.type = "button";
        b.addEventListener("click", function () { act(r, n[0], b); });
        acts.appendChild(b);
      });
      if (acts.childNodes.length) c.appendChild(acts);
      list.appendChild(c);
    });
    var t = todayKsa();
    $("sNew").textContent = rows.filter(function (r) { return r.status === "new"; }).length;
    $("sConf").textContent = rows.filter(function (r) { return r.status === "confirmed"; }).length;
    var paidToday = rows.filter(function (r) { return r.status === "attended_paid" && r.attended_at && new Date(new Date(r.attended_at).getTime() + 3 * 3600e3).toISOString().slice(0, 10) === t; });
    $("sPaid").textContent = paidToday.length;
    $("sRev").textContent = paidToday.reduce(function (s, r) { return s + (r.paid_amount || 0); }, 0);
  }

  function act(r, status, btn) {
    var body = { p_ref: r.ref, p_status: status, p_paid: null };
    if (status === "attended_paid") {
      var v = window.prompt("المبلغ المدفوع فعليًا بالريال للطلب " + r.ref, String(r.service_price));
      if (v === null) return;
      var n = parseInt(String(v).replace(/[^\d]/g, ""), 10);
      if (!(n >= 1 && n <= 5000)) { $("appErr").textContent = "اكتب مبلغًا صحيحًا."; return; }
      body.p_paid = n;
    } else if (status === "cancelled" || status === "spam" || status === "no_show") {
      if (!window.confirm("تأكيد: «" + (ST[status]) + "» للطلب " + r.ref + "؟")) return;
    }
    btn.disabled = true; $("appErr").textContent = "";
    api("/rest/v1/rpc/rahatak_set_status", { method: "POST", body: body })
      .then(load).catch(function (e) { btn.disabled = false; $("appErr").textContent = "تعذّر الحفظ: " + e.message; });
  }

  function load() {
    return api("/rest/v1/rahatak_booking_requests?select=" + COLS + "&order=created_at.desc&limit=200")
      .then(function (j) { rows = Array.isArray(j) ? j : []; render(); })
      .catch(function (e) { $("appErr").textContent = e.message; });
  }

  function showApp(on) {
    $("login").hidden = on; $("app").hidden = !on;
    if (on) { load(); clearInterval(timer); timer = setInterval(load, 60000); } else { clearInterval(timer); }
  }
  function logout() { token = null; try { sessionStorage.removeItem("rh_tok"); } catch (e) {} rows = []; showApp(false); }

  $("login").addEventListener("submit", function (e) {
    e.preventDefault(); $("loginErr").textContent = "";
    api("/auth/v1/token?grant_type=password", { method: "POST", body: { email: $("email").value.trim(), password: $("password").value } })
      .then(function (j) {
        token = j.access_token; try { sessionStorage.setItem("rh_tok", token); } catch (e) {}
        $("password").value = ""; $("who").textContent = "مسجّل: " + $("email").value.trim(); showApp(true);
      })
      .catch(function () { $("loginErr").textContent = "البريد أو كلمة المرور غير صحيحة."; });
  });
  $("logout").addEventListener("click", logout);
  $("refresh").addEventListener("click", load);
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.getAttribute("data-f");
      document.querySelectorAll(".tabs button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
      render();
    });
  });
  showApp(!!token);
})();
