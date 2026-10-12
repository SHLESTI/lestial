(() => {
  "use strict";
  const api = window.LestialAPI;
  const $ = id => document.getElementById(id);
  let products = [], editing = null, photoBlob = null, photoPath = null, previewUrl = null;
  let saving = false, dirty = false, photoVersion = 0, processingPhoto = false, draftId = null;
  const money = value => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + " ₸";
  function message(id, text, success = false) { $(id).textContent = text; $(id).classList.toggle("success", success); }
  function releasePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
  function render() {
    const query = $("search").value.trim().toLocaleLowerCase("ru");
    const visible = products.filter(p => `${p.title} ${p.brand}`.toLocaleLowerCase("ru").includes(query));
    $("count").textContent = products.length;
    $("productList").replaceChildren();
    $("empty").hidden = visible.length > 0;
    $("empty").textContent = products.length ? "По этому запросу товары не найдены." : "Добавьте первый товар в коллекцию.";
    for (const product of visible) {
      const card = document.createElement("button"); card.type = "button"; card.className = "admin-card";
      const img = document.createElement("img"); img.src = api.imageUrl(product); img.alt = product.title; img.loading = "lazy";
      const info = document.createElement("span"); info.className = "card-info";
      for (const [cls, text] of [["card-brand", product.brand || "LESTIAL"], ["card-title", product.title]]) {
        const element = document.createElement("span"); element.className = cls; element.textContent = text; info.append(element);
      }
      const bottom = document.createElement("span"); bottom.className = "card-bottom";
      const price = document.createElement("strong"); price.textContent = money(product.price);
      const edit = document.createElement("span"); edit.className = "edit-label"; edit.textContent = "Редактировать ↗";
      bottom.append(price, edit); info.append(bottom); card.append(img, info);
      card.addEventListener("click", () => openEditor(product)); $("productList").append(card);
    }
  }
  async function load() { products = await api.products(); render(); }
  $("showPassword").addEventListener("click", () => {
    const show = $("password").type === "password";
    $("password").type = show ? "text" : "password";
    $("showPassword").textContent = show ? "Скрыть" : "Показать";
    $("showPassword").setAttribute("aria-pressed", String(show));
  });
  if (!api.configured) { $("setupNotice").hidden = false; $("loginButton").disabled = true; }
  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault(); if (!api.configured) return;
    $("loginButton").disabled = true; message("loginMessage", "Входим…", true);
    try {
      const email = await api.signIn($("email").value.trim(), $("password").value);
      $("password").value = "";
      $("account").textContent = email;
      await load();
      $("loginPanel").hidden = true; $("dashboard").hidden = false;
      message("loginMessage", ""); $("addProduct").focus();
    } catch (error) { message("loginMessage", error.message); }
    finally { $("loginButton").disabled = false; }
  });
  $("logout").addEventListener("click", async () => {
    $("logout").disabled = true;
    try { await api.signOut(); message("loginMessage", "Вы вышли из аккаунта.", true); }
    catch { message("loginMessage", "Вы вышли на этом устройстве. Сервер не подтвердил завершение сессии."); }
    finally {
      products = []; render(); $("dashboard").hidden = true; $("loginPanel").hidden = false;
      $("logout").disabled = false; $("email").focus();
    }
  });
  $("search").addEventListener("input", render);
  $("refresh").addEventListener("click", async () => {
    $("refresh").disabled = true; message("status", "Обновляем список…", true);
    try { await load(); message("status", "Список обновлён.", true); }
    catch (error) { message("status", error.message); }
    finally { $("refresh").disabled = false; }
  });
  function openEditor(product = null) {
    editing = product; photoBlob = null; photoPath = null; dirty = false; photoVersion++; processingPhoto = false;
    draftId = product?.id || crypto.randomUUID();
    releasePreview(); $("productForm").reset();
    $("editorTitle").textContent = product ? "Редактировать товар" : "Новый товар";
    for (const key of ["title", "brand", "price", "description"]) $(key).value = product?.[key] ?? "";
    $("photoPreview").hidden = !product; $("photoPlaceholder").hidden = !!product;
    if (product) $("photoPreview").src = api.imageUrl(product); else $("photoPreview").removeAttribute("src");
    message("saveMessage", ""); message("photoMessage", "");
    $("editor").showModal(); $("title").focus();
  }
  function closeEditor() {
    if (saving) return;
    if (dirty && !confirm("Закрыть без сохранения изменений?")) return;
    photoVersion++; releasePreview(); $("editor").close(); dirty = false;
  }
  $("addProduct").addEventListener("click", () => openEditor());
  $("closeEditor").addEventListener("click", closeEditor);
  $("cancelEditor").addEventListener("click", closeEditor);
  $("editor").addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  $("productForm").addEventListener("input", () => { dirty = true; });
  window.addEventListener("beforeunload", event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ""; } });
  async function preparePhoto(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Выберите фотографию JPG, PNG или WebP.");
    if (file.size > 15 * 1024 * 1024) throw new Error("Выберите фотографию размером до 15 МБ.");
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { throw new Error("Не удалось открыть фотографию. Попробуйте другой файл."); }
    try {
      if (bitmap.width * bitmap.height > 60000000) throw new Error("Разрешение фото слишком большое. Уменьшите его до 60 мегапикселей.");
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .86));
      if (!blob || blob.type !== "image/webp" || blob.size > 5 * 1024 * 1024) throw new Error("Не удалось подготовить фото. Попробуйте фото меньшего размера или другой браузер.");
      return blob;
    } finally { bitmap.close(); }
  }
  $("photo").addEventListener("change", async () => {
    const file = $("photo").files[0]; if (!file) return;
    const version = ++photoVersion; processingPhoto = true;
    message("photoMessage", "Подготавливаем фото…", true);
    try {
      const blob = await preparePhoto(file);
      if (version !== photoVersion) return;
      releasePreview(); photoBlob = blob; photoPath = null; dirty = true;
      previewUrl = URL.createObjectURL(blob); $("photoPreview").src = previewUrl;
      $("photoPreview").hidden = false; $("photoPlaceholder").hidden = true;
      message("photoMessage", "Фото готово. Нажмите «Сохранить товар».", true);
    } catch (error) {
      if (version === photoVersion) { $("photo").value = ""; message("photoMessage", error.message + " Предыдущее фото сохранено."); }
    } finally { if (version === photoVersion) processingPhoto = false; }
  });
  $("productForm").addEventListener("submit", async event => {
    event.preventDefault(); if (saving) return;
    if (processingPhoto) { message("saveMessage", "Подождите, фото ещё обрабатывается."); return; }
    if (!editing && !photoBlob) { message("saveMessage", "Добавьте фотографию товара."); return; }
    saving = true; $("editorFields").disabled = true;
    for (const id of ["saveProduct", "cancelEditor", "closeEditor"]) $(id).disabled = true;
    message("saveMessage", "Сохраняем товар…", true);
    try {
      const data = {
        id: draftId, title: $("title").value.trim(), brand: $("brand").value.trim(),
        price: Number($("price").value), description: $("description").value.trim(),
        image: editing?.image || "", photo_path: photoPath || editing?.photo_path || null,
        sort_order: editing?.sort_order ?? Math.max(0, ...products.map(p => p.sort_order)) + 1
      };
      // Validate text before spending bandwidth; a temporary valid path represents the pending photo.
      api.validateProduct({ ...data, photo_path: photoBlob ? "00000000-0000-4000-8000-000000000000.webp" : data.photo_path });
      if (photoBlob && !photoPath) { message("saveMessage", "Загружаем фотографию…", true); photoPath = await api.uploadPhoto(photoBlob); }
      if (photoPath) data.photo_path = photoPath;
      const saved = await api.saveProduct(data, editing);
      const index = products.findIndex(p => p.id === saved.id);
      if (index === -1) products.push(saved); else products[index] = saved;
      if (!editing) $("search").value = "";
      dirty = false; releasePreview(); $("editor").close(); render();
      message("status", "Товар сохранён. Покупатели увидят изменения при открытии или обновлении каталога.", true);
    } catch (error) { message("saveMessage", error.message); }
    finally {
      saving = false; $("editorFields").disabled = false;
      for (const id of ["saveProduct", "cancelEditor", "closeEditor"]) $(id).disabled = false;
    }
  });
})();
