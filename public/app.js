const $ = id => document.getElementById(id);
let timer = null, sessionActive = false, total = 0, done = 0, nextBusy = false;

function parseTasks() {
  const lines = $("taskInput").value.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
  const tasks = [];
  for (const line of lines) {
    let parts = line.split("|");
    let kw = parts[0].trim();
    let tgt = parts[1] ? parts[1].trim() : "";
    if (kw) {
      tasks.push({ keyword: kw, targetTitle: tgt });
    }
  }
  return tasks;
}

function updateCount() {
  const n = parseTasks().length;
  $("count").textContent = `${n} task${n === 1 ? "" : "s"}`;
}

function log(message) {
  const box = $("log");
  const empty = box.querySelector(".log-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "log-entry";
  const time = new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
  const t = document.createElement("time"); t.textContent = time;
  const b = document.createElement("b"); b.textContent = message;
  row.append(t, b); box.prepend(row);
}

function progress() {
  $("progressText").textContent = `${done} of ${total} completed`;
  $("bar").style.width = total ? `${Math.min(100, done / total * 100)}%` : "0%";
}

async function post(url, body) {
  const response = await fetch(url, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body || {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function setActive(value) {
  sessionActive = value;
  $("startBtn").disabled = value;
  $("nextBtn").disabled = !value;
  $("stopBtn").disabled = !value;
  $("status").textContent = value ? "Session active" : "Not running";
  $("status").className = "status " + (value ? "active" : "idle");
}

function stopTimer() { if (timer) clearTimeout(timer); timer = null; $("timerText").textContent = "Waiting"; }

function scheduleNext() {
  stopTimer();
  if (!sessionActive || !$("auto").checked) return;
  let seconds = Math.max(10, Math.min(60, Number($("dwell").value) || 20));
  let remaining = seconds;
  $("timerText").textContent = `Next task in ${remaining}s`;
  const tick = () => {
    remaining--;
    if (remaining <= 0) { $("timerText").textContent = "Loading next task..."; advance(); return; }
    $("timerText").textContent = `Next task in ${remaining}s`;
    timer = setTimeout(tick, 1000);
  };
  timer = setTimeout(tick, 1000);
}

async function advance() {
  if (!sessionActive || nextBusy) return;
  nextBusy = true; stopTimer();
  $("nextBtn").disabled = true;
  $("timerText").textContent = "Executing search & listing visit...";
  try {
    const data = await post("/api/next");
    if (data.done) {
      done = total; progress(); setActive(false);
      $("status").textContent = "Completed"; $("status").className = "status active";
      $("current").textContent = "All keyword and listing tasks completed!";
      $("timerText").textContent = "Finished";
      log("Completed all workflow tasks.");
      return;
    }
    done = data.index; progress();
    $("current").innerHTML = `<b>Keyword:</b> ${data.keyword}<br><b>Target:</b> ${data.targetTitle}<br><b>Opened:</b> <span style="color:#276749">${data.openedListing}</span>`;
    log(`Task ${data.index}/${data.total} [${data.keyword}] -> Opened: ${data.openedListing}`);
    scheduleNext();
  } catch (e) {
    log(e.message); $("timerText").textContent = "Error";
    setActive(false);
  } finally {
    nextBusy = false;
    if (sessionActive) $("nextBtn").disabled = false;
  }
}

$("taskInput").addEventListener("input", updateCount);

$("uploadBtn").addEventListener("click", async () => {
  const file = $("excelFile").files[0];
  if (!file) return alert("Choose an Excel file first.");
  const form = new FormData(); form.append("file", file);
  $("uploadBtn").disabled = true;
  try {
    const r = await fetch("/api/keywords", {method:"POST",body:form});
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    const lines = data.tasks.map(t => t.targetTitle ? `${t.keyword} | ${t.targetTitle}` : t.keyword);
    $("taskInput").value = lines.join("\n");
    updateCount();
    log(`Imported ${data.tasks.length} tasks from Excel.`);
  } catch(e) { alert(e.message || "Import failed."); }
  finally { $("uploadBtn").disabled = false; }
});

$("startBtn").addEventListener("click", async () => {
  const tasks = parseTasks();
  if (!tasks.length) return alert("Enter or import at least one keyword task.");
  $("startBtn").disabled = true;
  try {
    const data = await post("/api/start", { tasks });
    total = data.total; done = 0; progress(); $("log").innerHTML = "";
    setActive(true); $("current").textContent = "Browser opened. Executing first task...";
    log(data.message);
    await advance();
  } catch(e) { setActive(false); alert(e.message); $("startBtn").disabled = false; }
});

$("nextBtn").addEventListener("click", advance);

$("stopBtn").addEventListener("click", async () => {
  stopTimer();
  try { await post("/api/stop"); } catch (_) {}
  setActive(false); $("status").textContent = "Stopped"; $("status").className = "status stopped";
  $("current").textContent = "Session stopped."; log("Session stopped.");
});

$("auto").addEventListener("change", () => sessionActive && ($("auto").checked ? scheduleNext() : stopTimer()));

updateCount();
