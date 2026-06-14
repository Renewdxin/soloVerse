// 收发站前端：原生 JS，无构建。只渲染状态 + 调后端，不含业务逻辑。
const $ = (sel) => document.querySelector(sel);

const SPEAKERS = [
  { ref: "ou-wang", name: "王芳" },
  { ref: "ou-li", name: "李四" },
  { ref: "ou-zhang", name: "张伟" },
];

// 快捷句：把"该说什么"备好，录视频/演示时一键发，保证剧情顺。
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
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function renderFeed(feed) {
  const el = $("#feed");
  el.innerHTML = feed
    .map((r) => {
      if (r.kind === "human")
        return `<div class="row"><div class="who">${esc(r.name)}</div><div class="bubble">${esc(r.text)}</div></div>`;
      if (r.kind === "bot")
        return `<div class="row bot"><div class="who">管家</div><div class="bubble">${esc(r.text)}</div></div>`;
      return `<div class="row silence">· 管家沉默 — ${esc(r.reason)}</div>`;
    })
    .join("");
  el.scrollTop = el.scrollHeight;
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

function render(state) {
  if (!state?.clock) return;
  $("#clock").textContent = state.clock.label;
  renderFeed(state.feed);
  renderCards(state.ledger);
  renderDigest(state.digest);
}

function initControls() {
  // 发言人
  $("#speaker").innerHTML = SPEAKERS.map((s) => `<option value="${s.ref}">${s.name}</option>`).join(
    "",
  );
  // 快捷句
  $("#chips").innerHTML = CHIPS.map(
    (c, i) => `<span class="chip" data-chip="${i}">${esc(c.label)}</span>`,
  ).join("");

  const send = async () => {
    const text = $("#text").value.trim();
    if (!text) return;
    $("#text").value = "";
    render(await api("/api/say", { as: $("#speaker").value, text }));
  };
  $("#send").onclick = send;
  $("#text").addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });
  $("#reset").onclick = async () => render(await api("/api/reset", {}));

  // 事件委托：快捷句 / 快进 / 外部世界 / digest
  document.body.addEventListener("click", async (e) => {
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
    if (e.target.dataset.link) {
      render(await api("/api/world", { commitmentId: e.target.dataset.link, set: e.target.value }));
    }
  });
}

initControls();
api("/api/state").then(render);
