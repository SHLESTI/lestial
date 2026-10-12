/* Supabase REST client. The admin session stays in memory, never in source/storage. */
(() => {
  "use strict";
  const config = window.LESTIAL_CONFIG || {};
  const base = (config.supabaseUrl || "").replace(/\/$/, "");
  const key = config.supabaseKey || "";
  let session = null;
  let refreshing = null;
  function validKey() {
    if (key.startsWith("sb_publishable_")) return true;
    try { return JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "anon"; }
    catch { return false; }
  }
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) && validKey();
  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  async function request(path, { method = "GET", body, token, headers = {} } = {}) {
    if (!configured) throw new ApiError("Сначала подключите хранилище магазина по инструкции НАСТРОЙКА.md.", 0);
    const h = { apikey: key, ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (body !== undefined && !(body instanceof Blob)) h["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(base + path, { method, headers: h,
        body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
        cache: "no-store", signal: AbortSignal.timeout(30000) });
    } catch { throw new ApiError("Нет ответа от сервера. Проверьте соединение. Если сохраняли товар, обновите список перед повторной попыткой.", 0); }
    if (!response.ok) {
      const messages = {
        400: "Проверьте введённые данные и настройки подключения.",
        401: "Войдите в аккаунт снова.", 403: "У этого аккаунта нет доступа к управлению магазином.",
        409: "Данные уже существуют. Обновите список товаров.",
        413: "Фотография слишком большая. Выберите файл до 5 МБ.",
        429: "Слишком много попыток. Подождите немного и повторите."
      };
      throw new ApiError(messages[response.status] || "Не удалось выполнить действие. Попробуйте ещё раз.", response.status);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  async function token() {
    if (!session) throw new ApiError("Войдите в аккаунт снова.", 401);
    if (session.expires_at <= Date.now() + 60000) {
      if (!refreshing) refreshing = request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST", body: { refresh_token: session.refresh_token }
      }).then(setSession).catch(error => { session = null; throw error; }).finally(() => { refreshing = null; });
      await refreshing;
    }
    return session.access_token;
  }
  function setSession(data) { session = { ...data, expires_at: Date.now() + data.expires_in * 1000 }; }
  async function signIn(email, password) {
    session = null;
    try { setSession(await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } })); }
    catch (error) {
      if (error.status === 400 || error.status === 401) throw new ApiError("Не удалось войти. Проверьте почту и пароль.", error.status);
      throw error;
    }
    try {
      const rows = await request(`/rest/v1/lestial_admins?user_id=eq.${encodeURIComponent(session.user.id)}&select=user_id`, { token: await token() });
      if (!rows.length) throw new ApiError("Этот аккаунт не назначен администратором магазина.", 403);
      return session.user.email;
    } catch (error) { await signOut().catch(() => {}); throw error; }
  }
  async function signOut() {
    const previous = session;
    session = null;
    if (previous) await request("/auth/v1/logout", { method: "POST", token: previous.access_token });
  }
  async function products() {
    // Page through PostgREST's row limit instead of silently truncating the catalog.
    const result = [];
    for (let offset = 0; ; offset += 500) {
      const page = await request(`/rest/v1/lestial_products?select=*&order=sort_order.asc,id.asc&limit=500&offset=${offset}`);
      result.push(...page);
      if (page.length < 500) return result;
    }
  }
  function imageUrl(product) {
    if (product.photo_path && /^[a-f0-9-]{36}\.webp$/.test(product.photo_path) && configured)
      return `${base}/storage/v1/object/public/lestial-products/${product.photo_path}`;
    return /^images\/[a-zA-Z0-9._-]+\.(jpe?g|png|webp)$/.test(product.image || "") ? product.image : "";
  }
  function validateProduct(p) {
    if (!p.title.trim() || p.title.length > 200) throw new Error("Введите название длиной до 200 символов.");
    if (p.brand.length > 100 || p.description.length > 5000) throw new Error("Бренд — до 100, описание — до 5000 символов.");
    if (!Number.isFinite(p.price) || p.price < 0 || p.price > 100000000 || Math.abs(p.price * 100 - Math.round(p.price * 100)) > 0.00001)
      throw new Error("Укажите цену от 0 до 100 000 000 ₸, не более двух знаков после запятой.");
    if (!imageUrl(p)) throw new Error("Добавьте фотографию товара.");
  }
  async function saveProduct(p, existing) {
    validateProduct(p);
    const result = await request(`/rest/v1/lestial_products${existing ? `?id=eq.${encodeURIComponent(p.id)}&updated_at=eq.${encodeURIComponent(existing.updated_at)}` : ""}`, {
      method: existing ? "PATCH" : "POST", token: await token(), body: p, headers: { Prefer: "return=representation" }
    });
    if (!result?.length) throw new ApiError("Товар уже изменён в другом окне или доступ отозван. Обновите список и откройте товар заново.", 409);
    return result[0];
  }
  async function uploadPhoto(blob) {
    if (blob.type !== "image/webp" || blob.size > 5 * 1024 * 1024) throw new Error("Фото должно быть в формате WebP и не больше 5 МБ.");
    const path = `${crypto.randomUUID()}.webp`;
    await request(`/storage/v1/object/lestial-products/${path}`, {
      method: "POST", token: await token(), body: blob, headers: { "Content-Type": "image/webp", "x-upsert": "false" }
    });
    return path;
  }
  window.LestialAPI = { configured, products, imageUrl, signIn, signOut, saveProduct, uploadPhoto, validateProduct };
})();
