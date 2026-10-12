(() => {
  "use strict";
  const api = window.LestialAPI;
  const grid = document.querySelector(".product-grid");
  const modal = document.getElementById("productModal");
  let previousFocus;
  const money = value => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + " ₸";
  function close() {
    modal.style.display = "none";
    document.body.style.overflow = "";
    previousFocus?.focus();
  }
  function open(product, card) {
    previousFocus = card;
    document.getElementById("modalImage").src = api.imageUrl(product);
    document.getElementById("modalImage").alt = product.title;
    document.getElementById("modalBrand").textContent = product.brand;
    document.getElementById("modalTitle").textContent = product.title;
    document.getElementById("modalPrice").textContent = money(product.price);
    document.getElementById("modalDescription").textContent = product.description || "";
    const message = `Здравствуйте! Хочу заказать: ${product.title} — ${money(product.price)}`;
    document.getElementById("modalOrder").href = `https://wa.me/77756990198?text=${encodeURIComponent(message)}`;
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";
    document.getElementById("modalClose").focus();
  }
  function bind(card, product) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${product.title}, ${money(product.price)}. Подробнее`);
    card.addEventListener("click", () => open(product, card));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(product, card); }
    });
  }
  // Existing HTML remains available on GitHub Pages, even before backend setup.
  grid.querySelectorAll(".product-card").forEach(card => bind(card, {
    title: card.querySelector("h3").textContent,
    brand: card.querySelector(".product-brand").textContent,
    price: Number(card.querySelector(".product-price").textContent.replace(/[^\d.]/g, "")),
    image: card.querySelector("img").getAttribute("src"), description: ""
  }));
  function render(products) {
    const fragment = document.createDocumentFragment();
    for (const p of products) {
      const card = document.createElement("article");
      card.className = "product-card";
      const photo = document.createElement("div"); photo.className = "product-image";
      const img = document.createElement("img"); img.src = api.imageUrl(p); img.alt = p.title; img.loading = "lazy";
      photo.append(img);
      const info = document.createElement("div"); info.className = "product-info";
      for (const [tag, cls, text] of [["p", "product-brand", p.brand], ["h3", "", p.title], ["p", "product-price", money(p.price)]]) {
        const el = document.createElement(tag); el.className = cls; el.textContent = text; info.append(el);
      }
      card.append(photo, info); bind(card, p); fragment.append(card);
    }
    grid.replaceChildren(fragment);
    if (!products.length) grid.textContent = "Скоро здесь появятся товары.";
  }
  document.getElementById("modalClose").addEventListener("click", close);
  modal.addEventListener("click", event => { if (event.target === modal) close(); });
  modal.addEventListener("keydown", event => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const first = document.getElementById("modalClose"), last = document.getElementById("modalOrder");
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  if (api.configured) api.products().then(render).catch(() => {
    const notice = document.getElementById("catalogNotice");
    notice.hidden = false;
    notice.textContent = "Не удалось обновить каталог. Цены и наличие уточняйте в WhatsApp.";
  });
})();
