const cloudbase = globalThis.cloudbase;
if (!cloudbase) throw new Error("CloudBase SDK 未加载");

const CLOUDBASE_ENV_ID = "sonseducation-d5glzge0b6d2738d4";
const CLOUDBASE_REGION = "ap-shanghai";
const CLOUDBASE_PUBLISHABLE_KEY = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL3NvbnNlZHVjYXRpb24tZDVnbHpnZTBiNmQyNzM4ZDQuYXAtc2hhbmdoYWkudGNiLWFwaS50ZW5jZW50Y2xvdWRhcGkuY29tIiwic3ViIjoiYW5vbiIsImF1ZCI6InNvbnNlZHVjYXRpb24tZDVnbHpnZTBiNmQyNzM4ZDQiLCJleHAiOjQwODk0NDAxNDcsImlhdCI6MTc4NTc1Njk0Nywibm9uY2UiOiI5R3oyeGFESFJUSzBmSkxkUXExNF9nIiwiYXRfaGFzaCI6IjlHejJ4YURIUlRLMGZKTGRRcTE0X2ciLCJuYW1lIjoiQW5vbnltb3VzIiwic2NvcGUiOiJhbm9ueW1vdXMiLCJwcm9qZWN0X2lkIjoic29uc2VkdWNhdGlvbi1kNWdsemdlMGI2ZDI3MzhkNCIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.A9VuDHB_a4AI7acLU9Ksuscox8J53XVk97HkrALtiZMwbwNWDI22r3Fa-vFlbqNhbzc7cDfyKR-qorjztslgEmvYgvLIYCirqK5zdPMTB3gEb_fgbmJN8AxXyUeIfK7yuMpcX5jT0KLn3EY95m-bUpPnBOkt-HFXR223SsG4G3cmkFpn9iYHrKRWOjKm9HbnMOdl_2A-0GbrbWTZxQOfsLILQdFr0XWEhHx6o0odvSnrmfT5zgOtiVNNbTp8bPXGLlGyHLsnW7Vnit0FQLZ86RUin6O2FQJS7J6HMjfknzUog41fMYRFtcQvtMxR9S5vKejm0ERqicFuI7qxld1tVg";
const COLLECTION_NAME = "nce1_student_progress";
const SYNC_DELAY_MS = 900;
const RETRY_DELAY_MS = 12000;

function isObject(value) { return value && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function mergeValue(localValue, cloudValue, preferLocal) {
  if (localValue === undefined || localValue === null || localValue === "") return cloudValue;
  if (cloudValue === undefined || cloudValue === null || cloudValue === "") return localValue;
  if (Array.isArray(localValue) && Array.isArray(cloudValue)) {
    const seen = new Set();
    return [...cloudValue, ...localValue].filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  if (isObject(localValue) && isObject(cloudValue)) {
    const result = {};
    const keys = new Set([...Object.keys(localValue), ...Object.keys(cloudValue)]);
    keys.forEach((key) => { result[key] = mergeValue(localValue[key], cloudValue[key], preferLocal); });
    return result;
  }
  return preferLocal ? localValue : cloudValue;
}
function mergeStates(localState = {}, cloudState = {}, cloudUpdatedAt = 0) {
  const localUpdatedAt = Number(localState.updatedAt) || 0;
  const remoteUpdatedAt = Number(cloudState.updatedAt || cloudUpdatedAt) || 0;
  const merged = mergeValue(localState, cloudState, localUpdatedAt >= remoteUpdatedAt);
  merged.updatedAt = Math.max(Date.now(), localUpdatedAt, remoteUpdatedAt);
  return merged;
}
function extractUser(response) { return response?.data?.user || response?.user || response?.data || null; }
function extractSession(response) { return response?.data?.session || response?.session || response?.data || null; }
function isNamedUser(user, session) {
  if (!user || !session || user.is_anonymous || user.isAnonymous) return false;
  return String(session.loginType || session.login_type || "").toUpperCase() !== "ANONYMOUS";
}
function userIdOf(user) { return user?.id || user?.uid || user?._id || ""; }
function usernameOf(user, key) { return user?.username || user?.user_metadata?.username || user?.metadata?.username || localStorage.getItem(key) || "学生"; }
function displayNameOf(user, username) { return user?.name || user?.nickname || user?.nickName || user?.user_metadata?.name || user?.user_metadata?.nickname || username || "学生"; }

function ensureCloudUi() {
  if (document.getElementById("cloudSyncGate")) return document.getElementById("cloudSyncGate");
  const style = document.createElement("style");
  style.textContent = `
    body.cloud-auth-locked > *:not(#cloudSyncGate) { visibility: hidden !important; }
    #cloudSyncGate { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; background: linear-gradient(145deg,#527ff2,#7768ea); color: #fff; font-family: -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; }
    #cloudSyncGate .cloud-card { width: min(100%, 420px); padding: 24px; border: 1px solid rgba(255,255,255,.28); border-radius: 18px; background: rgba(255,255,255,.14); box-shadow: 0 18px 48px rgba(35,45,100,.25); backdrop-filter: blur(10px); }
    #cloudSyncGate h2 { margin: 0 0 8px; font-size: 20px; }
    #cloudSyncGate p { margin: 0 0 16px; font-size: 13px; opacity: .92; }
    #cloudSyncGate .cloud-status { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; font-size: 13px; }
    #cloudSyncGate .cloud-dot { width: 9px; height: 9px; border-radius: 50%; background: #ffd86b; box-shadow: 0 0 0 3px rgba(255,216,107,.18); }
    #cloudSyncGate .cloud-dot.online { background: #77e39d; box-shadow: 0 0 0 3px rgba(119,227,157,.2); }
    #cloudSyncGate .cloud-dot.error { background: #ff9a97; box-shadow: 0 0 0 3px rgba(255,154,151,.2); }
    #cloudSyncGate form { display: grid; gap: 9px; }
    #cloudSyncGate input { width: 100%; border: 1px solid rgba(255,255,255,.5); border-radius: 9px; padding: 10px 11px; background: rgba(255,255,255,.96); color: #263249; font: inherit; outline: none; }
    #cloudSyncGate input:focus { border-color: #ffd86b; box-shadow: 0 0 0 2px rgba(255,216,107,.2); }
    #cloudSyncGate button { border: 1px solid rgba(255,255,255,.6); border-radius: 9px; padding: 9px 12px; background: rgba(255,255,255,.16); color: #fff; cursor: pointer; font: inherit; font-weight: 700; }
    #cloudSyncGate button.primary { border-color: #fff; background: #fff; color: #3a63d0; }
    #cloudSyncGate .cloud-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    #cloudSyncGate .cloud-message { min-height: 18px; font-size: 12px; }
    #cloudSyncGate.signed-in { inset: 14px 14px auto auto; width: auto; padding: 0; background: transparent; align-items: stretch; justify-content: flex-end; pointer-events: none; }
    #cloudSyncGate.signed-in .cloud-card { width: auto; min-width: 230px; padding: 10px 12px; border-radius: 10px; background: rgba(42,51,72,.92); box-shadow: 0 6px 20px rgba(42,51,72,.25); pointer-events: auto; }
    #cloudSyncGate.signed-in h2, #cloudSyncGate.signed-in p, #cloudSyncGate.signed-in form { display: none; }
    #cloudSyncGate.signed-in .cloud-status { margin: 0 0 8px; }
    @media (max-width: 520px) { #cloudSyncGate.signed-in { inset: auto 10px 10px 10px; } #cloudSyncGate.signed-in .cloud-card { min-width: 0; width: 100%; } }
  `;
  document.head.appendChild(style);
  const gate = document.createElement("div");
  gate.id = "cloudSyncGate";
  gate.innerHTML = `<div class="cloud-card"><h2>☁️ NCE1 学习记录</h2><p>请使用专属学生账号登录；学习进度和收藏会同步到 CloudBase。</p><div class="cloud-status" role="status" aria-live="polite"><i class="cloud-dot" id="cloudSyncDot"></i><span id="cloudSyncStatus">正在准备云端同步…</span></div><form id="cloudLoginForm"><input id="cloudUsername" type="text" placeholder="学生账号" autocomplete="username" minlength="5" maxlength="24" required><input id="cloudPassword" type="password" placeholder="密码" autocomplete="current-password" minlength="8" maxlength="32" required><div class="cloud-actions"><button class="primary" type="submit">登录并同步</button><button id="cloudLoginCancel" type="button" hidden>取消</button></div><div class="cloud-message" id="cloudAuthMessage" role="status" aria-live="polite"></div></form><div class="cloud-actions"><button id="cloudSyncNow" type="button" hidden>立即同步</button><button id="cloudLogout" type="button" hidden>退出账号</button></div></div>`;
  document.body.appendChild(gate);
  document.body.classList.add("cloud-auth-locked");
  return gate;
}

export async function createCloudSync({ appId, storageKey, getState, applyState, getSummary, onAuthenticated, onSignedOut }) {
  const gate = ensureCloudUi();
  const elements = { dot: gate.querySelector("#cloudSyncDot"), status: gate.querySelector("#cloudSyncStatus"), syncNow: gate.querySelector("#cloudSyncNow"), logout: gate.querySelector("#cloudLogout"), form: gate.querySelector("#cloudLoginForm"), username: gate.querySelector("#cloudUsername"), password: gate.querySelector("#cloudPassword"), cancel: gate.querySelector("#cloudLoginCancel"), message: gate.querySelector("#cloudAuthMessage") };
  const app = cloudbase.init({ env: CLOUDBASE_ENV_ID, region: CLOUDBASE_REGION, accessKey: CLOUDBASE_PUBLISHABLE_KEY });
  const auth = typeof app.auth === "function" ? app.auth() : app.auth;
  const collection = app.database().collection(COLLECTION_NAME);
  let currentUser = null; let currentUsername = ""; let currentDisplayName = ""; let documentId = ""; let syncTimer = null; let retryTimer = null; let syncing = false;
  const setStatus = (text, tone = "idle") => { elements.status.textContent = text; elements.dot.classList.toggle("online", tone === "online"); elements.dot.classList.toggle("error", tone === "error"); };
  const setMessage = (text) => { elements.message.textContent = text; };
  const updateUi = () => { const signedIn = Boolean(currentUser); document.body.classList.toggle("cloud-auth-locked", !signedIn); gate.classList.toggle("signed-in", signedIn); elements.form.hidden = signedIn; elements.syncNow.hidden = !signedIn; elements.logout.hidden = !signedIn; elements.password.value = ""; setMessage(signedIn ? "" : "账号由老师创建；密码不会保存到网页中。"); setStatus(signedIn ? currentDisplayName + " · 云端记录已连接" : "登录后进入课程", signedIn ? "online" : "idle"); };
  const cloudRecord = (state) => ({ appId, studentName: currentDisplayName, loginName: currentUsername, userId: userIdOf(currentUser), state: clone(state), summary: getSummary(), schemaVersion: 1, updatedAt: new Date().toISOString() });
  async function findRecord() { const userId = userIdOf(currentUser); const query = userId ? { appId, userId } : { appId, loginName: currentUsername }; const result = await collection.where(query).limit(1).get(); if (result?.code) throw new Error(result.message || result.code); return result?.data?.[0] || null; }
  async function writeState(state) { const payload = cloudRecord(state); const result = documentId ? await collection.doc(documentId).update(payload) : await collection.add(payload); if (result?.code) throw new Error(result.message || result.code); if (!documentId) documentId = result?.id || result?._id || ""; }
  async function loadAndMerge() { setStatus(currentDisplayName + " · 正在合并学习记录…"); const record = await findRecord(); documentId = record?._id || ""; const merged = mergeStates(getState(), record?.state || {}, record?.updatedAt); applyState(merged); await writeState(merged); setStatus(currentDisplayName + " · 已同步", "online"); }
  function scheduleRetry() { clearTimeout(retryTimer); retryTimer = setTimeout(() => syncNow(), RETRY_DELAY_MS); }
  async function syncNow() { if (!currentUser || syncing) return; clearTimeout(syncTimer); clearTimeout(retryTimer); syncing = true; setStatus(currentDisplayName + " · 正在同步…"); try { await writeState(getState()); setStatus(currentDisplayName + " · 已同步", "online"); } catch (error) { setStatus("本机已保存 · 云同步待重试", "error"); scheduleRetry(); console.error("CloudBase 同步失败", error); } finally { syncing = false; } }
  const queueSync = () => { if (!currentUser) return; setStatus(currentDisplayName + " · 待同步"); clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), SYNC_DELAY_MS); };
  async function login(username, password) { setMessage("正在登录并读取云端记录…"); setStatus("正在连接 CloudBase…"); const response = await auth.signInWithPassword({ username, password }); if (response?.error) throw response.error; const user = extractUser(response); const session = extractSession(response); if (!isNamedUser(user, session)) throw new Error("未获得有效的学生登录状态"); currentUser = user; currentUsername = username; currentDisplayName = displayNameOf(user, username); localStorage.setItem(storageKey + "-last-username", username); onAuthenticated?.({ userId: userIdOf(user), username }); await loadAndMerge(); updateUi(); }
  async function restoreSession() { try { const sessionResponse = await auth.getSession(); if (sessionResponse?.error) return; const session = extractSession(sessionResponse); if (!session) return; const userResponse = await auth.getUser(); if (userResponse?.error) return; const user = extractUser(userResponse); if (!isNamedUser(user, session)) return; currentUser = user; currentUsername = usernameOf(user, storageKey + "-last-username"); currentDisplayName = displayNameOf(user, currentUsername); onAuthenticated?.({ userId: userIdOf(user), username: currentUsername }); await loadAndMerge(); updateUi(); } catch (error) { setStatus("本机保存 · 云端会话恢复失败", "error"); console.error("CloudBase 会话恢复失败", error); } }
  elements.form.addEventListener("submit", async (event) => { event.preventDefault(); const username = elements.username.value.trim(); const password = elements.password.value; if (!username || !password) return; const submit = elements.form.querySelector('button[type="submit"]'); submit.disabled = true; try { await login(username, password); } catch (error) { setMessage(error?.message || "登录失败，请检查账号和密码。"); setStatus("登录失败 · 请重试", "error"); } finally { submit.disabled = false; } });
  elements.cancel.addEventListener("click", () => { elements.form.hidden = true; elements.password.value = ""; setMessage(""); });
  elements.logout.addEventListener("click", async () => { try { await syncNow(); const response = await auth.signOut(); if (response?.error) throw response.error; } catch (error) { console.error("退出 CloudBase 失败", error); } currentUser = null; currentUsername = ""; currentDisplayName = ""; documentId = ""; onSignedOut?.(); updateUi(); });
  elements.syncNow.addEventListener("click", () => syncNow()); window.addEventListener("online", () => syncNow()); window.addEventListener("beforeunload", () => { if (currentUser) syncNow(); }); updateUi(); await restoreSession(); return { queueSync, syncNow };
}
