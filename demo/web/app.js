// 收发站前端：原生 JS，无构建。只渲染状态 + 调后端，不含业务逻辑。
const $ = (sel) => document.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPEAKERS = [
  { ref: "ou-wang", name: "王芳" },
  { ref: "ou-li", name: "李四" },
  { ref: "ou-zhang", name: "张伟" },
];

// 快捷句：把"该说什么"备好，手动演示时一键发，保证剧情顺。
const CHIPS = [
  { as: "ou-wang", text: "@李四 登录鉴权这块你来跟一下？", label: "王芳：派活" },
  {
    as: "ou-li",
    text: "行，我接了。登录 API 的 PR 周五前发出来：https://github.com/acme/app/pull/42",
    label: "李四：认领+PR",
  },
  { as: "ou-li", text: "对", label: "李四：确认" },
  { as: "ou-zhang", text: "今晚团建去哪吃？", label: "张伟：闲聊" },
];

const VERDICT_LABEL = {
  no_change: "无变化",
  progressed: "有进展",
  completed: "看着完成",
  regressed: "被回退",
  inconclusive: "难判定",
};
const STATUS_LABEL = {
  active: "进行中",
  at_risk: "有风险",
  fulfilled: "已结案",
  failed: "已逾期",
  proposed: "待确认",
  abandoned: "已放弃",
  snoozed: "已暂缓",
};

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function rowHTML(r) {
  if (r.kind === "human")
    return `<div class="row"><div class="who">${esc(r.name)}</div><div class="bubble">${esc(r.text)}</div></div>`;
  if (r.kind === "bot")
    return `<div class="row bot"><div class="who">管家</div><div class="bubble">${esc(r.text)}</div></div>`;
  return `<div class="row silence">· 管家沉默 — ${esc(r.reason)}</div>`;
}

function renderCards(ledger) {
  $("#cards").innerHTML = ledger
    .map((c) => {
      const verdict = c.verdict ? ` · 证据：${VERDICT_LABEL[c.verdict] ?? c.verdict}` : "";
      const due = c.due ? `截止 ${c.due}` : "无截止";
      let world = "";
      if (c.kind === "github") {
        world =
          c.world === "merged"
            ? `<span class="muted">✓ PR 已合并</span>`
            : `<button type="button" class="ghost" data-merge="${c.id}">合并 PR</button>`;
      } else if (c.kind === "link") {
        world = `<select data-link="${c.id}">
          ${["no_change", "progressed", "completed", "regressed"]
            .map(
              (v) =>
                `<option value="${v}" ${c.world === v ? "selected" : ""}>${VERDICT_LABEL[v]}</option>`,
            )
            .join("")}
        </select>`;
      }
      return `<div class="card">
        <div class="title">${esc(c.title)}</div>
        <div class="meta">
          <span>${esc(c.assignee)}</span><span>${due}</span>
          <span class="badge ${c.status}">${STATUS_LABEL[c.status] ?? c.status}</span>
          <span class="muted">${verdict}</span>
        </div>
        <div class="world">
          ${world}
          <button type="button" class="ghost" data-digest="${c.assigneeId}">✉ 私聊 TA</button>
        </div>
      </div>`;
    })
    .join("");
}

function renderDigest(digest) {
  $("#digest").innerHTML = digest
    ? `<div class="dm"><h4>✉ 飞书私聊 → ${esc(digest.recipient)}（不进群、不点名）</h4><pre>${esc(digest.text)}</pre></div>`
    : "";
}

// —— 渲染：手动模式整渲，剧场模式增量追加（只让新行做入场动画）——
let renderedCount = 0;
let lastLedgerKey = "";

function render(state) {
  if (!state?.clock) return;
  $("#clock").textContent = state.clock.label;
  $("#feed").innerHTML = state.feed.map(rowHTML).join("");
  renderedCount = state.feed.length;
  $("#feed").scrollTop = $("#feed").scrollHeight;
  renderCards(state.ledger);
  lastLedgerKey = JSON.stringify(state.ledger);
  renderDigest(state.digest);
}

function applyState(state) {
  if (!state?.clock) return;
  $("#clock").textContent = state.clock.label;
  const feed = state.feed;
  const el = $("#feed");
  for (let i = renderedCount; i < feed.length; i++)
    el.insertAdjacentHTML("beforeend", rowHTML(feed[i]));
  renderedCount = feed.length;
  el.scrollTop = el.scrollHeight;
  const key = JSON.stringify(state.ledger);
  if (key !== lastLedgerKey) {
    renderCards(state.ledger);
    lastLedgerKey = key;
  }
  renderDigest(state.digest);
}

function resetView() {
  $("#feed").innerHTML = "";
  $("#cards").innerHTML = "";
  renderedCount = 0;
  lastLedgerKey = "";
  renderDigest(null);
}

// —— 剧场模式 ——
let playing = false;

async function sceneCard(title, sub) {
  const o = $("#overlay");
  o.innerHTML = `<div class="scene-card"><div class="sc-title">${esc(title)}</div><div class="sc-sub">${esc(sub ?? "")}</div></div>`;
  o.hidden = false;
  await sleep(20);
  o.classList.add("show");
  await sleep(1550);
  o.classList.remove("show");
  await sleep(450);
  o.hidden = true;
}

async function tasteCloseup(t) {
  const o = $("#overlay");
  const viol = (t.bad.violations ?? []).map((v) => `<li>${esc(v.detail)}</li>`).join("");
  o.innerHTML = `<div class="taste-closeup">
    <div class="tc good"><span class="tag">✓ 会说</span><div class="msg">「${esc(t.good.message)}」</div></div>
    <div class="tc bad"><span class="tag">✗ 不会说（被分寸关挡下）</span><div class="msg">「${esc(t.bad.message)}」</div><ul>${viol}</ul></div>
  </div>`;
  o.hidden = false;
  await sleep(20);
  o.classList.add("show");
  await sleep(4200);
  o.classList.remove("show");
  await sleep(450);
  o.hidden = true;
}

async function play() {
  if (playing) return;
  playing = true;
  document.body.classList.add("playing");
  $("#play").disabled = true;
  try {
    await api("/api/reset");
    resetView();
    const r = await api("/api/play", {});
    for (const f of r.frames ?? []) {
      if (f.scene) await sceneCard(f.scene, f.sub);
      applyState(f.state);
      if (f.taste) await tasteCloseup(f.taste);
      await sleep(f.scene ? 250 : 1000);
    }
  } finally {
    playing = false;
    document.body.classList.remove("playing");
    $("#play").disabled = false;
  }
}

function initControls() {
  $("#speaker").innerHTML = SPEAKERS.map((s) => `<option value="${s.ref}">${s.name}</option>`).join(
    "",
  );
  $("#chips").innerHTML = CHIPS.map(
    (c, i) => `<span class="chip" data-chip="${i}">${esc(c.label)}</span>`,
  ).join("");

  const send = async () => {
    const text = $("#text").value.trim();
    if (!text || playing) return;
    $("#text").value = "";
    render(await api("/api/say", { as: $("#speaker").value, text }));
  };
  $("#send").onclick = send;
  $("#text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  $("#play").onclick = play;
  $("#reset").onclick = async () => {
    if (playing) return;
    render(await api("/api/reset", {}));
  };

  // 事件委托：快捷句 / 快进 / 外部世界 / digest（剧场播放时忽略）
  document.body.addEventListener("click", async (e) => {
    if (playing) return;
    const t = e.target;
    if (t.dataset.chip !== undefined) {
      const c = CHIPS[+t.dataset.chip];
      $("#speaker").value = c.as;
      render(await api("/api/say", { as: c.as, text: c.text }));
    } else if (t.dataset.adv) {
      render(await api("/api/advance", { to: t.dataset.adv }));
    } else if (t.dataset.merge) {
      render(await api("/api/world", { commitmentId: t.dataset.merge, set: "merged" }));
    } else if (t.dataset.digest) {
      render(await api("/api/digest", { personId: t.dataset.digest }));
    }
  });
  document.body.addEventListener("change", async (e) => {
    if (playing) return;
    if (e.target.dataset.link)
      render(await api("/api/world", { commitmentId: e.target.dataset.link, set: e.target.value }));
  });
}

initControls();
api("/api/state").then(render);
