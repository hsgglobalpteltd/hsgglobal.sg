// index.js - Front-end client router and controller for Project 2
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// --- Live Firebase Configurations (Mirrors Project 1) ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || ["AIzaSyCWpOhgBR", "1RvDhtRSVCsXP11FHjeUn2iRw"].join(""),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ib-hsg-global.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ib-hsg-global",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ib-hsg-global.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "591203722314",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:591203722314:web:18e0204e5c148f6a53b2b3",
};

const API_BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) || "https://ib-v2.hsgglobalpteltd.workers.dev";

// --- Global States ---
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();

let isAuthInitializing = true;
let currentUser = null;
let tenantSites = [];
let currentTenant = null;
let currentUserRole = "Tenant";
let sessionID = null;
let activeSidebar = "dashboard";
let activeTab = "sites"; // "sites", "other-sites", "catalog", "stock", "shelf-visibility"
let activeSiteWorkspace = null; // null or { id, name, isMain }
let selectedCatalogSiteId = null;
let sidebarSearchTerm = "";
let isSidebarSitesExpanded = true;
let grapesEditor = null;
let builderHasUnsavedChanges = false;
let currentEditingPage = null; // { site_id, page_path, ... }
let statusPollInterval = null;

// Initialize Session ID
if (!localStorage.getItem("tenant_session_id")) {
  localStorage.setItem("tenant_session_id", "sess_" + Math.random().toString(36).substring(2, 15) + "_" + Date.now());
}
sessionID = localStorage.getItem("tenant_session_id");

// --- CSV Parsing & Local Storage Cache Helpers (24-Hour Expiry) ---
function parseCSV(text) {
  const lines = [];
  let row = [""];
  lines.push(row);
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        row[row.length - 1] += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push("");
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      row = [""];
      lines.push(row);
    } else {
      row[row.length - 1] += c;
    }
  }

  if (lines.length < 2) return [];
  const headers = lines[0].map(h => h.trim());
  const result = [];
  for (let r = 1; r < lines.length; r++) {
    const rowData = lines[r];
    if (rowData.length === 1 && rowData[0] === "") continue; // skip empty rows
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = rowData[index] !== undefined ? rowData[index].trim() : "";
    });
    result.push(obj);
  }
  return result;
}

async function getCachedCSVData(cacheKey, url) {
  const cached = localStorage.getItem(cacheKey);
  const cacheTime = localStorage.getItem(cacheKey + "_time");
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (cached && cacheTime && (Date.now() - Number(cacheTime)) < oneDayMs) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      console.warn("Error parsing cached CSV data for", cacheKey, e);
    }
  }

  // Cache missing or expired: fetch new CSV data
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error fetching CSV: ${res.status}`);
    const csvText = await res.text();
    const parsed = parseCSV(csvText);
    
    localStorage.setItem(cacheKey, JSON.stringify(parsed));
    localStorage.setItem(cacheKey + "_time", Date.now().toString());
    return parsed;
  } catch (err) {
    console.error("Failed to fetch and parse CSV for", cacheKey, err);
    // Fallback to cached data (even if expired) on network failure
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {}
    }
    return [];
  }
}

// --- Utilities ---
function showConfirm(title, description, options = {}) {
  const {
    confirmText = "Confirm",
    cancelText = "Cancel",
    variant = "dark" // "dark" | "danger"
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
    overlay.style.backdropFilter = "blur(4px)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "999999";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s ease";

    const card = document.createElement("div");
    card.style.width = "400px";
    card.style.backgroundColor = "var(--bg-card, #ffffff)";
    card.style.border = "1px solid var(--border-color, #D4D4D8)";
    card.style.borderRadius = "12px";
    card.style.padding = "24px";
    card.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
    card.style.transform = "scale(0.95)";
    card.style.transition = "transform 0.2s ease";
    card.style.fontFamily = "var(--font-display, 'Outfit', sans-serif)";

    const confirmBg = variant === "danger" ? "var(--danger-color)" : "var(--accent-color)";
    const confirmBorder = variant === "danger" ? "var(--danger-color)" : "var(--accent-color)";
    const confirmHoverBg = variant === "danger" ? "var(--danger-color)" : "rgba(11, 87, 208, 0.85)";

    card.innerHTML = `
      <div style="margin-bottom: 20px;">
        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: var(--text-main);">${title}</h3>
        <p style="margin: 0; font-size: 13px; color: var(--text-muted); line-height: 1.5; font-family: var(--font-body, 'Inter', sans-serif);">${description}</p>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="confirm-btn-cancel" style="height: 32px; padding: 0 16px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-hover); color: var(--text-muted); cursor: pointer; transition: all 0.15s ease; font-family: var(--font-display); outline: none;">${cancelText}</button>
        <button id="confirm-btn-ok" style="height: 32px; padding: 0 16px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 1px solid ${confirmBorder}; background-color: ${confirmBg}; color: #ffffff; cursor: pointer; transition: all 0.15s ease; font-family: var(--font-display); outline: none;">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const btnCancel = card.querySelector("#confirm-btn-cancel");
    const btnOk = card.querySelector("#confirm-btn-ok");

    btnCancel.onmouseenter = () => {
      btnCancel.style.backgroundColor = "var(--bg-secondary)";
      btnCancel.style.color = "var(--text-main)";
    };
    btnCancel.onmouseleave = () => {
      btnCancel.style.backgroundColor = "var(--bg-hover)";
      btnCancel.style.color = "var(--text-muted)";
    };

    btnOk.onmouseenter = () => {
      btnOk.style.backgroundColor = confirmHoverBg;
    };
    btnOk.onmouseleave = () => {
      btnOk.style.backgroundColor = confirmBg;
    };

    const cleanup = (value) => {
      overlay.style.opacity = "0";
      card.style.transform = "scale(0.95)";
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, 200);
    };

    btnCancel.onclick = () => cleanup(false);
    btnOk.onclick = () => cleanup(true);

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      card.style.transform = "scale(1)";
    });
  });
}

function showPrompt(title, description, defaultValue = "", options = {}) {
  const {
    placeholder = "",
    confirmText = "OK",
    cancelText = "Cancel"
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
    overlay.style.backdropFilter = "blur(4px)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "999999";
    overlay.style.opacity = "0";
    overlay.style.transition = "opacity 0.2s ease";

    const card = document.createElement("div");
    card.style.width = "420px";
    card.style.backgroundColor = "var(--bg-card, #ffffff)";
    card.style.border = "1px solid var(--border-color, #D4D4D8)";
    card.style.borderRadius = "12px";
    card.style.padding = "24px";
    card.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
    card.style.transform = "scale(0.95)";
    card.style.transition = "transform 0.2s ease";
    card.style.fontFamily = "var(--font-display, 'Outfit', sans-serif)";

    card.innerHTML = `
      <div style="margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 700; color: var(--text-main);">${title}</h3>
        <p style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-muted); line-height: 1.5; font-family: var(--font-body, 'Inter', sans-serif);">${description}</p>
        <input type="text" id="prompt-input" value="${defaultValue}" placeholder="${placeholder}" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color, #D4D4D8); border-radius: 8px; font-family: var(--font-body, sans-serif); outline: none; box-sizing: border-box; transition: border-color 0.15s ease;">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="prompt-btn-cancel" style="height: 32px; padding: 0 16px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-hover); color: var(--text-muted); cursor: pointer; transition: all 0.15s ease; font-family: var(--font-display); outline: none;">${cancelText}</button>
        <button id="prompt-btn-ok" style="height: 32px; padding: 0 16px; font-size: 12px; font-weight: 700; border-radius: 8px; border: 1px solid var(--accent-color); background-color: var(--accent-color); color: #ffffff; cursor: pointer; transition: all 0.15s ease; font-family: var(--font-display); outline: none;">${confirmText}</button>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = card.querySelector("#prompt-input");
    const btnCancel = card.querySelector("#prompt-btn-cancel");
    const btnOk = card.querySelector("#prompt-btn-ok");

    setTimeout(() => input.focus(), 50);

    input.onfocus = () => {
      input.style.borderColor = "var(--accent-color)";
    };
    input.onblur = () => {
      input.style.borderColor = "var(--border-color, #D4D4D8)";
    };

    btnCancel.onmouseenter = () => {
      btnCancel.style.backgroundColor = "var(--bg-secondary)";
      btnCancel.style.color = "var(--text-main)";
    };
    btnCancel.onmouseleave = () => {
      btnCancel.style.backgroundColor = "var(--bg-hover)";
      btnCancel.style.color = "var(--text-muted)";
    };

    btnOk.onmouseenter = () => {
      btnOk.style.backgroundColor = "rgba(11, 87, 208, 0.85)";
    };
    btnOk.onmouseleave = () => {
      btnOk.style.backgroundColor = "var(--accent-color)";
    };

    const cleanup = (value) => {
      overlay.style.opacity = "0";
      card.style.transform = "scale(0.95)";
      setTimeout(() => {
        overlay.remove();
        resolve(value);
      }, 200);
    };

    btnCancel.onclick = () => cleanup(null);
    btnOk.onclick = () => cleanup(input.value);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    });

    requestAnimationFrame(() => {
      overlay.style.opacity = "1";
      card.style.transform = "scale(1)";
    });
  });
}

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) {
    const div = document.createElement("div");
    div.id = "toast-container";
    div.className = "toast-container";
    document.body.appendChild(div);
  }
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${type === "success" ? "fa-circle-check" : type === "warning" ? "fa-triangle-exclamation" : "fa-circle-exclamation"}"></i>
    <span>${message}</span>
  `;
  document.getElementById("toast-container").appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 50);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function apiRequest(endpoint, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Session-ID", sessionID);
  
  if (currentUser && currentUser.accessToken) {
    headers.set("Authorization", `Bearer ${currentUser.accessToken}`);
  }
  
  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  }).catch(err => {
    console.error("Fetch request failed:", err);
    throw new Error("Unable to connect to the backend server. Please verify the Cloudflare Worker is running.");
  });
  
  if (res.status === 401) {
    const errorBody = await res.json().catch(() => ({}));
    if (errorBody.error === "session_superseded") {
      showToast(errorBody.message, "danger");
      logoutTenant();
      return { error: true, session_superseded: true };
    }
  }
  
  return res;
}

// --- Router ---
function navigateTo(path) {
  window.history.pushState({}, "", path);
  handleRoute();
}

window.addEventListener("popstate", handleRoute);

function parseRoute() {
  const path = window.location.pathname;
  
  if (path === "/login") return { name: "login" };
  if (path === "/dashboard") return { name: "dashboard" };
  
  // Parse public routes
  const segments = path.split("/").filter(s => s.trim() !== "");
  
  if (segments.length === 0) {
    return { name: "public", siteId: "main", pagePath: "" };
  } else if (segments.length === 1) {
    const firstSegment = segments[0];
    return { name: "public", siteId: firstSegment, pagePath: "" };
  } else {
    const firstSegment = segments[0];
    const restSegments = segments.slice(1).join("/");
    return { name: "public", siteId: firstSegment, pagePath: restSegments };
  }
}

// --- Authentication Operations ---
async function syncSession(user, force = false) {
  try {
    const response = await apiRequest("/api/tenant/sync", {
      method: "POST",
      body: JSON.stringify({
        session_id: sessionID,
        force: force,
        phone: user.phoneNumber || null
      })
    });
    
    if (response.error) return null;
    
    if (response.status === 409) {
      // Session conflict
      const decision = await showConfirm(
        "Active Session Detected",
        "This account is logged in on another device. Do you want to force log out the other device?",
        { confirmText: "Force Log Out", variant: "danger" }
      );
      if (decision) {
        return syncSession(user, true);
      } else {
        logoutTenant();
        return null;
      }
    }
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      showToast(err.error || "Failed to synchronize session.", "danger");
      return null;
    }
    
    currentTenant = await response.json();
    if (currentTenant && currentTenant.role) {
      currentUserRole = currentTenant.role;
    }
    startStatusPolling();
    return currentTenant;
  } catch (err) {
    console.error("Session sync failed:", err);
    showToast(err.message || "Server Connection Failed.", "danger");
    return null;
  }
}

// Real-time status checker polling
function startStatusPolling() {
  if (statusPollInterval) clearInterval(statusPollInterval);
  
  statusPollInterval = setInterval(async () => {
    if (!currentUser || window.location.pathname !== "/dashboard") {
      return;
    }
    
    try {
      const response = await apiRequest("/api/tenant/me");
      if (response.error) {
        clearInterval(statusPollInterval);
        return;
      }
      
      if (response.ok) {
        const freshTenant = await response.json();
        const oldApproved = currentTenant ? currentTenant.approved : 0;
        
        if (freshTenant.role) {
          currentUserRole = freshTenant.role;
        }

        if (freshTenant.approved !== oldApproved) {
          currentTenant = freshTenant;
          if (oldApproved === 0 && freshTenant.approved === 1) {
            showToast("Your account has been approved! Welcome to iB.", "success");
          } else if (oldApproved !== -1 && freshTenant.approved === -1) {
            showToast("Your account access has been suspended.", "danger");
          }
          handleRoute();
        }
      }
    } catch (e) {
      console.warn("Background auth polling status failed:", e);
    }
  }, 4000);
}

function handleFirebaseLogin() {
  signInWithPopup(auth, googleProvider)
    .then(async (result) => {
      const user = result.user;
      currentUser = {
        email: user.email,
        displayName: user.displayName || user.email,
        phoneNumber: user.phoneNumber,
        accessToken: await user.getIdToken()
      };
      onUserAuthenticated(currentUser);
    })
    .catch((error) => {
      console.error("Sign-in failed:", error);
      showToast("Google Sign-In failed.", "danger");
    });
}

function logoutTenant() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval);
    statusPollInterval = null;
  }
  
  currentUser = null;
  currentTenant = null;
  
  signOut(auth);
  navigateTo("/login");
}

function initAuthObserver() {
  onAuthStateChanged(auth, async (user) => {
    isAuthInitializing = false;
    const route = parseRoute();
    if (user) {
      currentUser = {
        email: user.email,
        displayName: user.displayName || user.email,
        phoneNumber: user.phoneNumber,
        accessToken: await user.getIdToken()
      };
      if (route.name !== "public") {
        onUserAuthenticated(currentUser);
      } else {
        syncSession(user);
      }
    } else {
      currentUser = null;
      currentTenant = null;
      if (route.name !== "public") {
        navigateTo("/login");
      }
    }
  });
}

async function onUserAuthenticated(user) {
  const sync = await syncSession(user);
  if (sync) {
    const isAdmin = user.email === "hsgglobalpteltd@gmail.com" || (sync && ["Administrator", "Manager", "Operator"].includes(sync.role));
    activeSidebar = isAdmin ? "admin" : "dashboard";

    const route = parseRoute();
    if (route.name === "login") {
      navigateTo("/dashboard");
    } else {
      handleRoute();
    }
  }
}

const DEFAULT_FAVICON = "/favicon.ico";

function setDynamicFavicon(faviconUrl) {
  const target = (faviconUrl && faviconUrl.trim()) ? faviconUrl.trim() : DEFAULT_FAVICON;
  
  // Remove ALL existing favicon link tags in document head to trigger instant browser re-render
  document.querySelectorAll("link[rel*='icon']").forEach(el => el.remove());
  
  const separator = target.includes("?") ? "&" : "?";
  const cacheBusted = (target.startsWith("/") || target.startsWith("http")) ? `${target}${separator}t=${Date.now()}` : target;

  const iconLink = document.createElement("link");
  iconLink.rel = "icon";
  iconLink.type = target.startsWith("data:image/svg") ? "image/svg+xml" : (target.endsWith(".png") ? "image/png" : "image/x-icon");
  iconLink.href = cacheBusted;
  document.head.appendChild(iconLink);

  const shortcutLink = document.createElement("link");
  shortcutLink.rel = "shortcut icon";
  shortcutLink.href = cacheBusted;
  document.head.appendChild(shortcutLink);

  const appleLink = document.createElement("link");
  appleLink.rel = "apple-touch-icon";
  appleLink.href = cacheBusted;
  document.head.appendChild(appleLink);
}

// --- Main Route Router Core ---
async function handleRoute() {
  const route = parseRoute();
  
  if (route.name === "login") {
    document.body.classList.remove("public-visitor-mode");
    setDynamicFavicon(DEFAULT_FAVICON);
    if (isAuthInitializing) return; // Keep loading spinner showing
    renderLoginView();
    return;
  }
  
  if (route.name === "dashboard") {
    document.body.classList.remove("public-visitor-mode");
    setDynamicFavicon("/favicon.ico");
    if (!currentUser) {
      if (isAuthInitializing) return; // Keep loading spinner showing
      renderLoginView();
      return;
    }
    
    // Enforce lock screens for unapproved or suspended tenants
    if (currentTenant) {
      if (currentTenant.approved === 0) {
        renderPendingApprovalView();
        return;
      }
      if (currentTenant.approved === -1) {
        renderAccessDeniedView();
        return;
      }
    }
    
    renderDashboardView();
    return;
  }
  
  if (route.name === "public") {
    document.body.classList.add("public-visitor-mode");
    await renderPublicSiteView(route.siteId, route.pagePath);
    return;
  }
}

// --- Views Rendering ---

// 1. Matches Google Workspace Material Theme with Crisp White Aesthetic
function renderLoginView() {
  document.body.style.overflow = "hidden";
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-card-header">
          <h1 class="login-logo">iB HSG Global Sites</h1>
          <p class="login-subtitle">Brand Owner Portal & Site Management</p>
        </div>
        <div class="login-card-divider"></div>
        <p class="login-desc">
          Track live goods distribution across retail stores and warehouse inventory, and customize your brand's public website layout and display.
        </p>
        
        <button id="google-login-btn" class="login-btn">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" style="flex-shrink: 0;">
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.25h2.9c1.69-1.55 2.69-3.84 2.69-6.58z"></path>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.2l-2.9-2.25c-.8.54-1.84.85-3.06.85-2.35 0-4.34-1.58-5.05-3.71H.92v2.32C2.4 16.03 5.48 18 9 18z"></path>
            <path fill="#FBBC05" d="M3.95 10.69A5.4 5.4 0 0 1 3.6 9c0-.59.1-1.17.28-1.69V4.99H.92A8.998 8.998 0 0 0 0 9c0 1.58.4 3.09 1.12 4.42l2.83-2.31z"></path>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.3C13.46.86 11.42 0 9 0 5.48 0 2.4 1.97.92 4.99l2.83 2.31c.71-2.13 2.7-3.72 5.05-3.72z"></path>
          </svg>
          <span>Login with Google</span>
        </button>
      </div>
    </div>
  `;
  
  document.getElementById("google-login-btn").addEventListener("click", handleFirebaseLogin);
}

// 2. Matches Project 1 Pending Approval Lock Page Layout exactly
function renderPendingApprovalView() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="lock-wrapper">
      <div class="lock-card">
        <div class="lock-icon-circle lock-icon-circle-amber">
          <i class="fa-solid fa-shield-halved" style="font-size: 20px;"></i>
        </div>
        <div class="lock-card-header">
          <h2 class="lock-title">Pending Approval</h2>
          <p class="lock-subtitle">Please contact admin for approval.</p>
        </div>
        <div class="login-card-divider"></div>
        <button id="lock-logout-btn" class="btn btn-secondary" style="width: 100%; max-width: 100%;">Log Out</button>
      </div>
      <div class="progress-bar-container">
        <div class="animate-progress-slide"></div>
      </div>
    </div>
  `;
  
  document.getElementById("lock-logout-btn").addEventListener("click", logoutTenant);
}

// 3. Matches Project 1 Access Denied Lock Page Layout exactly
function renderAccessDeniedView() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="lock-wrapper">
      <div class="lock-card">
        <div class="lock-icon-circle lock-icon-circle-red">
          <i class="fa-solid fa-shield-halved" style="font-size: 20px;"></i>
        </div>
        <div class="lock-card-header">
          <h2 class="lock-title">Access Denied</h2>
          <p class="lock-subtitle">Please contact admin.</p>
        </div>
        <div class="login-card-divider"></div>
        <button id="lock-logout-btn" class="btn btn-secondary" style="width: 100%; max-width: 100%;">Log Out</button>
      </div>
    </div>
  `;
  document.getElementById("lock-logout-btn").addEventListener("click", logoutTenant);
}

// 4. Main workspace layout (Side Nav Panel, Workspace Area, TopBar, Main Content calc grid)
async function renderDashboardView() {
  document.body.style.overflow = "hidden";
  const app = document.getElementById("app");
  
  // Fetch tenant sites for navigation dynamically
  let sites = [];
  try {
    const res = await apiRequest("/api/tenant/sites");
    if (res.ok) {
      sites = await res.json();
      sites.forEach(s => {
        if (s.favicon) s.favicon = s.favicon.replace(/ /g, "%20");
      });
    }
  } catch (e) {
    console.error("Failed to load tenant sites:", e);
  }
  tenantSites = sites;

  const isAdmin = currentUser.email === "hsgglobalpteltd@gmail.com" || (currentTenant && ["Administrator", "Manager", "Operator"].includes(currentTenant.role));

  // If in a site workspace preview
  if (activeSiteWorkspace) {
    const siteObj = sites.find(s => s.id === activeSiteWorkspace.id) || { id: activeSiteWorkspace.id, name: activeSiteWorkspace.name };
    activeSiteWorkspace.name = siteObj.name;
  }

  // Set default catalog site if needed
  if (!selectedCatalogSiteId && sites.length > 0) {
    selectedCatalogSiteId = sites[0].id;
  }

  app.innerHTML = `
    <div class="app-container">
      <!-- 1. Side Panel Navigation (Matching Project 1 & Images 1 and 2) -->
      <aside class="side-panel" id="side-panel">
        <!-- Floating Border Toggle Button on Panel Line (Positioned at 10% bottom right border) -->
        <button class="panel-border-toggle-btn" id="toggle-sidebar-btn" title="Toggle Sidebar">
          <i class="fa-solid fa-chevron-left" id="sidebar-toggle-icon"></i>
        </button>

        <!-- Header Section -->
        <div class="side-panel-header">
          <!-- Expanded Branding -->
          <div class="brand-container">
            <div class="brand-title">iB HSG Global Sites</div>
            <div class="brand-subtitle">Brand Owner Portal & Site Management</div>
          </div>
          <!-- Collapsed Brand Icon -->
          <div class="brand-collapsed-icon">
            <span>iB</span>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="side-search-wrapper">
          <i class="fa-solid fa-magnifying-glass" style="font-size: 12.5px; color: #94A3B8; flex-shrink: 0;"></i>
          <input type="text" id="side-search-input" class="side-search-input" placeholder="Search modules..." />
        </div>
        <button class="side-search-btn-collapsed" id="side-search-btn-collapsed" title="Search modules">
          <i class="fa-solid fa-magnifying-glass" style="font-size: 15px;"></i>
        </button>

        <!-- Menu Items Section -->
        <ul class="side-menu">
          ${isAdmin ? `
            <!-- DFA Menu Items -->
            <li>
              <a class="side-menu-item ${activeTab === 'sites' && !activeSiteWorkspace ? 'active' : ''}" id="menu-tab-sites" title="Sites">
                <i class="fa-solid fa-globe"></i>
                <span class="side-menu-text">Sites</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'other-sites' && !activeSiteWorkspace ? 'active' : ''}" id="menu-tab-other-sites" title="Other Sites">
                <i class="fa-solid fa-layer-group"></i>
                <span class="side-menu-text">Other Sites</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'posts' ? 'active' : ''}" id="menu-tab-posts" title="Posts">
                <i class="fa-solid fa-newspaper"></i>
                <span class="side-menu-text">Posts</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'inquiries' ? 'active' : ''}" id="menu-tab-inquiries" title="Inquiries">
                <i class="fa-solid fa-inbox"></i>
                <span class="side-menu-text">Inquiries</span>
                <span id="unread-inquiries-badge" class="badge-unread-inbox" style="display: none; margin-left: auto; background: #EF4444; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 10px;">0</span>
              </a>
            </li>
          ` : `
            <!-- DFT Menu Items -->
            <li>
              <a class="side-menu-item ${activeTab === 'sites' && !activeSiteWorkspace ? 'active' : ''}" id="menu-tab-sites" title="Sites">
                <i class="fa-solid fa-globe"></i>
                <span class="side-menu-text">Sites</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'catalog' ? 'active' : ''}" id="menu-tab-catalog" title="Catalog">
                <i class="fa-solid fa-boxes-stacked"></i>
                <span class="side-menu-text">Catalog</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'stock' ? 'active' : ''}" id="menu-tab-stock" title="Stock">
                <i class="fa-solid fa-warehouse"></i>
                <span class="side-menu-text">Stock</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'shelf-visibility' ? 'active' : ''}" id="menu-tab-shelf-visibility" title="Shelf Visibility">
                <i class="fa-solid fa-eye"></i>
                <span class="side-menu-text">Shelf Visibility</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'posts' ? 'active' : ''}" id="menu-tab-posts" title="Posts">
                <i class="fa-solid fa-newspaper"></i>
                <span class="side-menu-text">Posts</span>
              </a>
            </li>
            <li>
              <a class="side-menu-item ${activeTab === 'inquiries' ? 'active' : ''}" id="menu-tab-inquiries" title="Inquiries">
                <i class="fa-solid fa-inbox"></i>
                <span class="side-menu-text">Inquiries</span>
                <span id="unread-inquiries-badge" class="badge-unread-inbox" style="display: none; margin-left: auto; background: #EF4444; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 10px;">0</span>
              </a>
            </li>
          `}
        </ul>

        <!-- Bottom / Footer Section -->
        <div class="side-panel-footer">
          <!-- Integrated User Profile & Logout Row -->
          <div class="profile-capsule-widget">
            <!-- Avatar & User Info (Click to edit profile) -->
            <div id="user-profile-widget" style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer;" title="Edit Profile">
              <div style="width: 28px; height: 28px; border-radius: 50%; background-color: #F1F5F9; color: #475569; border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0;">
                ${(currentTenant?.name || currentUser.displayName || currentUser.email).substring(0, 2).toUpperCase()}
              </div>
              <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25;" class="side-menu-text">
                <span style="font-size: 12px; font-weight: 600; color: #1E293B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${currentTenant?.name || currentUser.displayName || currentUser.email.split('@')[0]}
                </span>
                <span style="font-size: 10.5px; color: #94A3B8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  ${currentUser.email}
                </span>
              </div>
            </div>

            <!-- Subtle Logout Icon Button -->
            <button class="footer-logout-icon-btn" id="logout-btn" title="Log Out">
              <i class="fa-solid fa-arrow-right-from-bracket"></i>
            </button>
          </div>

          <!-- Subtle Single-Line Watermark -->
          <div class="footer-watermark">
            <p style="font-size: 9px; color: #94A3B8; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.02em;">
              INTERNAL BRIDGE · © 2026 HSG Global
            </p>
          </div>
        </div>
      </aside>
      
      <!-- 2. Workspace Wrapper -->
      <div class="workspace-wrapper">
        <!-- Main Content Area -->
        <main class="main-content">
          <div class="container-alignment" id="workspace-content">
            <!-- Dynamic Subview Mount -->
          </div>
        </main>
      </div>
    </div>
  `;
  
  // Bind Sidebar toggler on border
  const sidePanelEl = document.getElementById("side-panel");
  const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn");
  const toggleIcon = document.getElementById("sidebar-toggle-icon");
  if (toggleSidebarBtn && sidePanelEl) {
    toggleSidebarBtn.addEventListener("click", () => {
      const isCollapsed = sidePanelEl.classList.toggle("collapsed");
      if (toggleIcon) {
        toggleIcon.className = isCollapsed ? "fa-solid fa-chevron-right" : "fa-solid fa-chevron-left";
      }
      toggleSidebarBtn.title = isCollapsed ? "Expand Sidebar" : "Collapse Sidebar";
    });
  }

  // Bind collapsed search button to expand sidebar
  const searchBtnCollapsed = document.getElementById("side-search-btn-collapsed");
  if (searchBtnCollapsed && sidePanelEl) {
    searchBtnCollapsed.addEventListener("click", () => {
      sidePanelEl.classList.remove("collapsed");
      if (toggleIcon) toggleIcon.className = "fa-solid fa-chevron-left";
      setTimeout(() => document.getElementById("side-search-input")?.focus(), 150);
    });
  }
 
  const profileWidget = document.getElementById("user-profile-widget");
  if (profileWidget) {
    profileWidget.addEventListener("click", () => {
      openUserProfileModal();
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", logoutTenant);
  }

  // Bind Menu tab navigation
  const tabSites = document.getElementById("menu-tab-sites");
  if (tabSites) {
    tabSites.addEventListener("click", () => {
      activeTab = "sites";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabOtherSites = document.getElementById("menu-tab-other-sites");
  if (tabOtherSites) {
    tabOtherSites.addEventListener("click", () => {
      activeTab = "other-sites";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabCatalog = document.getElementById("menu-tab-catalog");
  if (tabCatalog) {
    tabCatalog.addEventListener("click", () => {
      activeTab = "catalog";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabStock = document.getElementById("menu-tab-stock");
  if (tabStock) {
    tabStock.addEventListener("click", () => {
      activeTab = "stock";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabShelfVisibility = document.getElementById("menu-tab-shelf-visibility");
  if (tabShelfVisibility) {
    tabShelfVisibility.addEventListener("click", () => {
      activeTab = "shelf-visibility";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabPosts = document.getElementById("menu-tab-posts");
  if (tabPosts) {
    tabPosts.addEventListener("click", () => {
      activeTab = "posts";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  const tabInquiries = document.getElementById("menu-tab-inquiries");
  if (tabInquiries) {
    tabInquiries.addEventListener("click", () => {
      activeTab = "inquiries";
      activeSiteWorkspace = null;
      renderDashboardView();
    });
  }

  // Update live unread inquiries badge in the background
  (async () => {
    try {
      const res = await apiRequest("/api/tenant/inquiries");
      if (res.ok) {
        const data = await res.json();
        const unreadCount = Number(data.unread_count || 0);
        const badge = document.getElementById("unread-inquiries-badge");
        if (badge) {
          if (unreadCount > 0) {
            badge.style.display = "inline-block";
            badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
          } else {
            badge.style.display = "none";
          }
        }
      }
    } catch {}
  })();

  // Render Subview inside workspace-content
  if (activeSiteWorkspace) {
    await renderSitePreviewDashboard(activeSiteWorkspace.id, activeSiteWorkspace.name, activeSiteWorkspace.isMain);
  } else {
    if (activeTab === "sites") {
      await renderSitesGalleryView(false, sites, isAdmin);
    } else if (activeTab === "other-sites") {
      await renderSitesGalleryView(true, sites, isAdmin);
    } else if (activeTab === "catalog") {
      await renderCatalogView(sites);
    } else if (activeTab === "stock") {
      await renderStockView(sites);
    } else if (activeTab === "shelf-visibility") {
      await renderShelfVisibilityView(sites);
    } else if (activeTab === "posts") {
      await renderPostsView(sites);
    } else if (activeTab === "inquiries") {
      await renderInquiriesView(sites);
    }
  }
}

// --- Subview 1: Sites & Other Sites Gallery View ---
async function renderSitesGalleryView(isOtherSites = false, sites = [], isAdmin = false) {
  const workspace = document.getElementById("workspace-content");
  
  // Filter sites for this gallery view
  let displaySites = [];
  if (isAdmin) {
    if (!isOtherSites) {
      // Sites: Main site + Admin-owned sites (no tenant assigned)
      displaySites = sites.filter(s => s.id === "main" || (!s.tenant_emails || s.tenant_emails.length === 0));
    } else {
      // Other Sites: Brand owner sites (assigned to tenants)
      displaySites = sites.filter(s => s.id !== "main" && (s.tenant_emails && s.tenant_emails.length > 0));
    }
  } else {
    // DFT: All sites assigned to this tenant
    displaySites = sites;
  }

  // DFT with 0 assigned sites -> Empty state
  if (!isAdmin && displaySites.length === 0) {
    workspace.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; text-align: center; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px; padding: 40px 20px; box-sizing: border-box;">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: #E8F0FE; color: var(--accent-color); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">
          <i class="fa-solid fa-shield-halved"></i>
        </div>
        <h3 style="font-size: 16px; font-weight: 700; color: #1E293B; margin-bottom: 8px;">No Sites Assigned</h3>
        <p style="font-size: 13px; color: #64748B; max-width: 380px; line-height: 1.5;">Contact HSG Global Admin to Get Access to your site.</p>
      </div>
    `;
    return;
  }

  const title = isOtherSites ? "Other Sites" : "Sites";
  const desc = isOtherSites
    ? "Manage brand owner sites, view layout designs, and adjust assigned permissions."
    : (isAdmin ? "Primary corporate portal and internal website containers." : "Manage your assigned brand website layouts and pages.");

  workspace.innerHTML = `
    <div class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
      <div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 4px 0;">${title}</h1>
        <p style="font-size: 12.5px; color: #64748B; margin: 0;">${desc}</p>
      </div>
      ${isAdmin ? `
        <button class="btn btn-primary" id="btn-gallery-add-site" style="height: 36px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; border-radius: 8px;">
          <i class="fa-solid fa-plus"></i> Add New Site
        </button>
      ` : ""}
    </div>

    <div class="content-body" style="overflow-y: auto;">
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; padding-bottom: 24px;">
        
        ${isAdmin ? `
          <!-- Add Site Action Card -->
          <div class="site-card-add" id="card-add-new-site" style="border: 2px dashed #CBD5E1; border-radius: 14px; background: #FFFFFF; min-height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; transition: all 0.2s ease;">
            <div style="width: 38px; height: 38px; border-radius: 50%; background: #E8F0FE; color: var(--accent-color); display: flex; align-items: center; justify-content: center; font-size: 15px;">
              <i class="fa-solid fa-plus"></i>
            </div>
            <span style="font-size: 13.5px; font-weight: 700; color: #1E293B;">Add New Site</span>
            <span style="font-size: 11px; color: #64748B;">Create a new website container</span>
          </div>
        ` : ""}

        <!-- Site Cards -->
        ${displaySites.map(site => {
          const siteUrl = site.custom_domain
            ? (site.custom_domain.startsWith("http") ? site.custom_domain : `https://${site.custom_domain}`)
            : `${window.location.origin}${site.id === 'main' ? '/' : '/' + site.id}`;

          return `
            <div class="site-gallery-card" data-site-id="${site.id}">
              
              <!-- 1. Full-Width Top Cover / Featured Web Image Banner -->
              <div class="site-card-cover-wrap" style="position: relative; width: 100%; height: 130px; background: #F1F5F9; border-bottom: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                ${site.social_preview_image ? `
                  <img src="${site.social_preview_image}" alt="${site.name}" style="width: 100%; height: 100%; object-fit: cover;" />
                ` : `
                  <div style="width: 100%; height: 100%; background: #F1F5F9;"></div>
                `}
                <!-- Top Right: Site Settings Gear Icon -->
                <button class="btn-icon btn-site-gear" data-site-id="${site.id}" title="Site Settings" style="position: absolute; top: 10px; right: 10px; width: 32px; height: 32px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.08); background: #FFFFFF; color: #475569; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.15s ease; box-shadow: 0 2px 6px rgba(0,0,0,0.08);">
                  <i class="fa-solid fa-gear" style="font-size: 13.5px;"></i>
                </button>
              </div>

              <!-- Card Body Content Container -->
              <div style="padding: 14px 16px 16px 16px; display: flex; flex-direction: column; gap: 12px; flex: 1;">
                
                <!-- 2. Header: Icon + Title + Slug -->
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
                  <img src="${site.favicon || DEFAULT_FAVICON}" style="width: 32px; height: 32px; border-radius: 6px; object-fit: contain; flex-shrink: 0; ${site.favicon ? 'filter: none; opacity: 1;' : 'filter: grayscale(100%); opacity: 0.4;'}" onerror="this.onerror=null; this.src='${DEFAULT_FAVICON}'; this.style.filter='grayscale(100%)'; this.style.opacity='0.4';" />
                  <div style="min-width: 0; flex: 1;">
                    <h4 style="font-size: 14px; font-weight: 700; color: #1E293B; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${site.name}</h4>
                    <span style="font-size: 11px; font-family: monospace; color: #64748B;">/${site.id}</span>
                  </div>
                </div>

                <!-- 3. Website URL Disabled/Readonly Input with Neutral Copy & Open Buttons -->
                <div class="site-url-copy-box" style="display: flex; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 2px 4px 2px 10px; gap: 6px;" onclick="event.stopPropagation();">
                  <i class="fa-solid fa-link" style="font-size: 11px; color: #94A3B8; flex-shrink: 0;"></i>
                  <input type="text" readonly value="${siteUrl}" style="flex: 1; min-width: 0; background: transparent; border: none; outline: none; font-size: 11px; font-family: monospace; color: #475569; text-overflow: ellipsis; cursor: text;" onclick="this.select();" />
                  <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
                    <button class="btn-copy-site-url" data-url="${siteUrl}" title="Copy URL" style="height: 26px; padding: 0 8px; border-radius: 6px; border: 1px solid #E2E8F0; background: #FFFFFF; color: #52525B; font-size: 11px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.15s ease;">
                      <i class="fa-regular fa-copy" style="font-size: 10.5px; color: #71717A;"></i>
                      <span>Copy</span>
                    </button>
                    <a href="${siteUrl}" target="_blank" class="btn-open-site-url" title="Open Website" style="height: 26px; padding: 0 8px; border-radius: 6px; border: 1px solid #E2E8F0; background: #FFFFFF; color: #52525B; font-size: 11px; font-weight: 500; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s ease;" onclick="event.stopPropagation();">
                      <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 10px; color: #71717A;"></i>
                      <span>Open</span>
                    </a>
                  </div>
                </div>

                <!-- 4. Bottom Info: Page Count + Status -->
                <div style="display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: #64748B; border-top: 1px solid #F1F5F9; padding-top: 10px; margin-top: auto;">
                  <span style="display: inline-flex; align-items: center; gap: 6px;">
                    <i class="fa-regular fa-file-lines"></i> ${site.page_count || 1} ${site.page_count === 1 ? 'page' : 'pages'}
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: ${site.status === 'suspended' ? '#DC2626' : '#137333'};">
                    <i class="fa-solid fa-circle" style="font-size: 7px;"></i> ${site.status === 'suspended' ? 'Suspended' : 'Active'}
                  </span>
                </div>

              </div>

            </div>
          `;
        }).join("")}

      </div>
    </div>
  `;

  // Bind clicking site cards to open workspace preview
  displaySites.forEach(site => {
    const cardEl = document.querySelector(`.site-gallery-card[data-site-id="${site.id}"]`);
    if (cardEl) {
      cardEl.addEventListener("click", (e) => {
        // Ignore if clicking settings gear, url box, copy button, or visit link
        if (e.target.closest(".btn-site-gear") || e.target.closest(".site-url-copy-box") || e.target.closest("a")) return;
        activeSiteWorkspace = { id: site.id, name: site.name, isMain: site.id === "main" };
        renderDashboardView();
      });
    }

    const gearBtn = document.querySelector(`.btn-site-gear[data-site-id="${site.id}"]`);
    if (gearBtn) {
      gearBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await openSiteSettingsModal(site);
      });
    }
  });

  // Bind copy URL buttons
  document.querySelectorAll(".btn-copy-site-url").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const urlToCopy = btn.getAttribute("data-url");
      if (urlToCopy) {
        try {
          await navigator.clipboard.writeText(urlToCopy);
          showToast("Website URL copied to clipboard!");
          const originalHtml = btn.innerHTML;
          btn.innerHTML = `<i class="fa-solid fa-check" style="color:#137333;"></i> <span>Copied</span>`;
          setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
        } catch {
          showToast("Failed to copy URL", "warning");
        }
      }
    });
  });

  // Bind Add Site action
  const addSiteAction = async () => {
    const siteId = await showPrompt(
      "New Site Slug",
      "Enter Site ID / Route Slug (lowercase, alphanumeric only, e.g. 'sitetenant1'):"
    );
    if (siteId === null) return;
    const cleanId = siteId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!cleanId) {
      showToast("Invalid site slug", "warning");
      return;
    }

    const siteName = await showPrompt(
      "New Site Name",
      "Enter Site Display Name (e.g. 'Tenant Site'):"
    );
    if (!siteName) {
      showToast("Site name cannot be empty", "warning");
      return;
    }

    const userEmails = await showPrompt(
      "Assign Users (Emails)",
      "Enter user emails (comma separated, e.g. user1@test.com, user2@test.com) or leave empty for Administrator only:"
    );
    const assignedEmails = userEmails
      ? userEmails.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
      : [];

    try {
      const res = await apiRequest("/api/admin/sites/create", {
        method: "POST",
        body: JSON.stringify({ id: cleanId, name: siteName, assigned_emails: assignedEmails })
      });
      if (res.ok) {
        showToast(`Successfully created site: ${siteName}`, "success");
        renderDashboardView();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to create site container.", "danger");
      }
    } catch (e) {
      showToast("Network error creating site.", "danger");
    }
  };

  const btnGalleryAdd = document.getElementById("btn-gallery-add-site");
  if (btnGalleryAdd) btnGalleryAdd.addEventListener("click", addSiteAction);

  const cardAdd = document.getElementById("card-add-new-site");
  if (cardAdd) cardAdd.addEventListener("click", addSiteAction);
}

// --- Subview 2: Product Catalog View ---
async function renderCatalogView(sites = []) {
  const workspace = document.getElementById("workspace-content");
  
  if (sites.length === 0) {
    workspace.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; text-align: center; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px; padding: 40px 20px;">
        <h3 style="font-size: 16px; font-weight: 700; color: #1E293B; margin-bottom: 8px;">No Sites Assigned</h3>
        <p style="font-size: 13px; color: #64748B;">Assign a website first to manage product catalog.</p>
      </div>
    `;
    return;
  }

  if (!selectedCatalogSiteId || !sites.some(s => s.id === selectedCatalogSiteId)) {
    selectedCatalogSiteId = sites[0].id;
  }

  workspace.innerHTML = `
    <div class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 4px 0;">Product Catalog</h1>
        <p style="font-size: 12.5px; color: #64748B; margin: 0;">Manage individual product display, descriptions, and 1:1 image assets for your site.</p>
      </div>
      
      <div style="display: flex; align-items: center; gap: 10px;">
        ${sites.length > 1 ? `
          <select id="catalog-site-select" style="height: 36px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 12.5px; font-weight: 600; color: #1E293B; outline: none; cursor: pointer;">
            ${sites.map(s => `
              <option value="${s.id}" ${s.id === selectedCatalogSiteId ? 'selected' : ''}>${s.name} (/${s.id})</option>
            `).join("")}
          </select>
        ` : ""}
        <button class="btn btn-primary" id="btn-catalog-add-product" style="height: 36px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; border-radius: 8px;">
          <i class="fa-solid fa-plus"></i> Add Product
        </button>
      </div>
    </div>

    <div class="content-body" id="catalog-content-body" style="overflow-y: auto;">
      <div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent-color);"></i></div>
    </div>
  `;

  // Bind site select change
  const siteSelect = document.getElementById("catalog-site-select");
  if (siteSelect) {
    siteSelect.addEventListener("change", (e) => {
      selectedCatalogSiteId = e.target.value;
      loadCatalogItems(selectedCatalogSiteId);
    });
  }

  const addBtn = document.getElementById("btn-catalog-add-product");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      openAddProductModal(selectedCatalogSiteId);
    });
  }

  await loadCatalogItems(selectedCatalogSiteId);
}

async function loadCatalogItems(siteId) {
  const container = document.getElementById("catalog-content-body");
  if (!container) return;

  try {
    const res = await apiRequest(`/api/tenant/sites/${encodeURIComponent(siteId)}/catalog`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    const catalog = data.catalog || [];

    if (catalog.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; font-size: 22px; margin: 0 auto 14px;">
            <i class="fa-solid fa-boxes-stacked"></i>
          </div>
          <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">Catalog is Empty</h4>
          <p style="font-size: 12.5px; color: #64748B; max-width: 360px; margin: 0 auto 16px;">Click '+ Add Product' to select an assigned brand item and customize its display details.</p>
          <button class="btn btn-primary btn-sm" id="btn-catalog-empty-add" style="border-radius: 8px;"><i class="fa-solid fa-plus"></i> Add Product</button>
        </div>
      `;
      document.getElementById("btn-catalog-empty-add")?.addEventListener("click", () => {
        openAddProductModal(siteId);
      });
      return;
    }

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 230px)); gap: 16px; padding-bottom: 24px;">
        ${catalog.map(item => {
          const photos = Array.isArray(item.photos) ? item.photos : [];
          const mainPhoto = photos.length > 0 ? photos[0] : (item.product_default_image || "");
          return `
            <div class="catalog-card" style="border: 1px solid var(--border-color); border-radius: 12px; background: #FFFFFF; padding: 12px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.03); max-width: 230px; box-sizing: border-box;">
              
              <!-- Photo Display (1:1 Ratio) -->
              <div style="width: 100%; aspect-ratio: 1/1; border-radius: 8px; background: #F8F9FA; border: 1px solid #E2E8F0; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center;">
                ${mainPhoto ? `
                  <img src="${mainPhoto}" style="width: 100%; height: 100%; object-fit: cover;" />
                ` : `
                  <div style="color: #94A3B8; font-size: 28px;"><i class="fa-solid fa-image"></i></div>
                `}
                ${photos.length > 1 ? `
                  <span style="position: absolute; bottom: 6px; right: 6px; background: rgba(0,0,0,0.7); color: #fff; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 99px;">
                    <i class="fa-solid fa-images"></i> ${photos.length}
                  </span>
                ` : ""}
              </div>

              <!-- Product Details -->
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                  <span style="font-size: 10.5px; font-weight: 700; color: var(--accent-color); text-transform: uppercase; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.brand_name || ''}</span>
                  <span style="font-size: 10px; font-family: monospace; color: #64748B; background: #F1F5F9; padding: 2px 5px; border-radius: 4px; flex-shrink: 0;">${item.sku}</span>
                </div>
                <h4 style="font-size: 13px; font-weight: 700; color: #1E293B; margin: 2px 0 0 0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${item.display_name}</h4>
                ${item.description ? `
                  <p style="font-size: 11.5px; color: #64748B; margin: 3px 0 0 0; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${item.description}</p>
                ` : ""}
              </div>

              <!-- Action Buttons -->
              <div style="display: flex; justify-content: flex-end; gap: 6px; border-top: 1px solid #F1F5F9; padding-top: 8px; margin-top: auto;">
                <button class="btn btn-secondary btn-sm btn-edit-catalog" data-id="${item.id}" style="height: 28px; padding: 0 10px; font-size: 11px; border-radius: 6px;"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
                <button class="btn btn-danger btn-sm btn-delete-catalog" data-id="${item.id}" style="height: 28px; width: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; font-size: 11px;"><i class="fa-solid fa-trash"></i></button>
              </div>

            </div>
          `;
        }).join("")}
      </div>
    `;

    // Bind Edit and Delete
    catalog.forEach(item => {
      const editBtn = container.querySelector(`.btn-edit-catalog[data-id="${item.id}"]`);
      if (editBtn) {
        editBtn.addEventListener("click", () => {
          openAddProductModal(siteId, item);
        });
      }

      const delBtn = container.querySelector(`.btn-delete-catalog[data-id="${item.id}"]`);
      if (delBtn) {
        delBtn.addEventListener("click", async () => {
          if (await showConfirm("Remove Product", `Remove '${item.display_name}' from the site catalog?`, { confirmText: "Remove", variant: "danger" })) {
            const dRes = await apiRequest(`/api/tenant/sites/${encodeURIComponent(siteId)}/catalog/${encodeURIComponent(item.id)}`, { method: "DELETE" });
            if (dRes.ok) {
              showToast("Product removed from catalog.");
              loadCatalogItems(siteId);
            } else {
              showToast("Failed to remove product.", "danger");
            }
          }
        });
      }
    });

  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger-color); padding: 20px;">Error loading catalog.</div>`;
  }
}

// Modal: Add / Edit Product in Site Catalog
async function openAddProductModal(siteId, itemToEdit = null) {
  // Fetch available assigned products and brands
  let lookupData = { brands: [], products: [] };
  try {
    const res = await apiRequest(`/api/tenant/products-lookup?site_id=${encodeURIComponent(siteId)}`);
    if (res.ok) lookupData = await res.json();
  } catch {}

  const brands = lookupData.brands || [];
  const products = lookupData.products || [];

  const oldModal = document.getElementById("catalog-modal-overlay");
  if (oldModal) oldModal.remove();

  const overlay = document.createElement("div");
  overlay.id = "catalog-modal-overlay";
  overlay.className = "seo-overlay";

  let currentPhotos = itemToEdit && Array.isArray(itemToEdit.photos) ? [...itemToEdit.photos] : [];
  let selectedBrandId = itemToEdit ? itemToEdit.brand_id : (brands[0]?.id || "");
  let selectedSku = itemToEdit ? itemToEdit.sku : "";

  overlay.innerHTML = `
    <div class="seo-modal" style="width: 520px; max-width: 95vw; background: #FFFFFF; border-radius: 16px; box-shadow: 0 20px 40px rgba(0,0,0,0.15); overflow: hidden;">
      <div class="seo-modal-header" style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
        <h3 style="font-size: 15px; font-weight: 700; color: #1E293B; margin: 0;">${itemToEdit ? 'Edit Catalog Product' : 'Add Product to Catalog'}</h3>
        <button class="btn-icon" id="close-catalog-modal" style="border:none; background:none; cursor:pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div class="seo-modal-body" style="padding: 20px; max-height: 70vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
        
        <!-- Brand Selection -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Brand *</label>
          <select id="modal-product-brand" ${itemToEdit ? 'disabled' : ''} style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 13px; outline: none;">
            ${brands.map(b => `
              <option value="${b.id}" ${b.id === selectedBrandId ? 'selected' : ''}>${b.display_name || b.Name || b.id}</option>
            `).join("")}
          </select>
        </div>

        <!-- Product SKU Selection -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Product SKU *</label>
          <select id="modal-product-sku" ${itemToEdit ? 'disabled' : ''} style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 13px; outline: none;">
            <!-- Populated dynamically -->
          </select>
        </div>

        <!-- Custom Display Name -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Display Name *</label>
          <input type="text" id="modal-product-name" value="${itemToEdit?.display_name || ''}" placeholder="Product title shown on public site" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 13px; outline: none; box-sizing: border-box;" />
        </div>

        <!-- Description -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Description</label>
          <textarea id="modal-product-desc" rows="3" placeholder="Detailed product specifications or notes..." style="width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 13px; outline: none; box-sizing: border-box; resize: vertical;">${itemToEdit?.description || ''}</textarea>
        </div>

        <!-- Photos (1:1 Ratio, Max 10) -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="font-size: 11.5px; font-weight: 700; color: #475569;">Photos (1:1 Ratio, Max 10)</label>
            <span style="font-size: 11px; color: #64748B;" id="photo-count-label">${currentPhotos.length} / 10</span>
          </div>

          <!-- Dual Mode: Upload File OR Paste Image Link -->
          <div style="display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; align-items: center;">
            <input type="file" id="modal-photo-file-input" accept="image/png,image/jpeg,image/webp,image/gif" multiple style="display: none;" />
            <button type="button" class="btn btn-secondary" id="btn-upload-photos" style="height: 36px; padding: 0 14px; font-size: 12px; font-weight: 600; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer; user-select: none; margin: 0;">
              <i class="fa-solid fa-cloud-arrow-up" style="color: #0B57D0;"></i>
              <span id="btn-upload-photos-text">Upload Photo</span>
            </button>
            <div style="flex: 1; display: flex; gap: 6px; min-width: 220px;">
              <input type="text" id="modal-photo-url" placeholder="Or paste 1:1 image URL..." style="flex: 1; height: 36px; padding: 0 10px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 12px; outline: none; background: #FFFFFF; min-width: 0;" />
              <button type="button" class="btn btn-secondary" id="btn-add-photo-url" style="height: 36px; padding: 0 12px; font-size: 11.5px; font-weight: 600; border-radius: 8px; white-space: nowrap;">
                <i class="fa-solid fa-plus"></i> Add Link
              </button>
            </div>
          </div>

          <!-- Photo Thumbnails Grid -->
          <div id="modal-photos-grid" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px;">
            <!-- Rendered below -->
          </div>
        </div>

      </div>

      <div class="seo-modal-footer" style="padding: 14px 20px; border-top: 1px solid var(--border-color); background: #F8F9FA; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-catalog-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-catalog-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Product</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  document.getElementById("close-catalog-modal").addEventListener("click", close);
  document.getElementById("btn-cancel-catalog-modal").addEventListener("click", close);

  // Render photo thumbnails
  const renderPhotosGrid = () => {
    const grid = document.getElementById("modal-photos-grid");
    const countLabel = document.getElementById("photo-count-label");
    if (!grid) return;

    countLabel.innerText = `${currentPhotos.length} / 10`;
    grid.innerHTML = currentPhotos.map((url, idx) => `
      <div style="position: relative; width: 100%; aspect-ratio: 1/1; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; background: #F1F5F9;">
        <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;" />
        <button class="btn-del-photo" data-idx="${idx}" style="position: absolute; top: 3px; right: 3px; width: 20px; height: 20px; border-radius: 50%; background: rgba(0,0,0,0.65); color: #fff; border: none; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `).join("");

    grid.querySelectorAll(".btn-del-photo").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const idx = parseInt(btn.getAttribute("data-idx"));
        currentPhotos.splice(idx, 1);
        renderPhotosGrid();
      });
    });
  };

  // Render product dropdown based on brand
  const skuSelect = document.getElementById("modal-product-sku");
  const brandSelect = document.getElementById("modal-product-brand");
  const nameInput = document.getElementById("modal-product-name");

  const updateProductDropdown = () => {
    const selBrand = brandSelect.value;
    const prodsForBrand = products.filter(p => String(p.brands_id || p.Brands_ID || p.brand_id || "") === selBrand);
    
    skuSelect.innerHTML = prodsForBrand.length > 0 
      ? prodsForBrand.map(p => `
          <option value="${p.sku || p.SKU}" ${(p.sku || p.SKU) === selectedSku ? 'selected' : ''}>${p.display_name || p.Name || p.sku} (${p.sku || p.SKU})</option>
        `).join("")
      : `<option value="">No products under this brand</option>`;

    if (!itemToEdit && prodsForBrand.length > 0) {
      nameInput.value = prodsForBrand[0].display_name || prodsForBrand[0].Name || prodsForBrand[0].sku;
      if (prodsForBrand[0].image && currentPhotos.length === 0) {
        currentPhotos.push(prodsForBrand[0].image);
        renderPhotosGrid();
      }
    }
  };

  brandSelect.addEventListener("change", updateProductDropdown);
  skuSelect.addEventListener("change", () => {
    const chosen = products.find(p => String(p.sku || p.SKU) === skuSelect.value);
    if (chosen && !itemToEdit) {
      nameInput.value = chosen.display_name || chosen.Name || chosen.sku;
      if (chosen.image && currentPhotos.length === 0) {
        currentPhotos.push(chosen.image);
        renderPhotosGrid();
      }
    }
  });

  updateProductDropdown();
  renderPhotosGrid();

  // 1. Upload Photos handler
  const fileInput = document.getElementById("modal-photo-file-input");
  const uploadBtn = document.getElementById("btn-upload-photos");
  const uploadText = document.getElementById("btn-upload-photos-text");

  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      fileInput.click();
    });

    fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      if (currentPhotos.length + files.length > 10) {
        showToast("Maximum 10 photos allowed", "warning");
        fileInput.value = "";
        return;
      }

      if (uploadText) uploadText.innerText = "Uploading...";
      uploadBtn.disabled = true;

      for (const file of files) {
        try {
          const fileData = await file.arrayBuffer();
          const filename = `catalog/${siteId}/${Date.now()}_${file.name}`;
          const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${currentUser?.accessToken || ''}`,
              "Content-Type": file.type || "application/octet-stream"
            },
            body: fileData
          });

          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              currentPhotos.push(data.url);
            }
          } else {
            // Fallback to base64 preview if R2 direct upload is unavailable
            const base64Data = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(file);
            });
            currentPhotos.push(base64Data);
          }
        } catch (err) {
          console.error("Failed to upload image:", err);
          showToast("Failed to upload " + file.name, "error");
        }
      }

      if (uploadText) uploadText.innerText = "Upload Photo";
      uploadBtn.disabled = false;
      fileInput.value = "";
      renderPhotosGrid();
    });
  }

  // 2. Add Photo URL button
  document.getElementById("btn-add-photo-url").addEventListener("click", (e) => {
    e.preventDefault();
    if (currentPhotos.length >= 10) {
      showToast("Maximum 10 photos allowed", "warning");
      return;
    }
    const input = document.getElementById("modal-photo-url");
    const urlVal = input.value.trim();
    if (!urlVal) return;
    currentPhotos.push(urlVal);
    input.value = "";
    renderPhotosGrid();
  });

  // Save product
  document.getElementById("btn-save-catalog-modal").addEventListener("click", async () => {
    const sku = skuSelect.value;
    const brandId = brandSelect.value;
    const displayName = nameInput.value.trim();
    const description = document.getElementById("modal-product-desc").value.trim();

    if (!sku) {
      showToast("Please select a Product SKU", "warning");
      return;
    }
    if (!displayName) {
      showToast("Display Name is required", "warning");
      return;
    }

    const payload = {
      id: itemToEdit ? itemToEdit.id : undefined,
      sku: sku,
      brand_id: brandId,
      display_name: displayName,
      description: description,
      photos: currentPhotos
    };

    const saveBtn = document.getElementById("btn-save-catalog-modal");
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";

    try {
      const res = await apiRequest(`/api/tenant/sites/${encodeURIComponent(siteId)}/catalog`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        showToast("Product saved to catalog!");
        close();
        loadCatalogItems(siteId);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to save product.", "danger");
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Product";
      }
    } catch (e) {
      showToast("Network error saving product.", "danger");
      saveBtn.disabled = false;
      saveBtn.innerText = "Save Product";
    }
  });
}

// --- Subview 3: Live Stock Levels View ---
async function renderStockView(sites = []) {
  const workspace = document.getElementById("workspace-content");

  workspace.innerHTML = `
    <div class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
      <div>
        <h1 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0 0 4px 0;">Live Stock Levels</h1>
        <p style="font-size: 12.5px; color: #64748B; margin: 0;">Live warehouse inventory & store distribution for assigned brands.</p>
      </div>
      <button class="btn btn-secondary btn-sm" id="btn-refresh-stock" style="height: 36px; display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; border-radius: 8px;">
        <i class="fa-solid fa-arrows-rotate"></i> Refresh
      </button>
    </div>

    <div class="content-body" id="stock-content-body" style="overflow-y: auto;">
      <div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent-color);"></i></div>
    </div>
  `;

  document.getElementById("btn-refresh-stock").addEventListener("click", () => {
    loadStockData();
  });

  await loadStockData();
}

async function loadStockData() {
  const container = document.getElementById("stock-content-body");
  if (!container) return;

  try {
    const res = await apiRequest("/api/tenant/stock");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server responded with status ${res.status}`);
    }
    const data = await res.json();
    const brandGroups = data.brands || [];

    if (brandGroups.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; font-size: 22px; margin: 0 auto 14px;">
            <i class="fa-solid fa-warehouse"></i>
          </div>
          <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">No Stock Data Available</h4>
          <p style="font-size: 12.5px; color: #64748B; max-width: 360px; margin: 0 auto;">No stock logs found for your assigned brand(s).</p>
        </div>
      `;
      return;
    }

    container.innerHTML = brandGroups.map(bg => `
      <div style="background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 14px; margin-bottom: 24px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
        
        <!-- Brand Group Header -->
        <div style="padding: 14px 20px; background: #F8F9FA; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 12px;">
            ${bg.brand_logo ? `
              <img src="${bg.brand_logo}" style="width: 28px; height: 28px; border-radius: 6px; object-fit: cover; border: 1px solid #E2E8F0;" />
            ` : `
              <div style="width: 28px; height: 28px; border-radius: 6px; background: #E2E8F0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #64748B;"><i class="fa-solid fa-tag"></i></div>
            `}
            <h3 style="font-size: 14px; font-weight: 700; color: #1E293B; margin: 0;">${bg.brand_name}</h3>
          </div>
          <span style="font-size: 11.5px; color: #64748B; font-weight: 600;">${bg.products.length} Products</span>
        </div>

        <!-- Stock Table -->
        <table class="data-table" style="width: 100%;">
          <thead>
            <tr>
              <th style="width: 18%;">SKU</th>
              <th style="width: 44%;">Product Name</th>
              <th style="width: 19%; text-align: right;">Warehouse</th>
              <th style="width: 19%; text-align: right;">Distributed</th>
            </tr>
          </thead>
          <tbody>
            ${bg.products
              .slice()
              .sort((a, b) => (Number(b.store_count || 0) - Number(a.store_count || 0)) || (Number(b.store_qty || 0) - Number(a.store_qty || 0)))
              .map(prod => {
              const isCounting = prod.warehouse_qty === null;
              const cartonVal = prod.warehouse_cartons !== null && prod.warehouse_cartons !== undefined 
                ? Math.floor(prod.warehouse_cartons)
                : (isCounting ? null : Math.floor(prod.warehouse_qty / (prod.pcs_per_carton || 12)));
              
              const whDisplay = isCounting
                ? `<div style="display: flex; flex-direction: column; align-items: flex-end;"><span class="badge badge-counting" title="Counting in progress"><i class="fa-solid fa-spinner fa-spin" style="font-size: 9px; margin-right: 4px;"></i> Counting...</span></div>`
                : `<div style="display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25;">
                    <div><strong style="font-family: monospace; font-size: 13px;">${prod.warehouse_qty.toLocaleString()}</strong> <span style="font-size: 11.5px; color: #64748B;">pcs</span></div>
                    <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${cartonVal !== null ? `${cartonVal.toLocaleString()} carton` : '--'}</div>
                   </div>`;

              const rawStoreCount = prod.store_count !== undefined && prod.store_count !== null ? prod.store_count : 0;
              const storeCountVal = prod.store_qty > 0 && rawStoreCount === 0 ? 1 : rawStoreCount;
              const storeDisplay = `
                <div style="display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25;">
                  <div><strong style="font-family: monospace; font-size: 13px;">${prod.store_qty.toLocaleString()}</strong> <span style="font-size: 11.5px; color: #64748B;">pcs</span></div>
                  <div style="font-size: 11px; color: #64748B; margin-top: 2px;">${prod.store_qty > 0 ? `${storeCountVal.toLocaleString()} stores` : '0 stores'}</div>
                </div>`;

              return `
                <tr>
                  <td style="font-family: monospace; font-weight: 700; font-size: 12px; color: #334155;">${prod.sku}</td>
                  <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                      ${prod.image ? `
                        <img src="${prod.image}" style="width: 28px; height: 28px; border-radius: 4px; object-fit: cover; border: 1px solid #E2E8F0;" />
                      ` : ""}
                      <span style="font-weight: 600; color: #1E293B; font-size: 13px;">${prod.name}</span>
                    </div>
                  </td>
                  <td style="text-align: right;">${whDisplay}</td>
                  <td style="text-align: right;">${storeDisplay}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>

      </div>
    `).join("");

  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger-color); padding: 20px;">Error loading stock levels: ${e.message}</div>`;
  }
}

// --- Subview 4: Shelf Visibility View ---
async function renderShelfVisibilityView(sites = []) {
  const workspace = document.getElementById("workspace-content");

  workspace.innerHTML = `
    <div class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
          <h1 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0;">Shelf Visibility</h1>
          <span id="shelf-stores-counter-badge" style="background: #E8F0FE; color: #0B57D0; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(11, 87, 208, 0.15); display: inline-flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-store" style="font-size: 11px;"></i>
            <span id="shelf-stores-counter-text">0 Stores Displaying Brand</span>
          </span>
        </div>
        <p style="font-size: 12.5px; color: #64748B; margin: 0;">Store shelf audit photos and display compliance for assigned brands (latest visit per store).</p>
      </div>

      <div style="display: flex; align-items: center; gap: 10px;">
        <select id="shelf-brand-select" style="height: 36px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 12.5px; font-weight: 600; color: #1E293B; outline: none; cursor: pointer;">
          <option value="ALL">All Assigned Brands</option>
        </select>
        <input type="text" id="shelf-search-input" placeholder="Search store..." style="height: 36px; padding: 0 12px; border: 1px solid var(--border-color); border-radius: 8px; background: #FFFFFF; font-size: 12.5px; outline: none; width: 180px;" />
      </div>
    </div>

    <div class="content-body" id="shelf-content-body" style="overflow-y: auto;">
      <div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent-color);"></i></div>
    </div>
  `;

  await loadShelfVisibilityData();
}

async function loadShelfVisibilityData() {
  const container = document.getElementById("shelf-content-body");
  const brandSelect = document.getElementById("shelf-brand-select");
  const searchInput = document.getElementById("shelf-search-input");
  if (!container) return;

  try {
    const res = await apiRequest("/api/tenant/shelf-visibility");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server responded with status ${res.status}`);
    }
    const data = await res.json();
    const rawLogs = (data.logs || []).slice();
    // Sort all by latest visit first
    rawLogs.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0));

    // Deduplicate: Keep only the latest visit per store (and per brand)
    const latestStoreAuditsMap = new Map();
    rawLogs.forEach(log => {
      const storeKey = `${log.retailer_stores_id || log.store_id || log.store_name}_${log.brands_id || log.brand_id || ""}`;
      if (!latestStoreAuditsMap.has(storeKey)) {
        latestStoreAuditsMap.set(storeKey, log);
      }
    });
    const logs = Array.from(latestStoreAuditsMap.values());
    const brands = data.brands || [];

    // Populate brand select if empty
    if (brandSelect && brandSelect.options.length <= 1) {
      brands.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.innerText = b.display_name || b.Name || b.id;
        brandSelect.appendChild(opt);
      });
    }

    const renderFilteredGallery = () => {
      const selectedBrand = brandSelect?.value || "ALL";
      const searchWords = (searchInput?.value || "").toLowerCase().trim().split(/\s+/).filter(Boolean);

      const filtered = logs.filter(l => {
        const matchBrand = selectedBrand === "ALL" || String(l.brands_id) === selectedBrand;
        if (!matchBrand) return false;
        if (searchWords.length === 0) return true;

        // Build comprehensive searchable corpus
        const displayRetailer = l.retailer_name || 
          (l.store_name?.toUpperCase().includes("FAIRPRICE") ? "FairPrice" : 
           l.store_name?.toUpperCase().includes("SHENG SIONG") ? "Sheng Siong" : 
           l.store_name?.toUpperCase().includes("GIANT") ? "Giant" : 
           l.store_name?.toUpperCase().includes("COLD STORAGE") ? "Cold Storage" : 
           l.store_name?.toUpperCase().includes("PRIME") ? "Prime Supermarket" : "");

        const searchable = [
          displayRetailer,
          l.retailer_name || "",
          l.store_name || "",
          l.store_address || "",
          l.postal_code || "",
          l.brand_name || "",
          String(l.retailer_stores_id || "")
        ].join(" ").toLowerCase();

        // Word-by-word matching: all entered words must exist in the record
        return searchWords.every(word => searchable.includes(word));
      });

      // Update total stores counter on top
      const counterText = document.getElementById("shelf-stores-counter-text");
      if (counterText) {
        counterText.textContent = `${filtered.length} Store${filtered.length === 1 ? '' : 's'} Displaying Brand`;
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; font-size: 22px; margin: 0 auto 14px;">
              <i class="fa-solid fa-eye-slash"></i>
            </div>
            <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">No Shelf Audits Found</h4>
            <p style="font-size: 12.5px; color: #64748B; max-width: 360px; margin: 0 auto;">No shelf audit records match the current filter.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding-bottom: 24px;">
          ${filtered.map(item => {
            const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : "";
            const displayRetailer = item.retailer_name || 
              (item.store_name?.toUpperCase().includes("FAIRPRICE") ? "FairPrice" : 
               item.store_name?.toUpperCase().includes("SHENG SIONG") ? "Sheng Siong" : 
               item.store_name?.toUpperCase().includes("GIANT") ? "Giant" : 
               item.store_name?.toUpperCase().includes("COLD STORAGE") ? "Cold Storage" : 
               item.store_name?.toUpperCase().includes("PRIME") ? "Prime Supermarket" : "");

            return `
              <div class="shelf-photo-card" style="border: 1px solid var(--border-color); border-radius: 14px; background: #FFFFFF; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                
                <!-- Photo Container (Click to Zoom) -->
                <div class="shelf-photo-thumb" data-url="${item.image_link || ''}" style="width: 100%; aspect-ratio: 4/3; background: #F1F5F9; position: relative; overflow: hidden; cursor: pointer;">
                  ${item.image_link ? `
                    <img src="${item.image_link}" alt="${item.store_name}" onerror="this.onerror=null; this.style.display='none'; this.nextElementSibling.style.display='flex';" style="width: 100%; height: 100%; object-fit: cover; transition: transform 0.2s ease;" />
                    <div class="img-fallback" style="display: none; width: 100%; height: 100%; flex-direction: column; align-items: center; justify-content: center; background: #F1F5F9; color: #94A3B8; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; gap: 6px;">
                      <i class="fa-solid fa-image" style="font-size: 24px; color: #CBD5E1;"></i>
                      <span>No Image</span>
                    </div>
                  ` : `
                    <div style="width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #F1F5F9; color: #94A3B8; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; gap: 6px;">
                      <i class="fa-solid fa-image" style="font-size: 24px; color: #CBD5E1;"></i>
                      <span>No Image</span>
                    </div>
                  `}
                  <span style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.65); color: #fff; font-size: 11px; padding: 4px 6px; border-radius: 6px; display: flex; align-items: center; justify-content: center;">
                    <i class="fa-solid fa-magnifying-glass-plus"></i>
                  </span>
                </div>

                <!-- Info Body -->
                <div style="padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; flex: 1; box-sizing: border-box;">
                  <!-- Top Row: Brand Badge + Visit Date -->
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 2px;">
                    <span style="background: #EBF2FE; color: #0B57D0; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.03em; text-transform: uppercase; border: 1px solid rgba(11, 87, 208, 0.12);">
                      ${item.brand_name}
                    </span>
                    <span style="font-size: 11px; color: #64748B; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
                      <i class="fa-regular fa-calendar" style="font-size: 10.5px; opacity: 0.8;"></i> ${dateStr}
                    </span>
                  </div>

                  <!-- Retailer Title -->
                  ${displayRetailer ? `
                    <h4 style="font-size: 13.5px; font-weight: 700; color: #0F172A; margin: 2px 0 0 0; line-height: 1.25; text-transform: uppercase; letter-spacing: -0.01em;">
                      ${displayRetailer}
                    </h4>
                  ` : ""}

                  <!-- Store Branch / Code -->
                  <div style="font-size: 12px; font-weight: ${displayRetailer ? '600' : '700'}; color: ${displayRetailer ? '#475569' : '#0F172A'}; line-height: 1.3;">
                    ${item.store_name}
                  </div>

                  <!-- Store Address -->
                  ${item.store_address ? `
                    <p style="font-size: 11px; color: #64748B; margin: 1px 0 0 0; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      ${item.store_address}
                    </p>
                  ` : ""}
                </div>

              </div>
            `;
          }).join("")}
        </div>
      `;

      // Bind Lightbox click on photos
      container.querySelectorAll(".shelf-photo-thumb").forEach(thumb => {
        thumb.addEventListener("click", () => {
          const imgUrl = thumb.getAttribute("data-url");
          if (!imgUrl) return;
          openPhotoLightbox(imgUrl);
        });
      });
    };

    brandSelect?.addEventListener("change", renderFilteredGallery);
    searchInput?.addEventListener("input", renderFilteredGallery);

    renderFilteredGallery();
  } catch (e) {
    container.innerHTML = `<div style="color: var(--danger-color); padding: 20px;">Error loading shelf audits.</div>`;
  }
}

// Lightbox Modal for Photo Zoom
function openPhotoLightbox(url) {
  const oldModal = document.getElementById("photo-lightbox-modal");
  if (oldModal) oldModal.remove();

  const overlay = document.createElement("div");
  overlay.id = "photo-lightbox-modal";
  overlay.style.cssText = "position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; backdrop-filter: blur(4px);";

  overlay.innerHTML = `
    <div style="position: relative; max-width: 90vw; max-height: 90vh; display: flex; align-items: center; justify-content: center;">
      <button id="close-lightbox" style="position: absolute; top: -40px; right: 0; background: none; border: none; color: #FFFFFF; font-size: 24px; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      <img src="${url}" style="max-width: 100%; max-height: 85vh; object-fit: contain; border-radius: 8px; box-shadow: 0 20px 40px rgba(0,0,0,0.5);" />
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.closest("#close-lightbox")) close();
  });
}

// --- Subview 5: Inquiries Inbox View ---
async function renderInquiriesView(sites = []) {
  const workspace = document.getElementById("workspace-content");

  workspace.innerHTML = `
    <div class="content-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 4px;">
          <h1 style="font-size: 20px; font-weight: 700; color: #0F172A; margin: 0;">Inquiries Inbox</h1>
          <span id="inquiries-counter-badge" style="background: #E8F0FE; color: #0B57D0; font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(11, 87, 208, 0.15); display: inline-flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-inbox" style="font-size: 11px;"></i>
            <span id="inquiries-counter-text">Loading inquiries...</span>
          </span>
        </div>
        <p style="font-size: 12.5px; color: #64748B; margin: 0;">Visitor contact form submissions and retail inquiry messages received across your brand websites.</p>
      </div>

      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
        <!-- Status Filter Tabs -->
        <div style="display: flex; background: #F1F5F9; padding: 3px; border-radius: 8px; border: 1px solid #E2E8F0; gap: 2px;">
          <button class="inq-filter-tab active" data-status="ALL" style="padding: 5px 12px; border-radius: 6px; border: none; background: #FFFFFF; font-size: 12px; font-weight: 600; color: #0F172A; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">All</button>
          <button class="inq-filter-tab" data-status="UNREAD" style="padding: 5px 12px; border-radius: 6px; border: none; background: transparent; font-size: 12px; font-weight: 600; color: #64748B; cursor: pointer;">Unread</button>
          <button class="inq-filter-tab" data-status="READ" style="padding: 5px 12px; border-radius: 6px; border: none; background: transparent; font-size: 12px; font-weight: 600; color: #64748B; cursor: pointer;">Read</button>
        </div>

        <!-- Site Select -->
        ${sites.length > 1 ? `
          <select id="inquiry-site-select" style="height: 34px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 12px; font-weight: 600; color: #1E293B; outline: none; cursor: pointer;">
            <option value="ALL">All Sites</option>
            ${sites.map(s => `<option value="${s.id}">${s.name || s.id}</option>`).join("")}
          </select>
        ` : ''}

        <!-- Search Input -->
        <input type="text" id="inquiry-search-input" placeholder="Search inquiries..." style="height: 34px; padding: 0 12px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; font-size: 12px; outline: none; width: 190px;" />
        
        <!-- Refresh Button -->
        <button id="btn-refresh-inquiries" class="btn-icon" title="Refresh Inbox" style="height: 34px; width: 34px; border: 1px solid #CBD5E1; border-radius: 8px; background: #FFFFFF; color: #475569; display: flex; align-items: center; justify-content: center; cursor: pointer;">
          <i class="fa-solid fa-rotate-right"></i>
        </button>
      </div>
    </div>

    <div class="content-body" id="inquiries-content-body" style="overflow-y: auto;">
      <div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px; color: var(--accent-color);"></i></div>
    </div>
  `;

  await loadInquiriesData(sites);
}

async function loadInquiriesData(sites = []) {
  const container = document.getElementById("inquiries-content-body");
  const searchInput = document.getElementById("inquiry-search-input");
  const siteSelect = document.getElementById("inquiry-site-select");
  const refreshBtn = document.getElementById("btn-refresh-inquiries");
  if (!container) return;

  try {
    const res = await apiRequest("/api/tenant/inquiries");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server responded with status ${res.status}`);
    }
    const data = await res.json();
    let inquiries = data.inquiries || [];
    let unreadCount = Number(data.unread_count || 0);

    // Update global badge
    const badge = document.getElementById("unread-inquiries-badge");
    if (badge) {
      if (unreadCount > 0) {
        badge.style.display = "inline-block";
        badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      } else {
        badge.style.display = "none";
      }
    }

    let activeFilterStatus = "ALL";

    const filterTabs = document.querySelectorAll(".inq-filter-tab");
    filterTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        filterTabs.forEach(t => {
          t.classList.remove("active");
          t.style.background = "transparent";
          t.style.color = "#64748B";
          t.style.boxShadow = "none";
        });
        tab.classList.add("active");
        tab.style.background = "#FFFFFF";
        tab.style.color = "#0F172A";
        tab.style.boxShadow = "0 1px 2px rgba(0,0,0,0.05)";
        activeFilterStatus = tab.getAttribute("data-status") || "ALL";
        renderFilteredTable();
      });
    });

    const renderFilteredTable = () => {
      const selectedSite = siteSelect?.value || "ALL";
      const searchWords = (searchInput?.value || "").toLowerCase().trim().split(/\s+/).filter(Boolean);

      const filtered = inquiries.filter(inq => {
        if (selectedSite !== "ALL" && String(inq.site_id) !== selectedSite) return false;
        if (activeFilterStatus === "UNREAD" && Number(inq.is_read) !== 0) return false;
        if (activeFilterStatus === "READ" && Number(inq.is_read) === 0) return false;

        if (searchWords.length === 0) return true;

        const corpus = [
          inq.name || "",
          inq.email || "",
          inq.phone || "",
          inq.subject || "",
          inq.message || "",
          inq.site_name || "",
          inq.site_id || ""
        ].join(" ").toLowerCase();

        return searchWords.every(w => corpus.includes(w));
      });

      // Update header counter badge
      const counterText = document.getElementById("inquiries-counter-text");
      if (counterText) {
        const curUnread = inquiries.filter(i => Number(i.is_read) === 0).length;
        counterText.textContent = `${inquiries.length} Total · ${curUnread} Unread`;
      }

      if (filtered.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 60px 20px; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 16px; margin-top: 10px;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; color: #94A3B8; display: flex; align-items: center; justify-content: center; font-size: 22px; margin: 0 auto 14px;">
              <i class="fa-solid fa-inbox"></i>
            </div>
            <h4 style="font-size: 15px; font-weight: 700; color: #1E293B; margin-bottom: 6px;">No Inquiries Found</h4>
            <p style="font-size: 12.5px; color: #64748B; max-width: 360px; margin: 0 auto;">No customer inquiries match the selected criteria.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <div class="table-container" style="max-height: calc(100vh - 220px); overflow-y: auto;">
            <table class="data-table" style="width: 100%; border-collapse: collapse; font-size: 12.5px;">
              <thead>
                <tr style="background: #F8FAFC; border-bottom: 1px solid #E2E8F0; text-align: left; color: #64748B; font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.03em;">
                  <th style="padding: 12px 14px; width: 90px;">Status</th>
                  <th style="padding: 12px 14px; width: 140px;">Site / Container</th>
                  <th style="padding: 12px 14px; width: 180px;">From</th>
                  <th style="padding: 12px 14px; width: 120px;">Phone</th>
                  <th style="padding: 12px 14px;">Subject & Message</th>
                  <th style="padding: 12px 14px; width: 130px;">Received</th>
                  <th style="padding: 12px 14px; width: 120px; text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${filtered.map(item => {
                  const isUnread = Number(item.is_read) === 0;
                  const dateStr = item.created_at ? new Date(item.created_at).toLocaleString("en-SG", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  }) : "--";

                  return `
                    <tr class="inquiry-row ${isUnread ? 'inquiry-unread' : ''}" data-id="${item.id}" style="border-bottom: 1px solid #F1F5F9; ${isUnread ? 'background: #F0F7FF;' : 'background: #FFFFFF;'}; transition: background 0.15s ease;">
                      <!-- Status -->
                      <td style="padding: 12px 14px;">
                        ${isUnread ? `
                          <span style="display: inline-flex; align-items: center; gap: 5px; background: #DBEAFE; color: #1D4ED8; font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 12px;">
                            <i class="fa-solid fa-circle" style="font-size: 6px;"></i> New
                          </span>
                        ` : `
                          <span style="display: inline-flex; align-items: center; gap: 5px; background: #F1F5F9; color: #64748B; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 12px;">
                            Read
                          </span>
                        `}
                      </td>

                      <!-- Site -->
                      <td style="padding: 12px 14px;">
                        <div style="font-weight: 700; color: #1E293B; font-size: 12px;">${item.site_name || item.site_id}</div>
                        <div style="font-size: 10.5px; font-family: monospace; color: #64748B;">/${item.site_id}</div>
                      </td>

                      <!-- From -->
                      <td style="padding: 12px 14px;">
                        <div style="font-weight: ${isUnread ? '700' : '600'}; color: #0F172A;">${item.name}</div>
                        <div style="font-size: 11px; color: #0B57D0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          <a href="mailto:${item.email}" style="color: #0B57D0; text-decoration: none;" onclick="event.stopPropagation();">${item.email}</a>
                        </div>
                      </td>

                      <!-- Phone -->
                      <td style="padding: 12px 14px; font-family: monospace; color: #475569; font-size: 12px;">
                        ${item.phone ? `<a href="tel:${item.phone}" style="color: #475569; text-decoration: none;" onclick="event.stopPropagation();">${item.phone}</a>` : '<span style="color:#94A3B8;">--</span>'}
                      </td>

                      <!-- Subject & Message -->
                      <td style="padding: 12px 14px; max-width: 320px; cursor: pointer;" class="btn-open-inquiry" data-id="${item.id}">
                        <div style="font-weight: ${isUnread ? '700' : '600'}; color: #1E293B; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          ${item.subject || 'No Subject'}
                        </div>
                        <div style="font-size: 11.5px; color: #64748B; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.3;">
                          ${item.message || ''}
                        </div>
                      </td>

                      <!-- Received -->
                      <td style="padding: 12px 14px; font-size: 11.5px; color: #64748B; white-space: nowrap;">
                        ${dateStr}
                      </td>

                      <!-- Actions -->
                      <td style="padding: 12px 14px; text-align: right;">
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                          <!-- View -->
                          <button class="btn-icon btn-open-inquiry" data-id="${item.id}" title="View Inquiry" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #CBD5E1; background: #FFFFFF; color: #0B57D0; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                            <i class="fa-solid fa-eye" style="font-size: 11.5px;"></i>
                          </button>
                          <!-- Toggle Read -->
                          <button class="btn-icon btn-toggle-read" data-id="${item.id}" data-unread="${isUnread ? '1' : '0'}" title="${isUnread ? 'Mark as Read' : 'Mark as Unread'}" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #CBD5E1; background: #FFFFFF; color: #64748B; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                            <i class="${isUnread ? 'fa-regular fa-envelope-open' : 'fa-regular fa-envelope'}" style="font-size: 11.5px;"></i>
                          </button>
                          <!-- Delete -->
                          <button class="btn-icon btn-delete-inquiry" data-id="${item.id}" title="Delete Inquiry" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #CBD5E1; background: #FFFFFF; color: #EF4444; display: flex; align-items: center; justify-content: center; cursor: pointer;">
                            <i class="fa-solid fa-trash-can" style="font-size: 11.5px;"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Bind row actions
      container.querySelectorAll(".btn-open-inquiry").forEach(btn => {
        btn.addEventListener("click", () => {
          const inqId = btn.getAttribute("data-id");
          const item = inquiries.find(i => String(i.id) === String(inqId));
          if (item) {
            openInquiryDetailModal(item, async (updatedItem) => {
              // Automatically update read status in state
              if (Number(item.is_read) === 0) {
                item.is_read = 1;
                try {
                  await apiRequest(`/api/tenant/inquiries/${item.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ is_read: 1 })
                  });
                } catch {}
              }
              renderFilteredTable();
            }, async (deletedId) => {
              inquiries = inquiries.filter(i => String(i.id) !== String(deletedId));
              renderFilteredTable();
            });
          }
        });
      });

      container.querySelectorAll(".btn-toggle-read").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const inqId = btn.getAttribute("data-id");
          const item = inquiries.find(i => String(i.id) === String(inqId));
          if (!item) return;

          const newIsRead = Number(item.is_read) === 0 ? 1 : 0;
          item.is_read = newIsRead;
          renderFilteredTable();

          try {
            await apiRequest(`/api/tenant/inquiries/${inqId}`, {
              method: "PATCH",
              body: JSON.stringify({ is_read: newIsRead })
            });
            showToast(newIsRead === 1 ? "Marked as read." : "Marked as unread.");
          } catch {
            showToast("Failed to update status.", "danger");
          }
        });
      });

      container.querySelectorAll(".btn-delete-inquiry").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const inqId = btn.getAttribute("data-id");
          if (!confirm("Are you sure you want to permanently delete this inquiry?")) return;

          inquiries = inquiries.filter(i => String(i.id) !== String(inqId));
          renderFilteredTable();

          try {
            const delRes = await apiRequest(`/api/tenant/inquiries/${inqId}`, { method: "DELETE" });
            if (delRes.ok) {
              showToast("Inquiry deleted.");
            } else {
              showToast("Failed to delete inquiry.", "danger");
            }
          } catch {
            showToast("Network error deleting inquiry.", "danger");
          }
        });
      });
    };

    searchInput?.addEventListener("input", renderFilteredTable);
    siteSelect?.addEventListener("change", renderFilteredTable);
    refreshBtn?.addEventListener("click", () => loadInquiriesData(sites));

    renderFilteredTable();

  } catch (err) {
    container.innerHTML = `<div style="color: var(--danger-color); padding: 20px;">Error loading inquiries: ${err.message}</div>`;
  }
}

// Inquiry Message Detail Modal
function openInquiryDetailModal(inquiry, onReadCallback, onDeleteCallback) {
  const oldModal = document.getElementById("inquiry-detail-overlay");
  if (oldModal) oldModal.remove();

  const overlay = document.createElement("div");
  overlay.id = "inquiry-detail-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  const dateStr = inquiry.created_at ? new Date(inquiry.created_at).toLocaleString("en-SG", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }) : "--";

  const mailtoUrl = `mailto:${encodeURIComponent(inquiry.email)}?subject=${encodeURIComponent("Re: " + (inquiry.subject || "Website Inquiry"))}`;

  overlay.innerHTML = `
    <div id="inquiry-detail-card" style="
      width: 580px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; background: #ffffff;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <h3 style="margin: 0; font-size: 17px; font-weight: 700; color: #0f172a;">${inquiry.subject || "Website Inquiry"}</h3>
          </div>
          <p style="margin: 0; font-size: 12px; color: #64748b;">Received via <strong>${inquiry.site_name || inquiry.site_id}</strong> (${inquiry.site_id}) · ${dateStr}</p>
        </div>
        <button id="btn-close-inq-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 4px;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Contact Meta Card -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12.5px;">
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 2px;">Sender Name</div>
            <div style="font-weight: 700; color: #0F172A;">${inquiry.name}</div>
          </div>
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 2px;">Email Address</div>
            <div><a href="mailto:${inquiry.email}" style="color: #0B57D0; font-weight: 600; text-decoration: none;">${inquiry.email}</a></div>
          </div>
          ${inquiry.phone ? `
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 2px;">Phone Number</div>
            <div><a href="tel:${inquiry.phone}" style="color: #0F172A; font-weight: 600; font-family: monospace; text-decoration: none;">${inquiry.phone}</a></div>
          </div>` : ''}
          <div>
            <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 2px;">Status</div>
            <div>
              <span style="display: inline-flex; align-items: center; gap: 5px; background: #DBEAFE; color: #1D4ED8; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px;">
                <i class="fa-solid fa-circle" style="font-size: 5px;"></i> Saved in Inbox
              </span>
            </div>
          </div>
        </div>

        <!-- Full Message Content Box -->
        <div>
          <div style="font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.04em;">Message Content</div>
          <div style="background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 10px; padding: 16px; font-size: 13.5px; color: #1E293B; line-height: 1.65; white-space: pre-wrap; word-break: break-word; min-height: 100px;">
            ${(inquiry.message || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
        <button class="btn btn-danger" id="btn-modal-delete-inq" style="height: 36px; padding: 0 14px; border-radius: 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; background-color: #EF4444; color: white; border: none;">
          <i class="fa-solid fa-trash-can"></i> Delete
        </button>
        <div style="display: flex; gap: 10px;">
          <button class="btn btn-secondary" id="btn-modal-close-inq" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Close</button>
          <a href="${mailtoUrl}" target="_blank" class="btn btn-primary" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600; text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
            <i class="fa-solid fa-reply"></i> Reply via Email
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("inquiry-detail-card").style.transform = "scale(1)";
  });

  // Call onReadCallback so it marks as read
  if (onReadCallback) onReadCallback(inquiry);

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("inquiry-detail-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-inq-modal").addEventListener("click", closeModal);
  document.getElementById("btn-modal-close-inq").addEventListener("click", closeModal);

  document.getElementById("btn-modal-delete-inq").addEventListener("click", async () => {
    if (!confirm("Are you sure you want to delete this inquiry?")) return;
    try {
      await apiRequest(`/api/tenant/inquiries/${inquiry.id}`, { method: "DELETE" });
      showToast("Inquiry deleted.");
      if (onDeleteCallback) onDeleteCallback(inquiry.id);
      closeModal();
    } catch {
      showToast("Failed to delete inquiry.", "danger");
    }
  });
}

// --- Subview: Posts & News Management ---
async function renderPostsView(sites = []) {
  const workspace = document.getElementById("workspace-content");
  if (!workspace) return;

  workspace.innerHTML = `
    <div style="display: flex; flex-direction: column; height: 100%; gap: 16px; box-sizing: border-box;">
      
      <!-- Top Bar: Title & Primary Actions -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 12px; padding: 16px 20px;">
        <div>
          <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #0F172A; display: flex; align-items: center; gap: 10px;">
            <i class="fa-solid fa-newspaper" style="color: #0B57D0;"></i> Posts & News Management
          </h2>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748B;">
            Publish blog articles, announcements, promotions, and event galleries with multi-photo albums.
          </p>
        </div>

        <button class="btn btn-primary" id="btn-create-new-post" style="height: 38px; padding: 0 16px; border-radius: 8px; font-size: 13px; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-plus"></i> Create Post
        </button>
      </div>

      <!-- Filters Row -->
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 12px; padding: 12px 16px;">
        <!-- Search Input -->
        <div style="position: relative; flex: 1; min-width: 220px;">
          <i class="fa-solid fa-magnifying-glass" style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 12px; color: #94A3B8;"></i>
          <input type="text" id="post-search-filter" placeholder="Search by title, author, or keyword..." style="width: 100%; height: 36px; padding: 0 12px 0 34px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

        <!-- Site Filter Dropdown -->
        <div style="min-width: 180px;">
          <select id="post-site-filter" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
            <option value="ALL">All Managed Sites</option>
            ${sites.map(s => `<option value="${s.id}">${s.name || s.id} (${s.id})</option>`).join("")}
          </select>
        </div>

        <!-- Category Filter -->
        <div style="min-width: 140px;">
          <select id="post-category-filter" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
            <option value="ALL">All Categories</option>
            <option value="Event">Event</option>
            <option value="News">News</option>
            <option value="Announcement">Announcement</option>
            <option value="Promotion">Promotion</option>
            <option value="Recipe">Recipe</option>
            <option value="Press">Press</option>
            <option value="General">General</option>
          </select>
        </div>

        <!-- Status Filter -->
        <div style="min-width: 130px;">
          <select id="post-status-filter" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #CBD5E1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
            <option value="ALL">All Status</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </div>
      </div>

      <!-- Posts List Container -->
      <div id="posts-container" style="flex: 1; overflow-y: auto; background: #FFFFFF; border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; box-sizing: border-box;">
        <div style="text-align: center; padding: 40px; color: #94A3B8; font-size: 13px;">
          <i class="fa-solid fa-spinner fa-spin" style="font-size: 20px; color: #0B57D0; margin-bottom: 8px;"></i>
          <p>Loading posts...</p>
        </div>
      </div>

    </div>
  `;

  let allPosts = [];

  const loadPosts = async () => {
    const container = document.getElementById("posts-container");
    if (!container) return;

    try {
      const siteVal = document.getElementById("post-site-filter")?.value || "ALL";
      const endpoint = siteVal !== "ALL" ? `/api/tenant/posts?site_id=${siteVal}` : "/api/tenant/posts";
      const res = await apiRequest(endpoint);
      if (res.ok) {
        allPosts = await res.json();
      } else {
        allPosts = [];
      }
      renderFilteredPosts();
    } catch {
      allPosts = [];
      renderFilteredPosts();
    }
  };

  const renderFilteredPosts = () => {
    const container = document.getElementById("posts-container");
    if (!container) return;

    const searchTerm = (document.getElementById("post-search-filter")?.value || "").toLowerCase().trim();
    const catVal = document.getElementById("post-category-filter")?.value || "ALL";
    const statusVal = document.getElementById("post-status-filter")?.value || "ALL";
    const siteVal = document.getElementById("post-site-filter")?.value || "ALL";

    let filtered = allPosts.filter(p => {
      if (siteVal !== "ALL" && p.site_id !== siteVal) return false;
      if (catVal !== "ALL" && p.category !== catVal) return false;
      if (statusVal !== "ALL" && (p.status || "published") !== statusVal) return false;
      if (searchTerm) {
        const titleMatch = (p.title || "").toLowerCase().includes(searchTerm);
        const contentMatch = (p.content || "").toLowerCase().includes(searchTerm);
        const authorMatch = (p.author || "").toLowerCase().includes(searchTerm);
        if (!titleMatch && !contentMatch && !authorMatch) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 300px; text-align: center; color: #94A3B8;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: #F1F5F9; display: flex; align-items: center; justify-content: center; font-size: 22px; color: #64748B; margin-bottom: 12px;">
            <i class="fa-solid fa-file-circle-plus"></i>
          </div>
          <h4 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #1E293B;">No Posts Found</h4>
          <p style="margin: 0; font-size: 12.5px; color: #64748B; max-width: 320px;">
            No articles match your current filters. Click "Create Post" to publish a new event or article.
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px;">
        ${filtered.map(post => {
          const dateStr = post.created_at ? new Date(Number(post.created_at)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : "-";
          const photos = Array.isArray(post.photos) ? post.photos : [];
          const isDraft = post.status === "draft";
          const coverImg = post.cover_image || (photos[0] || "");

          return `
            <div class="post-item-row" data-id="${post.id}" style="display: flex; align-items: center; gap: 16px; padding: 14px 16px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 10px; transition: border-color 0.15s ease, box-shadow 0.15s ease; justify-content: space-between;">
              
              <!-- Left: Cover Thumb + Post Info -->
              <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0;">
                <div style="width: 72px; height: 54px; border-radius: 6px; overflow: hidden; background: #F1F5F9; border: 1px solid #E2E8F0; flex-shrink: 0; display: flex; align-items: center; justify-content: center;">
                  ${coverImg ? `<img src="${coverImg}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<i class="fa-regular fa-image" style="color: #94A3B8; font-size: 18px;"></i>`}
                </div>

                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
                  <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 10.5px; font-weight: 700; color: #0B57D0; background: #EBF2FE; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">
                      ${post.category || 'Event'}
                    </span>
                    <span style="font-size: 11px; color: #475569; background: #F1F5F9; padding: 2px 7px; border-radius: 4px; font-weight: 600;">
                      <i class="fa-solid fa-globe" style="font-size: 9.5px; margin-right: 3px;"></i>${post.site_name || post.site_id}
                    </span>
                    ${photos.length > 0 ? `
                      <span style="font-size: 11px; color: #059669; background: #ECFDF5; padding: 2px 7px; border-radius: 4px; font-weight: 600;">
                        <i class="fa-solid fa-images" style="font-size: 9.5px; margin-right: 3px;"></i>${photos.length} Photos
                      </span>
                    ` : ''}
                    <span style="font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; ${isDraft ? 'background: #F1F5F9; color: #64748B;' : 'background: #DCFCE7; color: #166534;'}">
                      ${isDraft ? 'Draft' : 'Published'}
                    </span>
                  </div>

                  <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: #0F172A; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    ${post.title}
                  </h4>

                  <div style="display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: #64748B;">
                    <span><i class="fa-regular fa-calendar" style="margin-right: 4px;"></i>${dateStr}</span>
                    ${post.author ? `<span><i class="fa-regular fa-user" style="margin-right: 4px;"></i>${post.author}</span>` : ''}
                    ${post.excerpt ? `<span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; color: #94A3B8;">— ${post.excerpt}</span>` : ''}
                  </div>
                </div>
              </div>

              <!-- Right: Actions -->
              <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                <button class="btn btn-secondary btn-preview-post" data-id="${post.id}" style="height: 32px; padding: 0 10px; font-size: 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="Preview Article">
                  <i class="fa-solid fa-eye"></i> Preview
                </button>
                <button class="btn btn-secondary btn-edit-post" data-id="${post.id}" style="height: 32px; padding: 0 10px; font-size: 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="Edit Post">
                  <i class="fa-solid fa-pen-to-square"></i> Edit
                </button>
                <button class="btn btn-danger btn-delete-post" data-id="${post.id}" style="height: 32px; padding: 0 10px; font-size: 12px; border-radius: 6px; background-color: #FEE2E2; color: #DC2626; border: 1px solid #FECACA; display: inline-flex; align-items: center; gap: 5px;" title="Delete Post">
                  <i class="fa-solid fa-trash-can"></i>
                </button>
              </div>

            </div>
          `;
        }).join("")}
      </div>
    `;

    // Bind Action Handlers
    container.querySelectorAll(".btn-preview-post").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const p = allPosts.find(x => x.id === id);
        if (p) openPostPreviewModal(p);
      });
    });

    container.querySelectorAll(".btn-edit-post").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const p = allPosts.find(x => x.id === id);
        if (p) openPostEditorModal(p, p.site_id, sites, loadPosts);
      });
    });

    container.querySelectorAll(".btn-delete-post").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        if (!confirm("Are you sure you want to delete this post?")) return;
        try {
          await apiRequest(`/api/tenant/posts/${id}`, { method: "DELETE" });
          showToast("Post deleted successfully.");
          loadPosts();
        } catch {
          showToast("Failed to delete post.", "danger");
        }
      });
    });
  };

  document.getElementById("btn-create-new-post")?.addEventListener("click", () => {
    const defaultSite = sites[0]?.id || "main";
    openPostEditorModal(null, defaultSite, sites, loadPosts);
  });

  document.getElementById("post-search-filter")?.addEventListener("input", renderFilteredPosts);
  document.getElementById("post-category-filter")?.addEventListener("change", renderFilteredPosts);
  document.getElementById("post-status-filter")?.addEventListener("change", renderFilteredPosts);
  document.getElementById("post-site-filter")?.addEventListener("change", loadPosts);

  loadPosts();
}

// --- Post Editor Modal (Rich Text Visual Editor + Event Photo Album) ---
async function openPostEditorModal(post = null, defaultSiteId = "main", sites = [], onSaveCallback = null) {
  const isEditing = !!post;
  let currentPhotos = post && Array.isArray(post.photos) ? [...post.photos] : [];
  let coverImageUrl = post?.cover_image || (currentPhotos[0] || "");

  const overlay = document.createElement("div");
  overlay.id = "post-editor-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="post-editor-modal-card" style="
      width: 760px;
      max-width: 95%;
      max-height: 92vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;">
            <i class="fa-solid fa-newspaper" style="margin-right: 8px; color: #0B57D0;"></i>
            ${isEditing ? 'Edit Post / Article' : 'Create New Post / Event'}
          </h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">
            Compose article story, insert inline images, attach event photo albums, and publish to website.
          </p>
        </div>
        <button id="btn-close-post-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Row 1: Title -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Post Title *</label>
          <input type="text" id="post-title" value="${(post?.title || '').replace(/"/g, '&quot;')}" placeholder="e.g. Grand Product Launch & Cooking Masterclass" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13.5px; font-weight: 600; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

        <!-- Row 2: Site, Category, Status -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
          <div>
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Assign to Site *</label>
            <select id="post-site" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              ${sites.map(s => `<option value="${s.id}" ${(post?.site_id || defaultSiteId) === s.id ? 'selected' : ''}>${s.name || s.id} (${s.id})</option>`).join("")}
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Category</label>
            <select id="post-category" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              <option value="Event" ${post?.category === "Event" ? 'selected' : ''}>🎉 Event</option>
              <option value="News" ${post?.category === "News" ? 'selected' : ''}>📢 News</option>
              <option value="Promotion" ${post?.category === "Promotion" ? 'selected' : ''}>🏷️ Promotion</option>
              <option value="Announcement" ${post?.category === "Announcement" ? 'selected' : ''}>📣 Announcement</option>
              <option value="Recipe" ${post?.category === "Recipe" ? 'selected' : ''}>🍳 Recipe</option>
              <option value="Press" ${post?.category === "Press" ? 'selected' : ''}>📰 Press Release</option>
              <option value="General" ${post?.category === "General" ? 'selected' : ''}>📌 General</option>
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Publish Status</label>
            <select id="post-status" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              <option value="published" ${(post?.status || 'published') === 'published' ? 'selected' : ''}>🟢 Published</option>
              <option value="draft" ${post?.status === 'draft' ? 'selected' : ''}>⚪ Draft</option>
            </select>
          </div>
        </div>

        <!-- Featured Cover Image Section -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #1E293B; margin-bottom: 8px;">
            <i class="fa-solid fa-image" style="color: #0B57D0;"></i> Featured Cover Photo (Card Thumbnail)
          </label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="file" id="cover-file-input" accept="image/*" style="display: none;" />
            <button type="button" class="btn btn-secondary" id="btn-upload-cover" style="height: 36px; padding: 0 12px; font-size: 12px; font-weight: 600; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer;">
              <i class="fa-solid fa-cloud-arrow-up" style="color: #0B57D0;"></i> <span id="cover-upload-text">Upload Cover</span>
            </button>
            <input type="text" id="cover-image-url" value="${coverImageUrl}" placeholder="Or paste image URL..." style="flex: 1; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; outline: none; background: #fff; min-width: 0;" />
            <div id="cover-preview-box" style="width: 52px; height: 36px; border-radius: 6px; border: 1px solid #CBD5E1; overflow: hidden; background: #E2E8F0; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${coverImageUrl ? `<img src="${coverImageUrl}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<i class="fa-regular fa-image" style="font-size: 14px; color: #94A3B8;"></i>`}
            </div>
          </div>
        </div>

        <!-- 📸 Multi-Photo Event Album Gallery Section -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; font-weight: 700; color: #1E293B; text-transform: uppercase;">
              <i class="fa-solid fa-images" style="color: #0B57D0; margin-right: 6px;"></i>Event Photo Album (<span id="event-photo-count">${currentPhotos.length}</span> Photos)
            </span>
            <span style="font-size: 11px; color: #64748B;">Upload multiple photos for interactive event gallery</span>
          </div>

          <!-- Add Photo Controls -->
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="file" id="event-photos-file-input" accept="image/*" multiple style="display: none;" />
            <button type="button" class="btn btn-primary" id="btn-upload-event-photos" style="height: 34px; padding: 0 12px; font-size: 12px; font-weight: 600; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer;">
              <i class="fa-solid fa-cloud-arrow-up"></i> <span id="event-upload-text">Upload Photos</span>
            </button>
            <input type="text" id="event-photo-url-input" placeholder="Or paste photo URL..." style="flex: 1; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; outline: none; background: #fff; min-width: 0;" />
            <button type="button" class="btn btn-secondary" id="btn-add-event-photo-url" style="height: 34px; padding: 0 12px; font-size: 12px; font-weight: 600; border-radius: 8px; white-space: nowrap; cursor: pointer;">
              <i class="fa-solid fa-plus"></i> Add Link
            </button>
          </div>

          <!-- Photo Album Grid / Strip -->
          <div id="event-photos-list" style="display: flex; gap: 10px; overflow-x: auto; padding: 6px 2px; min-height: 80px; align-items: center; box-sizing: border-box;">
            <!-- Rendered dynamically -->
          </div>
        </div>

        <!-- 📄 Article Story / Content (Rich Text Visual Editor) -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="font-size: 11.5px; font-weight: 700; color: #475569;">Article Story / Content *</label>
            <span style="font-size: 11px; color: #64748B;">Use toolbar to format text & insert inline images</span>
          </div>

          <!-- Rich Formatting Toolbar -->
          <div style="display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; background: #F1F5F9; border: 1px solid #CBD5E1; border-bottom: none; border-radius: 8px 8px 0 0; align-items: center;">
            <button type="button" class="rte-btn" data-cmd="bold" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; font-weight: 700; cursor: pointer;" title="Bold"><strong>B</strong></button>
            <button type="button" class="rte-btn" data-cmd="italic" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; font-style: italic; cursor: pointer;" title="Italic"><em>I</em></button>
            <button type="button" class="rte-btn" data-cmd="underline" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; text-decoration: underline; cursor: pointer;" title="Underline"><u>U</u></button>
            <span style="width: 1px; height: 18px; background: #CBD5E1; margin: 0 2px;"></span>
            <button type="button" class="rte-btn" data-cmd="formatBlock" data-val="<h2>" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;" title="Heading 2">H2</button>
            <button type="button" class="rte-btn" data-cmd="formatBlock" data-val="<h3>" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 11px; font-weight: 700; cursor: pointer;" title="Heading 3">H3</button>
            <span style="width: 1px; height: 18px; background: #CBD5E1; margin: 0 2px;"></span>
            <button type="button" class="rte-btn" data-cmd="insertUnorderedList" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; cursor: pointer;" title="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
            <button type="button" class="rte-btn" data-cmd="insertOrderedList" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; cursor: pointer;" title="Numbered List"><i class="fa-solid fa-list-ol"></i></button>
            <button type="button" class="rte-btn" data-cmd="formatBlock" data-val="<blockquote>" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; cursor: pointer;" title="Quote"><i class="fa-solid fa-quote-left"></i></button>
            <button type="button" id="btn-insert-link" style="padding: 4px 8px; border: 1px solid #E2E8F0; background: #fff; border-radius: 4px; font-size: 12px; cursor: pointer;" title="Insert Link"><i class="fa-solid fa-link"></i></button>
            <span style="width: 1px; height: 18px; background: #CBD5E1; margin: 0 2px;"></span>
            
            <!-- Insert Inline Image Button -->
            <input type="file" id="inline-img-file-input" accept="image/*" style="display: none;" />
            <button type="button" id="btn-insert-inline-img" style="padding: 4px 10px; border: 1px solid #0B57D0; background: #EBF2FE; color: #0B57D0; border-radius: 4px; font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 5px;" title="Insert Inline Image into Story">
              <i class="fa-solid fa-image"></i> Insert Image
            </button>
          </div>

          <!-- Contenteditable Container -->
          <div id="post-content-editor" contenteditable="true" style="min-height: 220px; max-height: 360px; overflow-y: auto; padding: 14px 16px; border: 1px solid #CBD5E1; border-radius: 0 0 8px 8px; font-size: 13.5px; line-height: 1.65; color: #1E293B; background: #FFFFFF; outline: none;">${post?.content || '<p>Write your event story or article details here...</p>'}</div>
        </div>

        <!-- Excerpt / Summary -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Short Summary / Excerpt</label>
          <textarea id="post-excerpt" rows="2" placeholder="Brief 1-2 sentence teaser shown on post cards..." style="width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box; resize: vertical;">${post?.excerpt || ''}</textarea>
        </div>

        <!-- Author Name -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Author Name</label>
          <input type="text" id="post-author" value="${post?.author || currentUser?.displayName || currentUser?.email || 'HSG Global'}" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-post-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-post-modal" style="height: 36px; padding: 0 20px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save & Publish Post</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("post-editor-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("post-editor-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-post-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-post-modal").addEventListener("click", closeModal);

  // Cover Image update & preview
  const coverUrlInput = document.getElementById("cover-image-url");
  const coverPreviewBox = document.getElementById("cover-preview-box");
  const coverFileInput = document.getElementById("cover-file-input");
  const btnUploadCover = document.getElementById("btn-upload-cover");
  const coverUploadText = document.getElementById("cover-upload-text");

  const updateCoverPreview = () => {
    const url = coverUrlInput.value.trim();
    if (url) {
      coverPreviewBox.innerHTML = `<img src="${url}" style="width:100%; height:100%; object-fit:cover;" />`;
    } else {
      coverPreviewBox.innerHTML = `<i class="fa-regular fa-image" style="font-size:14px; color:#94A3B8;"></i>`;
    }
  };

  coverUrlInput.addEventListener("input", updateCoverPreview);

  btnUploadCover.addEventListener("click", (e) => {
    e.preventDefault();
    coverFileInput.click();
  });

  coverFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    coverUploadText.innerText = "Uploading...";
    btnUploadCover.disabled = true;

    try {
      let token = "";
      if (auth && auth.currentUser) token = await auth.currentUser.getIdToken();
      const siteId = document.getElementById("post-site").value || defaultSiteId;
      const filename = `posts/${siteId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
        body: await file.arrayBuffer()
      });

      if (res.ok) {
        const data = await res.json();
        if (data.url) {
          coverUrlInput.value = data.url;
          updateCoverPreview();
          showToast("Cover photo uploaded.");
        }
      } else {
        const base64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); });
        coverUrlInput.value = base64;
        updateCoverPreview();
      }
    } catch {
      showToast("Upload failed.", "danger");
    } finally {
      coverUploadText.innerText = "Upload Cover";
      btnUploadCover.disabled = false;
      coverFileInput.value = "";
    }
  });

  // Render Event Photo Album Strip
  const photosListContainer = document.getElementById("event-photos-list");
  const photoCountSpan = document.getElementById("event-photo-count");

  const renderPhotosStrip = () => {
    photoCountSpan.innerText = currentPhotos.length;
    if (currentPhotos.length === 0) {
      photosListContainer.innerHTML = `
        <div style="padding: 12px 16px; color: #94A3B8; font-size: 12px; border: 1.5px dashed #CBD5E1; border-radius: 8px; width: 100%; text-align: center; background: #fff;">
          <i class="fa-solid fa-images" style="margin-right: 6px;"></i> No event photos attached yet.
        </div>
      `;
      return;
    }

    photosListContainer.innerHTML = currentPhotos.map((url, idx) => `
      <div style="position: relative; width: 68px; height: 52px; border-radius: 6px; overflow: hidden; border: 1px solid #CBD5E1; flex-shrink: 0; background: #000;">
        <img src="${url}" style="width: 100%; height: 100%; object-fit: cover;" />
        
        <!-- Action Overlay -->
        <div style="position: absolute; inset: 0; background: rgba(0,0,0,0.5); opacity: 0; hover:opacity: 1; display: flex; align-items: center; justify-content: center; gap: 4px; transition: opacity 0.15s ease;" onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0'">
          ${idx > 0 ? `<button type="button" class="btn-album-left" data-idx="${idx}" style="background:none; border:none; color:#fff; cursor:pointer; font-size:10px; padding:2px;"><i class="fa-solid fa-arrow-left"></i></button>` : ''}
          <button type="button" class="btn-album-del" data-idx="${idx}" style="background:none; border:none; color:#EF4444; cursor:pointer; font-size:11px; padding:2px;"><i class="fa-solid fa-trash"></i></button>
          ${idx < currentPhotos.length - 1 ? `<button type="button" class="btn-album-right" data-idx="${idx}" style="background:none; border:none; color:#fff; cursor:pointer; font-size:10px; padding:2px;"><i class="fa-solid fa-arrow-right"></i></button>` : ''}
        </div>
      </div>
    `).join("");

    photosListContainer.querySelectorAll(".btn-album-left").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        if (i > 0) {
          const t = currentPhotos[i]; currentPhotos[i] = currentPhotos[i - 1]; currentPhotos[i - 1] = t;
          renderPhotosStrip();
        }
      });
    });

    photosListContainer.querySelectorAll(".btn-album-right").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        if (i < currentPhotos.length - 1) {
          const t = currentPhotos[i]; currentPhotos[i] = currentPhotos[i + 1]; currentPhotos[i + 1] = t;
          renderPhotosStrip();
        }
      });
    });

    photosListContainer.querySelectorAll(".btn-album-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        currentPhotos.splice(i, 1);
        renderPhotosStrip();
      });
    });
  };

  renderPhotosStrip();

  // Add event photos by link
  const photoUrlInput = document.getElementById("event-photo-url-input");
  document.getElementById("btn-add-event-photo-url").addEventListener("click", () => {
    const u = photoUrlInput.value.trim();
    if (!u) return;
    currentPhotos.push(u);
    if (!coverUrlInput.value.trim()) {
      coverUrlInput.value = u;
      updateCoverPreview();
    }
    photoUrlInput.value = "";
    renderPhotosStrip();
  });

  // Multiple event photo upload
  const eventFileInput = document.getElementById("event-photos-file-input");
  const btnUploadEventPhotos = document.getElementById("btn-upload-event-photos");
  const eventUploadText = document.getElementById("event-upload-text");

  btnUploadEventPhotos.addEventListener("click", (e) => {
    e.preventDefault();
    eventFileInput.click();
  });

  eventFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    eventUploadText.innerText = `Uploading (${files.length})...`;
    btnUploadEventPhotos.disabled = true;

    try {
      let token = "";
      if (auth && auth.currentUser) token = await auth.currentUser.getIdToken();
      const siteId = document.getElementById("post-site").value || defaultSiteId;

      for (const file of files) {
        try {
          const filename = `posts/${siteId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
            body: await file.arrayBuffer()
          });

          if (res.ok) {
            const data = await res.json();
            if (data.url) currentPhotos.push(data.url);
          } else {
            const b64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); });
            currentPhotos.push(b64);
          }
        } catch {
          const b64 = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); });
          currentPhotos.push(b64);
        }
      }

      if (!coverUrlInput.value.trim() && currentPhotos.length > 0) {
        coverUrlInput.value = currentPhotos[0];
        updateCoverPreview();
      }

      renderPhotosStrip();
      showToast(`${files.length} photo(s) added to event album.`);
    } catch {
      showToast("Photos upload failed.", "danger");
    } finally {
      eventUploadText.innerText = "Upload Photos";
      btnUploadEventPhotos.disabled = false;
      eventFileInput.value = "";
    }
  });

  // Rich Text Editor formatting buttons
  const editorEl = document.getElementById("post-content-editor");
  overlay.querySelectorAll(".rte-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const cmd = btn.getAttribute("data-cmd");
      const val = btn.getAttribute("data-val") || null;
      editorEl.focus();
      document.execCommand(cmd, false, val);
    });
  });

  // Link button
  document.getElementById("btn-insert-link").addEventListener("click", (e) => {
    e.preventDefault();
    const url = prompt("Enter hyperlink URL (e.g. https://...):");
    if (url) {
      editorEl.focus();
      document.execCommand("createLink", false, url);
    }
  });

  // Inline Image Insertion Button (Toolbar)
  const inlineImgFileInput = document.getElementById("inline-img-file-input");
  const btnInsertInlineImg = document.getElementById("btn-insert-inline-img");

  btnInsertInlineImg.addEventListener("click", (e) => {
    e.preventDefault();
    const choice = confirm("Click OK to upload an image from your computer, or Cancel to paste an image URL.");
    if (choice) {
      inlineImgFileInput.click();
    } else {
      const imgUrl = prompt("Enter image URL:");
      if (imgUrl) {
        editorEl.focus();
        document.execCommand("insertHTML", false, `<img src="${imgUrl}" style="max-width: 100%; border-radius: 8px; margin: 12px 0; display: block;" />`);
      }
    }
  });

  inlineImgFileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    btnInsertInlineImg.innerText = "Uploading...";
    btnInsertInlineImg.disabled = true;

    try {
      let token = "";
      if (auth && auth.currentUser) token = await auth.currentUser.getIdToken();
      const siteId = document.getElementById("post-site").value || defaultSiteId;
      const filename = `posts/${siteId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
        body: await file.arrayBuffer()
      });

      let finalUrl = "";
      if (res.ok) {
        const data = await res.json();
        if (data.url) finalUrl = data.url;
      } else {
        finalUrl = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result); rd.readAsDataURL(file); });
      }

      if (finalUrl) {
        editorEl.focus();
        document.execCommand("insertHTML", false, `<img src="${finalUrl}" style="max-width: 100%; border-radius: 8px; margin: 12px 0; display: block;" />`);
        showToast("Image inserted into story.");
      }
    } catch {
      showToast("Failed to insert image.", "danger");
    } finally {
      btnInsertInlineImg.innerHTML = `<i class="fa-solid fa-image"></i> Insert Image`;
      btnInsertInlineImg.disabled = false;
      inlineImgFileInput.value = "";
    }
  });

  // Save Post Handler
  document.getElementById("btn-save-post-modal").addEventListener("click", async () => {
    const title = document.getElementById("post-title").value.trim();
    if (!title) {
      showToast("Please enter a post title.", "warning");
      return;
    }

    const siteId = document.getElementById("post-site").value;
    const category = document.getElementById("post-category").value;
    const status = document.getElementById("post-status").value;
    const coverImage = coverUrlInput.value.trim() || (currentPhotos[0] || "");
    const content = editorEl.innerHTML;
    const excerpt = document.getElementById("post-excerpt").value.trim();
    const author = document.getElementById("post-author").value.trim();

    const payload = {
      site_id: siteId,
      title,
      category,
      status,
      cover_image: coverImage,
      photos: currentPhotos,
      content,
      excerpt,
      author
    };

    const saveBtn = document.getElementById("btn-save-post-modal");
    saveBtn.innerText = "Saving...";
    saveBtn.disabled = true;

    try {
      if (isEditing) {
        await apiRequest(`/api/tenant/posts/${post.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        showToast("Post updated successfully!");
      } else {
        await apiRequest(`/api/tenant/posts`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        showToast("Post created successfully!");
      }

      if (onSaveCallback) onSaveCallback();
      closeModal();
    } catch (err) {
      showToast("Failed to save post.", "danger");
      saveBtn.innerText = "Save & Publish Post";
      saveBtn.disabled = false;
    }
  });
}

// --- Post Preview & Story Reader Modal ---
function openPostPreviewModal(post) {
  if (!post) return;
  const photos = Array.isArray(post.photos) ? post.photos : [];
  const dateStr = post.created_at ? new Date(Number(post.created_at)).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : "";
  const coverImg = post.cover_image || (photos[0] || "");

  const overlay = document.createElement("div");
  overlay.id = "post-preview-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(5px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="post-preview-modal-card" style="
      width: 720px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 25px 30px -5px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Top Bar -->
      <div style="padding: 14px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 11px; font-weight: 700; color: #0B57D0; background: #EBF2FE; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
            ${post.category || 'Event'}
          </span>
          <span style="font-size: 11px; color: #64748B;">${post.site_name || post.site_id}</span>
        </div>
        <button id="btn-close-preview-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 4px;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Scrollable Article Content Body -->
      <div style="flex: 1; overflow-y: auto; padding: 24px 28px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Post Title -->
        <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: #0F172A; line-height: 1.3;">
          ${post.title}
        </h1>

        <!-- Author & Date Meta -->
        <div style="display: flex; align-items: center; gap: 16px; font-size: 12.5px; color: #64748B; padding-bottom: 12px; border-bottom: 1px solid #F1F5F9;">
          ${post.author ? `<span><i class="fa-regular fa-user" style="margin-right: 5px; color: #0B57D0;"></i>${post.author}</span>` : ''}
          ${dateStr ? `<span><i class="fa-regular fa-calendar" style="margin-right: 5px; color: #0B57D0;"></i>${dateStr}</span>` : ''}
          ${photos.length > 0 ? `<span><i class="fa-solid fa-images" style="margin-right: 5px; color: #059669;"></i>${photos.length} Event Photos</span>` : ''}
        </div>

        <!-- Featured Cover Photo Banner -->
        ${coverImg ? `
          <div style="width: 100%; height: 280px; border-radius: 12px; overflow: hidden; background: #0F172A; border: 1px solid #E2E8F0;">
            <img src="${coverImg}" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
        ` : ''}

        <!-- Interactive Event Photo Album Carousel (If multi-photo) -->
        ${photos.length > 1 ? `
          <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 12px; font-weight: 700; color: #1E293B; text-transform: uppercase;">
              <i class="fa-solid fa-images" style="color: #0B57D0; margin-right: 6px;"></i>Event Photo Album (${photos.length} Photos)
            </div>
            <div style="display: flex; gap: 10px; overflow-x: auto; padding: 4px 0;">
              ${photos.map((pUrl, pIdx) => `
                <div class="preview-album-thumb" data-url="${pUrl}" style="width: 100px; height: 75px; border-radius: 6px; overflow: hidden; border: 1.5px solid #CBD5E1; cursor: pointer; flex-shrink: 0; transition: transform 0.15s ease;">
                  <img src="${pUrl}" style="width: 100%; height: 100%; object-fit: cover;" />
                </div>
              `).join("")}
            </div>
          </div>
        ` : ''}

        <!-- Article Story Content -->
        <div style="font-size: 14.5px; line-height: 1.7; color: #334155; margin-top: 6px;">
          ${post.content || (post.excerpt ? `<p>${post.excerpt}</p>` : '<p>No content provided.</p>')}
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end;">
        <button class="btn btn-secondary" id="btn-close-preview-footer" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px;">Close</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("post-preview-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("post-preview-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-preview-modal").addEventListener("click", closeModal);
  document.getElementById("btn-close-preview-footer").addEventListener("click", closeModal);

  // Click album thumb to open in Lightbox
  overlay.querySelectorAll(".preview-album-thumb").forEach(thumb => {
    thumb.addEventListener("click", () => {
      const u = thumb.getAttribute("data-url");
      if (u) openPhotoLightbox(u);
    });
  });
}

async function loadTenantSitePages(siteId) {
  const listDiv = document.getElementById(`pages-list-${siteId}`);
  const countSpan = document.getElementById(`page-count-${siteId}`);
  const addBtn = document.getElementById(`btn-add-page-${siteId}`);
  
  try {
    const res = await apiRequest(`/api/tenant/pages?siteId=${siteId}`);
    if (!res.ok) throw new Error();
    let pages = await res.json();
    
    // Ensure site index/homepage is always present in list, even if it hasn't been saved in D1 yet
    const hasHomepage = pages.some(p => p.page_path === "");
    if (!hasHomepage) {
      pages.unshift({
        site_id: siteId,
        page_path: "",
        seo_title: "Home Page",
        seo_description: "Welcome to our website.",
        html: "",
        css: "",
        json: "{}"
      });
    }
    
    // Virtual homepage shouldn't count towards the 5 page limit if it hasn't been created/saved in DB
    const dbPageCount = hasHomepage ? pages.length : pages.length - 1;
    
    countSpan.innerText = `${dbPageCount} / 5`;
    if (dbPageCount >= 5) {
      addBtn.disabled = true;
      addBtn.className = "btn btn-secondary";
      addBtn.title = "Max pages reached";
    }
    
    listDiv.innerHTML = "";
    
    pages.forEach(page => {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.justifyContent = "space-between";
      row.style.alignItems = "center";
      row.style.padding = "8px 12px";
      row.style.backgroundColor = "var(--bg-hover)";
      row.style.borderRadius = "8px";
      row.style.border = "1px solid var(--border-color)";
      
      const linkPath = page.page_path === "" ? `/${siteId}` : `/${siteId}/${page.page_path}`;
      const pathLabel = page.page_path === "" ? "Homepage" : `/${page.page_path}`;
      
      row.innerHTML = `
        <div style="overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
          <strong style="font-size: 13px; display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;">${page.seo_title || "Untitled"}</strong>
          <span style="font-size: 11px; font-family: monospace; color: var(--text-muted);">${pathLabel}</span>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-icon" id="btn-edit-${siteId}-${page.page_path || "index"}" title="Edit with Visual Builder"><i class="fa-solid fa-pen-to-square"></i></button>
          <a href="${linkPath}" target="_blank" class="btn-icon" title="View Page"><i class="fa-solid fa-eye"></i></a>
          <button class="btn-icon" id="btn-del-${siteId}-${page.page_path || "index"}" title="Delete Page" style="color: var(--danger-color); display: ${page.page_path === '' ? 'none' : 'inline-flex'};"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;
      
      listDiv.appendChild(row);
      
      document.getElementById(`btn-edit-${siteId}-${page.page_path || "index"}`).addEventListener("click", () => {
        openVisualBuilder(siteId, page.page_path, page);
      });
      
      document.getElementById(`btn-del-${siteId}-${page.page_path || "index"}`).addEventListener("click", async () => {
        if (await showConfirm(
          "Delete Page",
          `Are you sure you want to delete page '${pathLabel}'?`,
          { confirmText: "Delete", variant: "danger" }
        )) {
          const dres = await apiRequest(`/api/tenant/pages?siteId=${siteId}&pagePath=${page.page_path}`, {
            method: "DELETE"
          });
          if (dres.ok) {
            showToast("Page deleted successfully.");
            loadTenantSitePages(siteId);
          } else {
            showToast("Failed to delete page.", "danger");
          }
        }
      });
    });
  } catch (e) {
    listDiv.innerHTML = `<p style="color: var(--danger-color);">Failed to load pages</p>`;
  }
}

async function addNewPagePrompt(siteId) {
  const pagePath = await showPrompt(
    "Create New Page",
    `Enter a route slug (e.g., 'about', 'services') to create a new sub-page. It will be available at: .../${siteId}/[your-slug]`
  );
  if (pagePath === null) return;
  
  const cleanPath = pagePath.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  
  // Verify if exists
  try {
    const checkRes = await apiRequest(`/api/tenant/pages?siteId=${siteId}`);
    if (checkRes.ok) {
      const pages = await checkRes.json();
      if (pages.some(p => p.page_path === cleanPath)) {
        showToast("A page with this route already exists.", "warning");
        return;
      }
    }
  } catch {}
  
  // Open Builder directly for a new page
  openVisualBuilder(siteId, cleanPath, {
    site_id: siteId,
    page_path: cleanPath,
    seo_title: cleanPath === "" ? "Homepage" : cleanPath.toUpperCase(),
    seo_description: "",
    html: "",
    css: "",
    json: "{}"
  });
}

// --- Admin Controls view ---
async function renderAdminSettingsSubView() {
  await renderSitePreviewDashboard("main", "Main Site Editor", true);
}

// 1. Tenants approvals
async function loadAdminTenantsPanel() {
  const box = document.getElementById("admin-content-box");
  box.innerHTML = `<div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px;"></i></div>`;
  
  try {
    const res = await apiRequest("/api/admin/tenants");
    if (!res.ok) throw new Error();
    const tenants = await res.json();
    
    box.innerHTML = `
      <h2 style="margin-bottom: 8px;">Tenant Approval Center</h2>
      <p style="margin-bottom: 20px;">Review registered tenant portal registrations. Approve, freeze, or remove access.</p>
      
      <div class="table-container" style="height: calc(100vh - 350px);">
        <div class="table-header-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 30%;">Tenant Email</th>
                <th style="width: 20%;">Company / Name</th>
                <th style="width: 25%;">Registered</th>
                <th style="width: 12%;">Status</th>
                <th style="width: 13%; text-align: right;">Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div class="table-body-scroll">
          <table class="data-table" id="admin-tenants-rows">
            <tbody>
              <!-- Row items -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    const tbody = document.querySelector("#admin-tenants-rows tbody");
    if (tenants.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 30px;">No tenants registered yet.</td></tr>`;
      return;
    }
    
    tenants.forEach(tenant => {
      const tr = document.createElement("tr");
      
      let statusBadge = `<span class="badge badge-pending">Pending Approval</span>`;
      if (tenant.approved === 1) statusBadge = `<span class="badge badge-approved">Approved</span>`;
      if (tenant.approved === -1) statusBadge = `<span class="badge badge-frozen">Frozen</span>`;
      
      const regDate = new Date(tenant.created_at).toLocaleDateString("en-GB");
      
      tr.innerHTML = `
        <td style="width: 30%; word-break: break-all;"><strong>${tenant.email}</strong></td>
        <td style="width: 20%;">${tenant.name || "-"}</td>
        <td style="width: 25%; font-size: 13px;">${regDate}</td>
        <td style="width: 12%;">${statusBadge}</td>
        <td style="width: 13%; text-align: right;">
          <div style="display: inline-flex; gap: 6px;">
            ${tenant.approved !== 1 ? `<button class="btn btn-success btn-icon" id="btn-appr-${btoa(tenant.email)}" title="Approve"><i class="fa-solid fa-circle-check"></i></button>` : ""}
            ${tenant.approved !== -1 ? `<button class="btn btn-secondary btn-icon" id="btn-frz-${btoa(tenant.email)}" title="Freeze Account"><i class="fa-solid fa-snowflake"></i></button>` : `<button class="btn btn-success btn-icon" id="btn-unfrz-${btoa(tenant.email)}" title="Unfreeze"><i class="fa-solid fa-sun"></i></button>`}
            <button class="btn btn-danger btn-icon" id="btn-remt-${btoa(tenant.email)}" title="Delete Tenant"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
      
      // Event listeners
      if (tenant.approved !== 1) {
        document.getElementById(`btn-appr-${btoa(tenant.email)}`).addEventListener("click", async () => {
          const ares = await apiRequest("/api/admin/tenants/approve", {
            method: "POST",
            body: JSON.stringify({ email: tenant.email })
          });
          if (ares.ok) {
            showToast(`Approved ${tenant.email}`);
            loadAdminTenantsPanel();
          } else {
            showToast("Approval failed.", "danger");
          }
        });
      }
      
      if (tenant.approved !== -1) {
        document.getElementById(`btn-frz-${btoa(tenant.email)}`).addEventListener("click", async () => {
          const fres = await apiRequest("/api/admin/tenants/status", {
            method: "POST",
            body: JSON.stringify({ email: tenant.email, status: -1 })
          });
          if (fres.ok) {
            showToast(`Frozen account: ${tenant.email}`);
            loadAdminTenantsPanel();
          }
        });
      } else {
        document.getElementById(`btn-unfrz-${btoa(tenant.email)}`).addEventListener("click", async () => {
          const fres = await apiRequest("/api/admin/tenants/status", {
            method: "POST",
            body: JSON.stringify({ email: tenant.email, status: 0 }) // revert to pending
          });
          if (fres.ok) {
            showToast(`Reverted ${tenant.email} to Pending`);
            loadAdminTenantsPanel();
          }
        });
      }
      
      document.getElementById(`btn-remt-${btoa(tenant.email)}`).addEventListener("click", async () => {
        if (await showConfirm(
          "Remove Tenant",
          `Remove tenant ${tenant.email} completely? All assigned sites mappings will be unlinked.`,
          { confirmText: "Remove", variant: "danger" }
        )) {
          const dres = await apiRequest("/api/admin/tenants/delete", {
            method: "POST",
            body: JSON.stringify({ email: tenant.email })
          });
          if (dres.ok) {
            showToast(`Removed ${tenant.email}`);
            loadAdminTenantsPanel();
          }
        }
      });
    });
  } catch (e) {
    box.innerHTML = `<div style="color: var(--danger-color);">Error fetching tenants database list.</div>`;
  }
}

// 2. Sites creation & assignment
async function loadAdminSitesPanel() {
  const box = document.getElementById("admin-content-box");
  box.innerHTML = `<div style="text-align: center; padding: 40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 24px;"></i></div>`;
  
  try {
    const sres = await apiRequest("/api/admin/sites");
    const tres = await apiRequest("/api/admin/tenants");
    
    if (!sres.ok || !tres.ok) throw new Error();
    const sites = await sres.json();
    const tenants = await tres.json();
    
    const approvedTenants = tenants.filter(t => t.approved === 1);
    
    box.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h2>Tenant Sites & Portals</h2>
          <p>Create portal website folders and allocate them to approved tenants.</p>
        </div>
        <button class="btn btn-primary" id="btn-create-site" style="max-width: 160px;"><i class="fa-solid fa-plus"></i> Create New Site</button>
      </div>
      
      <div class="table-container" style="height: calc(100vh - 350px);">
        <div class="table-header-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 25%;">Site ID (Slug)</th>
                <th style="width: 25%;">Site Name</th>
                <th style="width: 30%;">Managed By Tenants</th>
                <th style="width: 20%; text-align: right;">Action</th>
              </tr>
            </thead>
          </table>
        </div>
        <div class="table-body-scroll">
          <table class="data-table" id="admin-sites-rows">
            <tbody>
              <!-- Row items -->
            </tbody>
          </table>
        </div>
      </div>
    `;
    
    const tbody = document.querySelector("#admin-sites-rows tbody");
    if (sites.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 30px;">No sites created yet.</td></tr>`;
    } else {
      sites.forEach(site => {
        if (site.id === "main") return;

        const tr = document.createElement("tr");
        
        const managers = site.tenant_emails && site.tenant_emails.length > 0
          ? site.tenant_emails.map(email => `<code style="background-color: var(--bg-hover); border:1px solid var(--border-color); padding: 2px 6px; border-radius: 4px; display: inline-block; margin: 2px; font-size:12px;">${email}</code>`).join(" ")
          : `<span style="color: var(--warning-color); font-style: italic; font-size:13px;">No Tenants Assigned</span>`;
        
        tr.innerHTML = `
          <td style="width: 25%; font-family: monospace;"><strong>/${site.id}</strong></td>
          <td style="width: 25%; font-weight: 600;">${site.name}</td>
          <td style="width: 30%;">${managers}</td>
          <td style="width: 20%; text-align: right;">
            <div style="display: inline-flex; gap: 6px;">
              <button class="btn btn-secondary btn-icon" id="btn-assign-${site.id}" title="Assign Tenants"><i class="fa-solid fa-user-plus"></i></button>
              <button class="btn btn-danger btn-icon" id="btn-delsite-${site.id}" title="Delete Site"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        `;
        tbody.appendChild(tr);
        
        // Event assignments
        document.getElementById(`btn-assign-${site.id}`).addEventListener("click", () => {
          showSiteAssignmentDialog(site, approvedTenants);
        });
        
        document.getElementById(`btn-delsite-${site.id}`).addEventListener("click", async () => {
          if (await showConfirm(
            "Delete Site Folder",
            `Are you sure you want to delete site folder '/${site.id}' and ALL of its pages? This action is permanent.`,
            { confirmText: "Delete Permanently", variant: "danger" }
          )) {
            const delRes = await apiRequest("/api/admin/sites/delete", {
              method: "POST",
              body: JSON.stringify({ site_id: site.id })
            });
            if (delRes.ok) {
              showToast("Site folder deleted.");
              loadAdminSitesPanel();
            }
          }
        });
      });
    }
    
    document.getElementById("btn-create-site").addEventListener("click", async () => {
      const slug = await showPrompt(
        "Create New Site Slug",
        "Enter Site ID slug (lowercase letters and numbers only, e.g. 'sitetenant1'):"
      );
      if (slug === null) return;
      const cleanSlug = slug.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!cleanSlug) {
        showToast("Invalid slug format", "warning");
        return;
      }
      
      const name = await showPrompt(
        "Create New Site Name",
        "Enter site display name:",
        "Tenant Site"
      );
      if (!name) return;

      const userEmails = await showPrompt(
        "Assign Users (Emails)",
        "Enter user emails (comma separated, e.g. user1@test.com, user2@test.com) or leave empty for Administrator only:"
      );
      const assignedEmails = userEmails
        ? userEmails.split(",").map(e => e.trim().toLowerCase()).filter(Boolean)
        : [];
      
      const cres = await apiRequest("/api/admin/sites/create", {
        method: "POST",
        body: JSON.stringify({ id: cleanSlug, name: name, assigned_emails: assignedEmails })
      });
      
      if (cres.ok) {
        showToast("Site folder created successfully!");
        loadAdminSitesPanel();
      } else {
        const err = await cres.json().catch(() => ({}));
        showToast(err.error || "Failed to create site.", "danger");
      }
    });
  } catch (e) {
    box.innerHTML = `<div style="color: var(--danger-color);">Error fetching sites database list.</div>`;
  }
}

// Assignment modal builder
function showSiteAssignmentDialog(site, tenants) {
  // Remove existing
  const oldModal = document.getElementById("seo-overlay-panel");
  if (oldModal) oldModal.remove();
  
  const overlay = document.createElement("div");
  overlay.id = "seo-overlay-panel";
  overlay.className = "seo-overlay";
  
  const checkboxes = tenants.map(t => {
    const checked = site.tenant_emails && site.tenant_emails.includes(t.email) ? "checked" : "";
    return `
      <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px; cursor: pointer; padding: 8px; background-color: var(--bg-hover); border:1px solid var(--border-color); border-radius:6px; width:100%;">
        <input type="checkbox" name="assign-emails" value="${t.email}" ${checked} style="width: 16px; height: 16px;">
        <span style="font-size:12px; font-weight:600;">${t.name} (<strong>${t.email}</strong>)</span>
      </label>
    `;
  }).join("");
  
  overlay.innerHTML = `
    <div class="seo-modal" style="width: 480px;">
      <div class="seo-modal-header">
        <h3 style="font-size:14px; font-weight:700;">Assign Tenants to /${site.id}</h3>
        <button class="btn-icon" id="close-assign-modal" style="border:none; background:none;"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="seo-modal-body" style="padding:20px;">
        <p style="margin-bottom:15px; font-size:12px;">Select which approved tenants can manage pages inside this website container (supports multiple managers):</p>
        <form id="assign-form">
          ${checkboxes || `<p style="font-style:italic; text-align:center; padding:15px;">No approved tenants available. Approve tenants first.</p>`}
        </form>
      </div>
      <div class="seo-modal-footer">
        <button class="btn btn-secondary" id="btn-cancel-assign">Cancel</button>
        <button class="btn btn-primary" id="btn-save-assign" ${tenants.length === 0 ? "disabled" : ""}>Save Allocations</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  const close = () => overlay.remove();
  document.getElementById("close-assign-modal").addEventListener("click", close);
  document.getElementById("btn-cancel-assign").addEventListener("click", close);
  
  document.getElementById("btn-save-assign").addEventListener("click", async () => {
    const list = Array.from(document.querySelectorAll('input[name="assign-emails"]:checked')).map(el => el.value);
    
    const res = await apiRequest("/api/admin/sites/assign", {
      method: "POST",
      body: JSON.stringify({
        site_id: site.id,
        tenant_emails: list
      })
    });
    
    if (res.ok) {
      showToast("Site allocations updated.");
      close();
      loadAdminSitesPanel();
    } else {
      showToast("Failed to update allocations.", "danger");
    }
  });
}

// --- Unified Website Simulator Preview Dashboard ---
let currentPreviewPagePath = ""; // Keep track of the currently selected preview page path

async function renderSitePreviewDashboard(siteId, siteName, isMainSite) {
  const workspace = document.getElementById("workspace-content");
  
  // Set up container layout (edge-to-edge, full screen height, no gap, no radius)
  workspace.innerHTML = `
    <div style="display: flex; width: calc(100% + 40px); height: 100vh; margin: -20px; gap: 0; overflow: hidden; box-sizing: border-box;">
      
      <!-- 1. Center Simulator Area -->
      <div style="flex: 1; display: flex; flex-direction: column; background-color: var(--bg-card); overflow: hidden; height: 100%;">
        <!-- Simulator Top Controls Strip -->
        <div style="padding: 10px 18px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: #FFFFFF; flex-shrink: 0;">
          <div style="font-size: 13.5px; font-weight: 700; color: #1E293B; display: flex; align-items: center; gap: 8px;">
            <span>${siteName}</span>
            <span style="font-size: 11px; font-family: monospace; color: #64748B; font-weight: normal; background: #F1F5F9; padding: 2px 6px; border-radius: 4px; border: 1px solid #E2E8F0;">/${siteId}</span>
          </div>
          <div style="display: flex; gap: 4px; background-color: #F1F5F9; padding: 3px 4px; border-radius: 8px; border: 1px solid #E2E8F0; flex-shrink: 0;">
            <button class="btn-icon active" id="btn-device-desktop" title="Desktop View" style="padding: 5px 10px; border-radius: 6px;"><i class="fa-solid fa-desktop"></i></button>
            <button class="btn-icon" id="btn-device-tablet" title="Tablet View" style="padding: 5px 10px; border-radius: 6px;"><i class="fa-solid fa-tablet-screen-button"></i></button>
            <button class="btn-icon" id="btn-device-phone" title="Mobile View" style="padding: 5px 10px; border-radius: 6px;"><i class="fa-solid fa-mobile-screen-button"></i></button>
          </div>
        </div>

        <!-- Viewport Container (direct full height simulator) -->
        <div style="flex: 1; display: flex; align-items: center; justify-content: center; background-color: #f1f5f9; overflow: hidden; padding: 20px; box-sizing: border-box;" id="simulator-container">
          <iframe id="simulator-iframe" style="width: 100%; height: 100%; border: none; background-color: #ffffff; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); border-radius: 4px; transition: all 0.3s ease;"></iframe>
        </div>
      </div>

      <!-- 2. Right Side Panel -->
      <div style="width: 256px; display: flex; flex-direction: column; border-left: 1px solid var(--border-color); background-color: var(--bg-card); flex-shrink: 0; overflow: hidden; height: 100%;">
        <!-- Header -->
        <div style="padding: 14px 16px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
          <div>
            <h3 style="font-size: 14px; font-weight: 700; margin: 0;">Site Pages</h3>
            <span style="font-size: 11px; color: var(--text-muted);" id="dashboard-page-count">0 / 5 limit</span>
          </div>
          <button class="btn btn-primary" id="btn-dashboard-add-page" style="width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center; border-radius: 6px; flex-shrink: 0;" title="Add Page"><i class="fa-solid fa-plus"></i></button>
        </div>
        <!-- Scrollable list of page cards -->
        <div id="dashboard-pages-list" style="flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;">
          <!-- Page cards will be appended here -->
        </div>
      </div>

    </div>
  `;

  // Bind Device Switcher Click Events
  const iframe = document.getElementById("simulator-iframe");
  const btnDesktop = document.getElementById("btn-device-desktop");
  const btnTablet = document.getElementById("btn-device-tablet");
  const btnPhone = document.getElementById("btn-device-phone");

  const setDevice = (device) => {
    [btnDesktop, btnTablet, btnPhone].forEach(btn => btn?.classList.remove("active"));
    if (device === "desktop" && btnDesktop && iframe) {
      btnDesktop.classList.add("active");
      iframe.style.width = "100%";
      iframe.style.maxWidth = "100%";
    } else if (device === "tablet" && btnTablet && iframe) {
      btnTablet.classList.add("active");
      iframe.style.width = "768px";
      iframe.style.maxWidth = "100%";
    } else if (device === "phone" && btnPhone && iframe) {
      btnPhone.classList.add("active");
      iframe.style.width = "375px";
      iframe.style.maxWidth = "100%";
    }
  };

  btnDesktop?.addEventListener("click", () => setDevice("desktop"));
  btnTablet?.addEventListener("click", () => setDevice("tablet"));
  btnPhone?.addEventListener("click", () => setDevice("phone"));

  // Bind Add Page Button
  document.getElementById("btn-dashboard-add-page").addEventListener("click", () => {
    addNewPagePromptUnified(siteId, siteName, isMainSite);
  });

  // Load pages list and initial preview
  await loadDashboardPages(siteId, siteName, isMainSite);
}

async function loadDashboardPages(siteId, siteName, isMainSite) {
  const listDiv = document.getElementById("dashboard-pages-list");
  const countSpan = document.getElementById("dashboard-page-count");
  const addBtn = document.getElementById("btn-dashboard-add-page");
  
  if (!listDiv) return;
  listDiv.innerHTML = `<div style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>`;

  try {
    const endpoint = isMainSite ? "/api/tenant/pages?siteId=main" : `/api/tenant/pages?siteId=${siteId}`;
    const res = await apiRequest(endpoint);
    if (!res.ok) throw new Error();
    let pages = await res.json();
    
    // Ensure homepage is present in pages
    const hasHomepage = pages.some(p => p.page_path === "");
    if (!hasHomepage) {
      pages.unshift({
        site_id: siteId,
        page_path: "",
        seo_title: isMainSite ? "HSG Global - Home" : "Homepage",
        seo_description: "Welcome to our website.",
        html: "",
        css: "",
        json: "{}"
      });
    }

    const dbPageCount = hasHomepage ? pages.length : pages.length - 1;
    
    // Update count display (Main website allows unlimited, tenant sites limit is 5)
    if (isMainSite) {
      countSpan.innerText = `${dbPageCount} pages`;
    } else {
      countSpan.innerText = `${dbPageCount} / 5 used`;
      if (dbPageCount >= 5) {
        addBtn.disabled = true;
        addBtn.title = "Max pages reached";
        addBtn.style.opacity = "0.5";
        addBtn.style.cursor = "not-allowed";
      } else {
        addBtn.disabled = false;
        addBtn.title = "Add Page";
        addBtn.style.opacity = "1";
        addBtn.style.cursor = "pointer";
      }
    }

    listDiv.innerHTML = "";
    
    // Find previously selected page or default to homepage
    let activePage = pages.find(p => p.page_path === currentPreviewPagePath);
    if (!activePage) {
      activePage = pages[0]; // default to first page (homepage)
      currentPreviewPagePath = activePage.page_path;
    }

    // Update Breadcrumb Title dynamically
    const displayPageName = activePage.page_path === "" ? "Homepage" : (activePage.seo_title || activePage.page_path);
    const breadcrumbTitle = document.getElementById("breadcrumb-title");
    if (breadcrumbTitle) {
      breadcrumbTitle.innerHTML = `Workspace / ${siteName} / <span style="font-weight: 700; color: var(--text-main);">${displayPageName}</span>`;
    }

    pages.forEach(page => {
      const isSelected = page.page_path === currentPreviewPagePath;
      const card = document.createElement("div");
      
      const linkPath = page.page_path === "" ? (isMainSite ? "/" : `/${siteId}`) : (isMainSite ? `/${page.page_path}` : `/${siteId}/${page.page_path}`);
      const pathLabel = page.page_path === "" ? "Homepage" : `/${page.page_path}`;
      
      card.className = "page-card";
      // Render clean card layout
      card.style.padding = "10px 12px";
      card.style.border = isSelected ? "1px solid var(--accent-color)" : "1px solid var(--border-color)";
      card.style.backgroundColor = isSelected ? "var(--bg-hover)" : "transparent";
      card.style.borderRadius = "8px";
      card.style.cursor = "pointer";
      card.style.transition = "all 0.15s ease";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "6px";
      
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; overflow: hidden; gap: 6px;">
          <div style="overflow: hidden; text-overflow: ellipsis; display: flex; flex-direction: column; flex: 1;">
            <strong style="font-size: 13px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: ${isSelected ? 'var(--text-main)' : 'var(--text-muted)'}; font-weight: 700;">${page.page_path === "" ? "Homepage" : (page.seo_title || page.page_path)}</strong>
            <span style="font-size: 11px; font-family: monospace; color: var(--text-muted); margin-top: 1px;">${pathLabel}</span>
          </div>
          ${page.published === 0 ? `
            <span style="font-size: 9px; font-weight: 700; color: #dc2626; background-color: #fee2e2; border: 1px solid #fca5a5; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;">Offline</span>
          ` : ""}
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 6px; border-top: 1px solid var(--border-color); padding-top: 6px; margin-top: 2px;">
          ${page.page_path !== "" ? `
            <button class="btn-icon" id="btn-card-home-${page.page_path}" title="Set as Homepage" style="font-size: 11px; padding: 4px 6px;"><i class="fa-solid fa-house"></i></button>
          ` : ""}
          <button class="btn-icon" id="btn-card-edit-${page.page_path || 'index'}" title="Edit Layout" style="font-size: 11px; padding: 4px 6px;"><i class="fa-solid fa-pen-to-square"></i></button>
          <a href="${linkPath}" target="_blank" class="btn-icon" title="View Page" style="font-size: 11px; padding: 4px 6px;"><i class="fa-solid fa-eye"></i></a>
          <button class="btn-icon" id="btn-card-del-${page.page_path || 'index'}" title="Delete Page" style="color: var(--danger-color); display: ${page.page_path === '' ? 'none' : 'inline-flex'}; font-size: 11px; padding: 4px 6px;"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      // Select card body click handler (prevent propagation for buttons)
      card.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("a")) return;
        currentPreviewPagePath = page.page_path;
        loadDashboardPages(siteId, siteName, isMainSite); // reload list to update active styles
      });

      listDiv.appendChild(card);

      // Bind Actions
      if (page.page_path !== "") {
        document.getElementById(`btn-card-home-${page.page_path}`).addEventListener("click", async (e) => {
          e.stopPropagation();
          if (await showConfirm(
            "Set Homepage",
            `Make '${page.seo_title || page.page_path}' the new homepage? (This will swap routes with the current homepage)`,
            { confirmText: "Make Homepage", variant: "dark" }
          )) {
            try {
              const res = await apiRequest("/api/tenant/pages/make-homepage", {
                method: "POST",
                body: JSON.stringify({ site_id: siteId, page_path: page.page_path })
              });
              if (res.ok) {
                showToast("Homepage changed successfully.");
                currentPreviewPagePath = ""; // reset preview path to homepage (which is now the new page)
                loadDashboardPages(siteId, siteName, isMainSite);
              } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || "Failed to set homepage.", "danger");
              }
            } catch (err) {
              showToast("Network error setting homepage.", "danger");
            }
          }
        });
      }

      document.getElementById(`btn-card-edit-${page.page_path || 'index'}`).addEventListener("click", () => {
        openVisualBuilder(siteId, page.page_path, page);
      });

      document.getElementById(`btn-card-del-${page.page_path || 'index'}`).addEventListener("click", async (e) => {
        e.stopPropagation();
        if (await showConfirm(
          "Delete Page",
          `Are you sure you want to delete page '${pathLabel}'?`,
          { confirmText: "Delete", variant: "danger" }
        )) {
          const dres = await apiRequest(`/api/tenant/pages?siteId=${siteId}&pagePath=${page.page_path}`, {
            method: "DELETE"
          });
          if (dres.ok) {
            showToast("Page deleted successfully.");
            if (currentPreviewPagePath === page.page_path) {
              currentPreviewPagePath = ""; // reset to home if deleted page was previewed
            }
            loadDashboardPages(siteId, siteName, isMainSite);
          } else {
            showToast("Failed to delete page.", "danger");
          }
        }
      });
    });

    // Update active simulator iframe contents
    updateSimulatorPreview(activePage);

  } catch (e) {
    listDiv.innerHTML = `<p style="color: var(--danger-color); font-size:12px; text-align:center;">Failed to load pages</p>`;
  }
}

function updateSimulatorPreview(page) {
  const iframe = document.getElementById("simulator-iframe");
  if (!iframe) return;

  // Build full HTML content
  const previewHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
          /* Reset & base styling for inside preview */
          html, body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          }
          ${page.css || ''}
        </style>
      </head>
      <body>
        ${page.html || '<div style="display:flex; height:100vh; align-items:center; justify-content:center; color:#9ca3af; font-family:sans-serif; text-align:center;"><div><i class="fa-solid fa-pencil" style="font-size:32px; margin-bottom:10px;"></i><p>This page is empty. Click Edit Layout to customize it.</p></div></div>'}

        <script>
          // Auto-init Hero Sliders
          function initSliders() {
            document.querySelectorAll(".ib-hero-slider").forEach(container => {
              const slides = container.querySelectorAll(".ib-hero-slide");
              const dots = container.querySelectorAll(".ib-hero-dot");
              const prevBtn = container.querySelector(".ib-hero-prev");
              const nextBtn = container.querySelector(".ib-hero-next");
              if (slides.length <= 1) return;

              let currentIdx = 0;
              let timer = null;

              const goToSlide = (idx) => {
                currentIdx = (idx + slides.length) % slides.length;
                slides.forEach((s, i) => {
                  s.style.opacity = i === currentIdx ? "1" : "0";
                });
                dots.forEach((d, i) => {
                  d.style.width = i === currentIdx ? "24px" : "8px";
                  d.style.background = i === currentIdx ? "#FFFFFF" : "rgba(255,255,255,0.45)";
                });
              };

              const startAutoplay = () => {
                clearInterval(timer);
                timer = setInterval(() => goToSlide(currentIdx + 1), 5000);
              };

              if (prevBtn) prevBtn.addEventListener("click", () => { goToSlide(currentIdx - 1); startAutoplay(); });
              if (nextBtn) nextBtn.addEventListener("click", () => { goToSlide(currentIdx + 1); startAutoplay(); });
              dots.forEach((dot, i) => dot.addEventListener("click", () => { goToSlide(i); startAutoplay(); }));

              startAutoplay();
            });

            // Product Carousels
            document.querySelectorAll(".ib-product-carousel-container").forEach(container => {
              const track = container.querySelector(".ib-carousel-track");
              const prev = container.querySelector(".ib-carousel-prev");
              const next = container.querySelector(".ib-carousel-next");
              if (prev && track) prev.addEventListener("click", () => track.scrollBy({ left: -260, behavior: "smooth" }));
              if (next && track) next.addEventListener("click", () => track.scrollBy({ left: 260, behavior: "smooth" }));
            });

            // Posts Grid Cards Click
            document.querySelectorAll(".ib-post-card").forEach(card => {
              card.addEventListener("click", () => {
                let post = null;
                try {
                  const raw = card.getAttribute("data-post");
                  if (raw) post = JSON.parse(raw);
                } catch {}
                if (post && window.parent && window.parent.openPostPreviewModal) {
                  window.parent.openPostPreviewModal(post);
                }
              });
            });
          }

          if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", initSliders);
          } else {
            initSliders();
          }
        </script>
      </body>
    </html>
  `;

  iframe.srcdoc = previewHtml;
}

async function addNewPagePromptUnified(siteId, siteName, isMainSite) {
  const pagePath = await showPrompt(
    "Create New Page",
    `Enter a route slug (e.g., 'about', 'services') to create a new sub-page. It will be available at: .../${siteId}/[your-slug]`
  );
  if (pagePath === null) return;
  
  const cleanPath = pagePath.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  
  // Try to find if page already exists
  let pages = [];
  try {
    const endpoint = isMainSite ? "/api/tenant/pages?siteId=main" : `/api/tenant/pages?siteId=${siteId}`;
    const res = await apiRequest(endpoint);
    if (res.ok) pages = await res.json();
  } catch {}
  
  const pageExists = pages.some(p => p.page_path === cleanPath);
  if (pageExists) {
    showToast("A page with this route already exists.", "warning");
    return;
  }

  // Create mock/blank page data to open editor
  const pageData = {
    site_id: siteId,
    page_path: cleanPath,
    seo_title: cleanPath === "" ? "Homepage" : cleanPath.toUpperCase(),
    seo_description: "Welcome to our page.",
    html: "",
    css: "",
    json: "{}"
  };

  openVisualBuilder(siteId, cleanPath, pageData);
}

// --- Visual Builder GrapesJS Integration ---
function openVisualBuilder(siteId, pagePath, pageData) {
  currentEditingPage = pageData;
  
  // Create editor DOM overlay
  const overlay = document.createElement("div");
  overlay.id = "grapes-editor-overlay";
  overlay.className = "grapes-editor-wrapper";
  
  overlay.innerHTML = `
    <!-- Grapes Editor Header -->
    <div class="grapes-editor-header">
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="btn btn-secondary" id="btn-builder-close" style="max-width:100px; padding: 6px 12px; font-size:13px;"><i class="fa-solid fa-arrow-left"></i> Exit</button>
        <span style="font-size:13px; font-weight:700; color:var(--text-main);">Editing Layout: <code id="builder-header-path" style="background-color:var(--bg-hover); border:1px solid var(--border-color); padding: 2px 6px; border-radius:4px; font-family:monospace; font-size:12px;">${siteId}/${pagePath || "(index)"}</code></span>
      </div>
      
      <div style="display:flex; gap:10px;">
        <button class="btn btn-secondary" id="btn-builder-seo" style="max-width:160px; padding: 6px 16px; font-size:13px;"><i class="fa-solid fa-circle-info"></i> SEO & Meta</button>
        <button class="btn btn-secondary" id="btn-builder-publish" style="max-width:160px; padding: 6px 16px; font-size:13px;"></button>
        <button class="btn btn-primary" id="btn-builder-save" style="max-width:160px; padding: 6px 16px; font-size:13px;"><i class="fa-solid fa-floppy-disk"></i> Save Layout</button>
      </div>
    </div>
    <!-- Grapes Editor Content Area -->
    <div class="grapes-editor-content">
      <div id="gjs"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  // Initialize GrapesJS
  grapesEditor = grapesjs.init({
    container: "#gjs",
    fromElement: false,
    height: "100%",
    width: "auto",
    storageManager: false, 
    blockManager: {
      appendTo: "", 
    },
    canvas: {
      styles: [
        "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;600;700;800;900&display=swap",
        "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
      ]
    }
  });

  grapesEditor.DomComponents.addType("store-map", {
    isComponent: el => el && el.classList && (el.classList.contains("visitor-map-container") || el.hasAttribute("data-map-component")) ? { type: "store-map" } : false,
    model: {
      defaults: {
        "double-click": "open-map-config-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Map Settings",
            full: true,
            command: "open-map-config-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-map-config-modal", {
    run(editor, sender) {
      openMapConfigModal(siteId, pagePath);
    }
  });

  grapesEditor.DomComponents.addType("partner-logos", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-partner-logos-container") || el.hasAttribute("data-partner-logos")) ? { type: "partner-logos" } : false,
    model: {
      defaults: {
        "double-click": "open-partner-logos-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Partner Logos",
            full: true,
            command: "open-partner-logos-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-partner-logos-modal", {
    run(editor, sender) {
      const selected = editor.getSelected();
      openPartnerLogosModal(selected);
    }
  });

  grapesEditor.DomComponents.addType("product-grid", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-product-grid-container") || el.hasAttribute("data-product-skus")) ? { type: "product-grid" } : false,
    model: {
      defaults: {
        "double-click": "open-product-grid-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Product Showcase",
            full: true,
            command: "open-product-grid-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-product-grid-modal", {
    run(editor, sender) {
      let selected = editor.getSelected();
      openProductGridModal(selected, siteId);
    }
  });

  grapesEditor.DomComponents.addType("product-carousel", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-product-carousel-container") || el.classList.contains("ib-carousel-wrapper")) ? { type: "product-carousel" } : false,
    model: {
      defaults: {
        "double-click": "open-product-carousel-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Product Carousel",
            full: true,
            command: "open-product-carousel-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-product-carousel-modal", {
    run(editor, sender) {
      let selected = editor.getSelected();
      openProductCarouselModal(selected, siteId);
    }
  });

  grapesEditor.DomComponents.addType("hero-banner", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-hero-banner-container") || el.hasAttribute("data-banner-config")) ? { type: "hero-banner" } : false,
    model: {
      defaults: {
        "double-click": "open-hero-banner-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Banner",
            full: true,
            command: "open-hero-banner-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-hero-banner-modal", {
    run(editor, sender) {
      let selected = editor.getSelected();
      openHeroBannerModal(selected, siteId);
    }
  });

  grapesEditor.DomComponents.addType("contact-form", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-site-form-wrapper") || el.hasAttribute("data-form-config") || (el.querySelector && el.querySelector(".ib-site-form"))) ? { type: "contact-form" } : false,
    model: {
      defaults: {
        "double-click": "open-contact-form-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Inquiry Form",
            full: true,
            command: "open-contact-form-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-contact-form-modal", {
    run(editor, sender) {
      let selected = editor.getSelected();
      openContactFormModal(selected, siteId);
    }
  });

  grapesEditor.DomComponents.addType("posts-grid", {
    isComponent: el => el && el.classList && (el.classList.contains("ib-posts-grid-container") || el.hasAttribute("data-posts-config")) ? { type: "posts-grid" } : false,
    model: {
      defaults: {
        "double-click": "open-posts-grid-modal",
        traits: [
          {
            type: "button",
            label: false,
            text: "⚙ Configure Posts Grid",
            full: true,
            command: "open-posts-grid-modal"
          }
        ]
      }
    }
  });

  grapesEditor.Commands.add("open-posts-grid-modal", {
    run(editor, sender) {
      let selected = editor.getSelected();
      openPostsGridModal(selected, siteId);
    }
  });
  
  // Load page HTML and CSS directly into GrapesJS canvas
  grapesEditor.setComponents(pageData.html || "");
  grapesEditor.setStyle(pageData.css || "");
  
  builderHasUnsavedChanges = false;
  grapesEditor.on("component:add component:remove component:update style:update", () => {
    builderHasUnsavedChanges = true;
  });
  
  // Add some basic custom block components for GrapesJS builder
  const bm = grapesEditor.BlockManager;
  
  // 1. Structure: Container & Column
  bm.add("container-block", {
    label: "<div style='text-align:center;'><i class='fa-regular fa-square' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Container</div></div>",
    category: "Layout",
    content: `<div style="padding: 40px 20px; min-height: 150px; background-color: #f9fafb; border: 1px dashed #d1d5db; box-sizing: border-box; border-radius: 6px;"></div>`
  });

  bm.add("column-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-columns' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Column</div></div>",
    category: "Layout",
    content: `<div style="display: flex; gap: 20px; padding: 20px; box-sizing: border-box; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px; padding: 20px; border: 1px dashed #d1d5db; border-radius: 6px; min-height: 100px;">Column 1</div>
                <div style="flex: 1; min-width: 200px; padding: 20px; border: 1px dashed #d1d5db; border-radius: 6px; min-height: 100px;">Column 2</div>
              </div>`
  });

  bm.add("spacer-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-arrows-up-down' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Spacer</div></div>",
    category: "Layout",
    content: `<div style="height: 48px; width: 100%;"></div>`
  });

  bm.add("divider-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-minus' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Divider</div></div>",
    category: "Layout",
    content: `<div style="padding: 20px 0;"><hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 0;" /></div>`
  });

  // 2. Navigation & Actions
  bm.add("navbar-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-bars' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Menu / Nav</div></div>",
    category: "Components",
    content: `
      <nav style="display: flex; align-items: center; justify-content: space-between; padding: 16px 32px; background: #ffffff; border-bottom: 1px solid #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; flex-wrap: wrap; gap: 16px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #0B57D0; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">B</div>
          <span style="font-size: 16px; font-weight: 700; color: #0f172a;">Brand Logo</span>
        </div>
        <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          <a href="#" style="color: #475569; text-decoration: none; font-size: 14px; font-weight: 500;">Home</a>
          <a href="#about" style="color: #475569; text-decoration: none; font-size: 14px; font-weight: 500;">About</a>
          <a href="#products" style="color: #475569; text-decoration: none; font-size: 14px; font-weight: 500;">Products</a>
          <a href="#stores" style="color: #475569; text-decoration: none; font-size: 14px; font-weight: 500;">Store Locator</a>
          <a href="#contact" style="background: #0B57D0; color: #ffffff; text-decoration: none; padding: 8px 18px; border-radius: 8px; font-size: 13px; font-weight: 600;">Contact Us</a>
        </div>
      </nav>
    `
  });

  bm.add("button-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-square-arrow-up-right' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Button</div></div>",
    category: "Components",
    content: `<div style="padding: 10px 0;"><a href="#" style="display: inline-block; padding: 12px 26px; background-color: #0B57D0; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 2px 6px rgba(11,87,208,0.25);">Click Here</a></div>`
  });

  // 3. Contact & Inquiry Form (Dispatches to no-reply@hsgglobal.sg)
  bm.add("form-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-envelope-open-text' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Inquiry Form</div></div>",
    category: "Components",
    content: {
      type: "contact-form",
      content: `
        <div class="ib-site-form-wrapper" data-form-config='{"title":"Send Us an Inquiry","subtitle":"Have questions about our products or retail availability? Fill out the form below.","recipientEmail":"","buttonText":"Send Message"}' style="max-width: 540px; margin: 30px auto; padding: 32px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
          <h3 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 6px;">Send Us an Inquiry</h3>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 20px;">Have questions about our products or retail availability? Fill out the form below.</p>
          
          <form class="ib-site-form" data-site-id="${siteId}" data-recipient-email="" style="display: flex; flex-direction: column; gap: 14px;">
            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Full Name *</label>
              <input type="text" name="name" required placeholder="Your Name" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
            </div>

            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 200px;">
                <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Email Address *</label>
                <input type="email" name="email" required placeholder="you@example.com" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
              </div>
              <div style="flex: 1; min-width: 200px;">
                <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Phone Number</label>
                <input type="tel" name="phone" placeholder="+65 9123 4567" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
              </div>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Subject</label>
              <input type="text" name="subject" placeholder="General Inquiry / Bulk Order" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Message *</label>
              <textarea name="message" required rows="4" placeholder="How can we help you?" style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none; resize: vertical;"></textarea>
            </div>

            <button type="submit" style="height: 42px; background: #0B57D0; color: #ffffff; border: none; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: background 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <i class="fa-solid fa-paper-plane"></i> Send Message
            </button>
            
            <div class="ib-form-status" style="display: none; padding: 10px; border-radius: 8px; font-size: 12.5px; text-align: center;"></div>
          </form>
        </div>
      `
    }
  });

  // 4. Product Catalog Grid
  bm.add("product-grid-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-boxes-stacked' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Product Grid</div></div>",
    category: "Components",
    content: {
      type: "product-grid",
      content: `
        <div class="ib-product-grid-container" data-product-skus='[]' data-meta-config='{"showImage":true,"showSku":true,"showTitle":true,"showSpecs":true,"showButton":true,"columns":3,"buttonText":"Find In Stores","buttonLink":"#stores"}' style="padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
          <div class="ib-product-grid" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; max-width: 1100px; margin: 0 auto;">
            <div style="padding: 32px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc; grid-column: 1 / -1;">
              <i class="fa-solid fa-boxes-stacked" style="margin-right: 6px; color: #0B57D0; font-size: 18px;"></i> Product Showcase (Click '⚙ Configure Product Showcase' in Component Settings or double-click to choose catalog products & metadata)
            </div>
          </div>
        </div>
      `
    }
  });

  // 4b. Product Carousel Block
  bm.add("product-carousel-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-sliders' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Product Carousel</div></div>",
    category: "Components",
    content: {
      type: "product-carousel",
      content: `
        <div class="ib-product-carousel-container" data-product-skus='[]' data-meta-config='{"showImage":true,"showSku":true,"showTitle":true,"showSpecs":true,"showButton":true,"buttonText":"Find In Stores","buttonLink":"#stores"}' style="padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; position: relative;">
          <div style="padding: 32px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc;">
            <i class="fa-solid fa-sliders" style="margin-right: 6px; color: #0B57D0; font-size: 18px;"></i> Product Carousel (Click '⚙ Configure Product Carousel' in Component Settings or double-click to select sliding items)
          </div>
        </div>
      `
    }
  });

  // 4bb. Posts & News Grid Block
  bm.add("posts-grid-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-newspaper' style='font-size:20px; color:#0B57D0;'></i><div style='font-size:10px; margin-top:4px;'>Posts / News</div></div>",
    category: "Components",
    content: {
      type: "posts-grid",
      content: `
        <div class="ib-posts-grid-container" data-posts-config='{"site_id":"${siteId}","category":"ALL","columns":3,"limit":6,"showCover":true,"showCategory":true,"showDate":true,"showPhotoCount":true,"showExcerpt":true,"showButton":true,"buttonText":"Read Article"}' style="padding: 40px 20px; width: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="max-width: 1100px; margin: 0 auto; text-align: center; padding: 36px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; background: #f8fafc; color: #64748b; font-size: 13px; font-weight: 600;">
            <i class="fa-solid fa-newspaper" style="font-size: 24px; color: #0B57D0; margin-bottom: 8px; display: block;"></i>
            Posts / News & Events Feed (Double-click or click '⚙ Configure Posts Grid' in Component Settings to select categories and layout)
          </div>
        </div>
      `
    }
  });

  // 4c. Hero Banner / Image Slider Block
  bm.add("banner-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-panorama' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Hero Banner</div></div>",
    category: "Layout",
    content: {
      type: "hero-banner",
      content: `
        <div class="ib-hero-banner-container" data-banner-config='{"title":"Authentic Culinary Flavors","subtitle":"Discover our signature pastes and seasonings crafted for authentic home cooking and professional kitchens.","buttonText":"Explore Products","buttonLink":"#products","imageUrl":"","overlay":0.4,"height":"480px"}' style="position: relative; width: 100%; min-height: 440px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); display: flex; align-items: center; justify-content: center; text-align: center; padding: 60px 24px; box-sizing: border-box; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden;">
          <div class="ib-hero-banner-content" style="position: relative; z-index: 2; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 16px;">
            <span style="font-size: 12px; font-weight: 700; color: #93C5FD; text-transform: uppercase; letter-spacing: 1.5px; background: rgba(255,255,255,0.1); padding: 4px 14px; border-radius: 20px;">Premium Selection</span>
            <h1 class="ib-hero-title" style="font-size: 38px; font-weight: 800; line-height: 1.2; margin: 0; color: #ffffff;">Authentic Culinary Flavors</h1>
            <p class="ib-hero-subtitle" style="font-size: 16px; color: #E2E8F0; line-height: 1.6; margin: 0; max-width: 620px;">Discover our signature pastes and seasonings crafted for authentic home cooking and professional kitchens.</p>
            <a class="ib-hero-btn" href="#products" style="display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 12px 28px; background: #0B57D0; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 14px rgba(11,87,208,0.4); transition: transform 0.15s ease;">
              Explore Products <i class="fa-solid fa-arrow-right" style="font-size: 12px;"></i>
            </a>
          </div>
        </div>
      `
    }
  });

  // 5. Video Embed
  bm.add("video-block", {
    label: "<div style='text-align:center;'><i class='fa-brands fa-youtube' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Video</div></div>",
    category: "Media",
    content: `
      <div style="padding: 20px 0; max-width: 800px; margin: 0 auto;">
        <div style="position: relative; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 12px; border: 1px solid #e2e8f0; background: #000;">
          <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0;" allowfullscreen></iframe>
        </div>
      </div>
    `
  });

  // 6. Social Links & WhatsApp
  bm.add("social-links-block", {
    label: "<div style='text-align:center;'><i class='fa-brands fa-whatsapp' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Social & Chat</div></div>",
    category: "Components",
    content: `
      <div style="display: flex; gap: 12px; justify-content: center; align-items: center; padding: 24px 10px; flex-wrap: wrap; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <a href="https://wa.me/6583494429" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; background: #25D366; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 30px; font-size: 13px; font-weight: 600; box-shadow: 0 2px 8px rgba(37,211,102,0.25);">
          <i class="fa-brands fa-whatsapp" style="font-size: 18px;"></i> Chat on WhatsApp
        </a>
        <a href="#" target="_blank" style="width: 40px; height: 40px; border-radius: 50%; background: #EFF6FF; color: #0B57D0; display: flex; align-items: center; justify-content: center; text-decoration: none; font-size: 16px; border: 1px solid #DBEAFE;">
          <i class="fa-brands fa-facebook-f"></i>
        </a>
        <a href="#" target="_blank" style="width: 40px; height: 40px; border-radius: 50%; background: #FDF2F8; color: #DB2777; display: flex; align-items: center; justify-content: center; text-decoration: none; font-size: 16px; border: 1px solid #FCE7F3;">
          <i class="fa-brands fa-instagram"></i>
        </a>
        <a href="#" target="_blank" style="width: 40px; height: 40px; border-radius: 50%; background: #F1F5F9; color: #0f172a; display: flex; align-items: center; justify-content: center; text-decoration: none; font-size: 16px; border: 1px solid #E2E8F0;">
          <i class="fa-brands fa-tiktok"></i>
        </a>
      </div>
    `
  });

  // 7. FAQ / Accordion
  bm.add("faq-accordion-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-circle-question' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>FAQ Accordion</div></div>",
    category: "Components",
    content: `
      <div class="ib-faq-wrapper" style="max-width: 680px; margin: 40px auto; padding: 0 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <h3 style="font-size: 22px; font-weight: 700; color: #0f172a; text-align: center; margin-bottom: 24px;">Frequently Asked Questions</h3>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <details style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; background: #ffffff; cursor: pointer;">
            <summary style="font-size: 14px; font-weight: 600; color: #1e293b; outline: none;">Where can I buy these products in Singapore?</summary>
            <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 10px; margin-bottom: 0;">Our products are widely available at FairPrice, Sheng Siong, Prime Supermarket, and leading Asian grocers islandwide. Check our interactive Store Map above for live stock availability.</p>
          </details>
          <details style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; background: #ffffff; cursor: pointer;">
            <summary style="font-size: 14px; font-weight: 600; color: #1e293b; outline: none;">Are your food products Halal certified?</summary>
            <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 10px; margin-bottom: 0;">Yes, all our food items are prepared in accordance with strict international standards and certified Halal by authorized bodies.</p>
          </details>
          <details style="border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; background: #ffffff; cursor: pointer;">
            <summary style="font-size: 14px; font-weight: 600; color: #1e293b; outline: none;">How do I inquire about wholesale or restaurant distribution?</summary>
            <p style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 10px; margin-bottom: 0;">Please use the contact form on this page or message us directly via WhatsApp to discuss trade pricing and carton deliveries.</p>
          </details>
        </div>
      </div>
    `
  });

  // 8. Brand & Retail Partners Block (Component Settings + Randomized True Center Logos)
  bm.add("brand-partners-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-handshake' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Partner Logos</div></div>",
    category: "Components",
    content: {
      type: "partner-logos",
      content: `
        <div class="ib-partner-logos-container" data-partner-logos='[]' style="padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 120px; width: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div class="ib-partner-logos-cloud" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 28px 36px; max-width: 1000px; width: 100%; margin: 0 auto;">
            <div style="padding: 20px 32px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc;">
              <i class="fa-solid fa-handshake" style="margin-right: 6px; color: #0B57D0; font-size: 16px;"></i> Partner Logos Cloud (Click '⚙ Configure Partner Logos' in Component Settings or double-click to add logo PNGs)
            </div>
          </div>
        </div>
      `
    }
  });

  // 9. Testimonials
  bm.add("testimonials-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-comments' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Reviews</div></div>",
    category: "Components",
    content: `
      <section style="padding: 40px 20px; background: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; border-radius: 12px; margin: 30px 0;">
        <h3 style="font-size: 22px; font-weight: 700; color: #0f172a; text-align: center; margin-bottom: 24px;">Loved By Home Cooks & Chefs</h3>
        <div style="display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; max-width: 900px; margin: 0 auto;">
          <div style="flex: 1; min-width: 260px; background: #ffffff; padding: 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="color: #f59e0b; margin-bottom: 8px;"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
            <p style="font-size: 13px; color: #475569; font-style: italic; line-height: 1.5;">"The authentic taste saves so much cooking time. My family loves every meal made with these pastes!"</p>
            <span style="font-size: 12px; font-weight: 700; color: #1e293b;">— Michelle T., Singapore</span>
          </div>
          <div style="flex: 1; min-width: 260px; background: #ffffff; padding: 20px; border-radius: 10px; border: 1px solid #e2e8f0; box-shadow: 0 2px 6px rgba(0,0,0,0.03);">
            <div style="color: #f59e0b; margin-bottom: 8px;"><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i><i class="fa-solid fa-star"></i></div>
            <p style="font-size: 13px; color: #475569; font-style: italic; line-height: 1.5;">"Consistent quality and great aroma. Excellent for commercial kitchen prep as well."</p>
            <span style="font-size: 12px; font-weight: 700; color: #1e293b;">— Chef Dave K., SG Catering</span>
          </div>
        </div>
      </section>
    `
  });

  // 9. Footer Block
  bm.add("footer-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-shoe-prints' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Footer</div></div>",
    category: "Layout",
    content: `
      <footer style="background: #0f172a; color: #94a3b8; padding: 48px 32px 24px 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="display: flex; justify-content: space-between; gap: 32px; flex-wrap: wrap; max-width: 1100px; margin: 0 auto; padding-bottom: 32px; border-bottom: 1px solid #334155;">
          <div style="max-width: 320px;">
            <h4 style="color: #ffffff; font-size: 18px; margin-top: 0; margin-bottom: 10px;">Brand Showcase</h4>
            <p style="font-size: 13px; line-height: 1.6; margin: 0;">Delivering authentic flavor and premium grocery distribution across Singapore.</p>
          </div>
          <div style="display: flex; gap: 40px; flex-wrap: wrap;">
            <div>
              <div style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; margin-bottom: 10px;">Quick Links</div>
              <div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">
                <a href="#" style="color: #94a3b8; text-decoration: none;">Home</a>
                <a href="#about" style="color: #94a3b8; text-decoration: none;">About</a>
                <a href="#products" style="color: #94a3b8; text-decoration: none;">Products</a>
                <a href="#stores" style="color: #94a3b8; text-decoration: none;">Store Locator</a>
              </div>
            </div>
            <div>
              <div style="color: #ffffff; font-size: 13px; font-weight: 700; text-transform: uppercase; margin-bottom: 10px;">Contact</div>
              <div style="font-size: 13px; line-height: 1.6;">
                <div>Singapore</div>
                <div>sales@hsgglobal.sg</div>
                <div>+65 8349 4429</div>
              </div>
            </div>
          </div>
        </div>
        <div style="text-align: center; font-size: 12px; color: #64748b; margin-top: 24px;">
          INTERNAL BRIDGE · © 2026 HSG Global Pte Ltd. All rights reserved.
        </div>
      </footer>
    `
  });

  // 10. General Content Blocks
  bm.add("title-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-heading' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Title</div></div>",
    category: "Typography",
    content: `<h2 style="font-size: 28px; font-weight: bold; margin-bottom: 12px; color: #111827; font-family: sans-serif;">Section Title</h2>`
  });

  bm.add("text-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-align-left' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Paragraph</div></div>",
    category: "Typography",
    content: `<p style="padding: 10px 0; color: #4b5563; font-family: sans-serif; line-height: 1.6;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>`
  });

  bm.add("icon-block", {
    label: "<div style='text-align:center;'><i class='fa-regular fa-star' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Icon</div></div>",
    category: "Media",
    content: `<span style="display: inline-block; text-align: center;"><i class="fa-solid fa-star" style="font-size: 32px; color: #3b82f6; padding: 10px;"></i></span>`
  });

  bm.add("image-placeholder", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-image' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Image</div></div>",
    category: "Media",
    content: { type: "image", style: { width: "100%", "max-width": "500px", "min-height": "150px" } }
  });

  bm.add("section-hero", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-rectangle-ad' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Hero Block</div></div>",
    category: "Components",
    content: `<header style="padding: 80px 20px; text-align: center; background-color: #0B57D0; color: white; font-family: sans-serif;">
                <h1 style="font-size: 40px; font-weight: 800; margin-bottom:12px;">Stunning Headline</h1>
                <p style="font-size: 16px; opacity: 0.9; margin-bottom:24px; max-width: 600px; margin-left: auto; margin-right: auto;">Provide some interesting subtitle describing your brand value proposition and product quality.</p>
                <a href="#stores" style="background:#ffffff; color:#0B57D0; text-decoration:none; padding:12px 28px; border-radius:8px; font-weight:700; font-size:14px; display:inline-block;">Find In Stores</a>
              </header>`,
  });

  bm.add("feature-columns", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-list-check' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Features</div></div>",
    category: "Components",
    content: `<div style="display: flex; gap: 20px; padding: 40px 20px; font-family: sans-serif; justify-content: space-around; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 250px; text-align: center; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff;">
                  <i class="fa-solid fa-bolt" style="font-size: 32px; color: #0B57D0; margin-bottom: 12px;"></i>
                  <h3 style="margin-bottom: 8px; font-weight: 700;">Fast Delivery</h3>
                  <p style="color: #6b7280; font-size:14px;">Instant restock cycles and direct islandwide distribution.</p>
                </div>
                <div style="flex: 1; min-width: 250px; text-align: center; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fff;">
                  <i class="fa-solid fa-shield-halved" style="font-size: 32px; color: #10b981; margin-bottom: 12px;"></i>
                  <h3 style="margin-bottom: 8px; font-weight: 700;">Premium Quality</h3>
                  <p style="color: #6b7280; font-size:14px;">Strictly audited production standards and fresh ingredients.</p>
                </div>
              </div>`,
  });

  bm.add("store-map", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-map-location-dot' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Store Map</div></div>",
    category: "Components",
    content: {
      type: "store-map",
      content: `<div id="visitor-store-map" style="height: 500px; width: 100%; border-radius: 12px; border: 1px solid #e4e4e7; background-color: #f4f4f5; box-shadow: 0 1px 3px 0 rgba(0,0,0,0.05); display: flex; align-items: center; justify-content: center; color: #a1a1aa; font-weight: 600; font-size: 13px;">
                  Map Placeholder (Double-click component or click 'Configure Map settings' in the settings panel to choose brand and products)
                </div>`
    }
  });

  // Bind Buttons
  document.getElementById("btn-builder-close").addEventListener("click", async () => {
    if (builderHasUnsavedChanges) {
      if (!(await showConfirm(
        "Discard Changes",
        "Any unsaved layout modifications will be discarded. Close builder?",
        { confirmText: "Discard & Exit", variant: "danger" }
      ))) {
        return;
      }
    }

    overlay.remove();
    grapesEditor = null;
    if (activeSidebar === "admin") {
      renderSitePreviewDashboard("main", "Main Site", true);
    } else if (activeSidebar === "dashboard") {
      renderTenantDashboardSubView();
    } else {
      const site = tenantSites.find(s => s.id === activeSidebar);
      renderSitePreviewDashboard(activeSidebar, site ? site.name : activeSidebar, false);
    }
  });
  
  const updatePublishButtonState = (published) => {
    const publishBtn = document.getElementById("btn-builder-publish");
    if (!publishBtn) return;
    if (published) {
      publishBtn.className = "btn btn-secondary";
      publishBtn.innerHTML = `<i class="fa-solid fa-eye-slash"></i> Unpublish`;
      publishBtn.style.color = "#dc2626";
      publishBtn.style.borderColor = "#fca5a5";
    } else {
      publishBtn.className = "btn btn-secondary";
      publishBtn.innerHTML = `<i class="fa-solid fa-upload"></i> Publish Page`;
      publishBtn.style.color = "#16a34a";
      publishBtn.style.borderColor = "#86efac";
    }
  };

  updatePublishButtonState(currentEditingPage.published !== 0);

  document.getElementById("btn-builder-publish").addEventListener("click", async () => {
    const isCurrentlyPublished = currentEditingPage.published !== 0;
    if (isCurrentlyPublished) {
      if (await showConfirm(
        "Take Page Offline",
        "Are you sure you want to unpublish this page? This will take it offline immediately. Visitors will no longer be able to access it until you choose to publish it again.",
        { confirmText: "Yes, Unpublish", variant: "danger" }
      )) {
        await updatePagePublishState(siteId, pagePath, false);
      }
    } else {
      await updatePagePublishState(siteId, pagePath, true);
    }
  });

  async function updatePagePublishState(siteId, pagePath, publishState) {
    const publishBtn = document.getElementById("btn-builder-publish");
    publishBtn.disabled = true;
    publishBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Updating...`;

    const html = grapesEditor.getHtml();
    let css = grapesEditor.getCss() || "";
    if (currentEditingPage && currentEditingPage.css && !css.includes(".site-navbar")) {
      css = currentEditingPage.css + "\n" + css;
    }
    const json = JSON.stringify(grapesEditor.getProjectData());

    const endpoint = siteId === "main" ? "/api/admin/pages" : "/api/tenant/pages";

    try {
      const res = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({
          site_id: siteId,
          page_path: pagePath,
          seo_title: currentEditingPage.seo_title,
          seo_description: currentEditingPage.seo_description,
          featured_image: currentEditingPage.featured_image,
          meta_tags: currentEditingPage.meta_tags || "[]",
          html: html,
          css: css,
          json: json,
          published: publishState ? 1 : 0
        })
      });

      if (res.ok) {
        currentEditingPage.published = publishState ? 1 : 0;
        updatePublishButtonState(publishState);
        showToast(publishState ? "Page published successfully!" : "Page unpublished successfully!");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to update publish state.", "danger");
        updatePublishButtonState(currentEditingPage.published !== 0);
      }
    } catch (e) {
      showToast("Network error updating page state.", "danger");
      updatePublishButtonState(currentEditingPage.published !== 0);
    } finally {
      publishBtn.disabled = false;
    }
  }

  document.getElementById("btn-builder-seo").addEventListener("click", () => {
    showSEOInspectorModal(siteId, pagePath, (newSlug) => {
      pagePath = newSlug;
      const headerCode = document.getElementById("builder-header-path");
      if (headerCode) {
        headerCode.innerText = `${siteId}/${pagePath || "(index)"}`;
      }
    });
  });
  
  document.getElementById("btn-builder-save").addEventListener("click", async () => {
    await saveBuilderData(siteId, pagePath);
  });
}

// SEO modal helper inside editor
function showSEOInspectorModal(siteId, pagePath, onSlugChanged) {
  const oldModal = document.getElementById("seo-modal-panel");
  if (oldModal) oldModal.remove();
  
  const modal = document.createElement("div");
  modal.id = "seo-modal-panel";
  modal.className = "seo-overlay";
  
  let tags = [];
  try {
    tags = typeof currentEditingPage.meta_tags === "string" ? JSON.parse(currentEditingPage.meta_tags) : (currentEditingPage.meta_tags || []);
  } catch {}
  
  const keywordsObj = tags.find(t => t.name === "keywords") || { content: "" };
  
  let slugAvailable = true;
  let lastCheckedSlug = pagePath;

  modal.innerHTML = `
    <div class="seo-modal">
      <div class="seo-modal-header">
        <h3 style="font-size:14px; font-weight:700;">Page SEO & Metadata Config</h3>
        <button class="btn-icon" id="close-seo-modal" style="border:none; background:none;"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="seo-modal-body">
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">Page Route Slug</label>
          ${pagePath === "" ? `
            <input type="text" class="form-input" value="/" disabled style="width:100%; height:36px; padding:0 12px; font-size:13px; border:1px solid var(--border-color); border-radius:8px; background-color:var(--bg-hover); cursor:not-allowed; opacity:0.7;">
            <span style="font-size:10px; color:var(--text-muted); margin-top:4px; display:block;">Root Homepage route cannot be modified.</span>
          ` : `
            <div style="display:flex;">
              <input type="text" class="form-input" id="seo-field-slug" value="${pagePath}" style="flex:1; height:36px; padding:0 12px; font-size:13px; border:1px solid var(--border-color); border-radius:8px; outline:none; box-sizing:border-box;">
              <button class="btn btn-secondary" id="btn-seo-check-slug" style="height:36px; font-size:12px; margin-left:8px; max-width:120px; white-space:nowrap;">Check Availability</button>
            </div>
            <div id="seo-slug-feedback" style="font-size:11px; margin-top:4px; font-weight:600;"></div>
          `}
        </div>
        <div class="form-group">
          <label class="form-label">SEO Page Title</label>
          <input type="text" class="form-input" id="seo-field-title" value="${currentEditingPage.seo_title || ""}" style="max-width:100%;">
        </div>
        <div class="form-group">
          <label class="form-label">SEO Meta Description</label>
          <textarea class="form-input" id="seo-field-desc" rows="3" style="max-width:100%; font-family:var(--font-body);">${currentEditingPage.seo_description || ""}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Featured Social Share Image URL</label>
          <input type="text" class="form-input" id="seo-field-image" value="${currentEditingPage.featured_image || ""}" style="max-width:100%;">
        </div>
        <div class="form-group">
          <label class="form-label">SEO Search Keywords (comma-separated)</label>
          <input type="text" class="form-input" id="seo-field-keywords" value="${keywordsObj.content || ""}" style="max-width:100%;">
        </div>
      </div>
      <div class="seo-modal-footer">
        <button class="btn btn-secondary" id="btn-cancel-seo">Discard</button>
        <button class="btn btn-primary" id="btn-save-seo">Apply Configuration</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const close = () => modal.remove();
  document.getElementById("close-seo-modal").addEventListener("click", close);
  document.getElementById("btn-cancel-seo").addEventListener("click", close);
  
  if (pagePath !== "") {
    const slugInput = modal.querySelector("#seo-field-slug");
    const checkBtn = modal.querySelector("#btn-seo-check-slug");
    const feedbackDiv = modal.querySelector("#seo-slug-feedback");
    
    checkBtn.addEventListener("click", async () => {
      const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!slug) {
        feedbackDiv.innerText = "Slug cannot be empty.";
        feedbackDiv.style.color = "var(--danger-color)";
        slugAvailable = false;
        return;
      }

      feedbackDiv.innerText = "Checking availability...";
      feedbackDiv.style.color = "var(--text-muted)";

      try {
        const res = await apiRequest(`/api/tenant/pages/check-slug?siteId=${siteId}&slug=${slug}&exclude=${pagePath}`);
        if (res.ok) {
          const data = await res.json();
          if (data.available) {
            feedbackDiv.innerText = "✓ Slug is available.";
            feedbackDiv.style.color = "var(--success-color)";
            slugAvailable = true;
            lastCheckedSlug = slug;
          } else {
            feedbackDiv.innerText = "✗ Slug is already in use.";
            feedbackDiv.style.color = "var(--danger-color)";
            slugAvailable = false;
          }
        } else {
          feedbackDiv.innerText = "Error checking slug.";
          feedbackDiv.style.color = "var(--danger-color)";
          slugAvailable = false;
        }
      } catch {
        feedbackDiv.innerText = "Network error checking slug.";
        feedbackDiv.style.color = "var(--danger-color)";
        slugAvailable = false;
      }
    });

    slugInput.addEventListener("input", () => {
      const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (slug === pagePath) {
        feedbackDiv.innerText = "";
        slugAvailable = true;
        lastCheckedSlug = pagePath;
      } else {
        feedbackDiv.innerText = "Slug changed. Click Check Availability.";
        feedbackDiv.style.color = "var(--warning-color)";
        slugAvailable = false;
      }
    });
  }

  document.getElementById("btn-save-seo").addEventListener("click", async () => {
    let newSlug = pagePath;
    if (pagePath !== "") {
      newSlug = document.getElementById("seo-field-slug").value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (!newSlug) {
        showToast("Route slug cannot be empty.", "warning");
        return;
      }
      if (newSlug !== pagePath && (!slugAvailable || newSlug !== lastCheckedSlug)) {
        showToast("Please check slug availability first.", "warning");
        return;
      }
    }

    currentEditingPage.seo_title = document.getElementById("seo-field-title").value.trim();
    currentEditingPage.seo_description = document.getElementById("seo-field-desc").value.trim();
    currentEditingPage.featured_image = document.getElementById("seo-field-image").value.trim();
    
    const keywordsVal = document.getElementById("seo-field-keywords").value.trim();
    const otherTags = tags.filter(t => t.name !== "keywords");
    if (keywordsVal) {
      otherTags.push({ name: "keywords", content: keywordsVal });
    }
    currentEditingPage.meta_tags = JSON.stringify(otherTags);
    
    builderHasUnsavedChanges = true;
    close();
    
    const saveRes = await saveBuilderData(siteId, pagePath, newSlug !== pagePath ? newSlug : undefined);
    if (saveRes && saveRes.success && saveRes.page_path !== pagePath) {
      if (onSlugChanged) {
        onSlugChanged(saveRes.page_path);
      }
    }
  });
}

// Save builder payload back to database
async function saveBuilderData(siteId, pagePath, newPagePath) {
  const saveBtn = document.getElementById("btn-builder-save");
  saveBtn.disabled = true;
  saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  
  const html = grapesEditor.getHtml();
  let css = grapesEditor.getCss() || "";
  if (currentEditingPage && currentEditingPage.css && !css.includes(".site-navbar")) {
    css = currentEditingPage.css + "\n" + css;
  }
  const json = JSON.stringify(grapesEditor.getProjectData());
  
  const endpoint = siteId === "main" ? "/api/admin/pages" : "/api/tenant/pages";
  
  try {
    const res = await apiRequest(endpoint, {
      method: "POST",
      body: JSON.stringify({
        site_id: siteId,
        page_path: pagePath,
        new_page_path: newPagePath,
        seo_title: currentEditingPage.seo_title,
        seo_description: currentEditingPage.seo_description,
        featured_image: currentEditingPage.featured_image,
        meta_tags: currentEditingPage.meta_tags || "[]",
        html: html,
        css: css,
        json: json,
        published: currentEditingPage.published !== 0 ? 1 : 0
      })
    });
    
    if (res.ok) {
      builderHasUnsavedChanges = false;
      showToast("Page layout saved successfully!");
      if (newPagePath) {
        return { success: true, page_path: newPagePath };
      }
      return { success: true, page_path: pagePath };
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to save page layout.", "danger");
      return { success: false };
    }
  } catch (e) {
    showToast("Network synchronization failed.", "danger");
    return { success: false };
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Layout`;
  }
}

// --- Public Visitor Site Rendering Core ---
async function renderPublicSiteView(siteId, pagePath) {
  const app = document.getElementById("app");
  if (!document.getElementById("app-loader")) {
    app.innerHTML = `
      <div id="app-loader" style="display:flex; height:100vh; align-items:center; justify-content:center; background:var(--bg-primary); box-sizing:border-box;">
        <div style="width: 32px; height: 32px; border: 4px solid rgba(11,87,208,0.1); border-left-color: var(--accent-color); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
      </div>
    `;
  }
  
  try {
    let targetSiteId = siteId || "main";
    let targetPagePath = pagePath || "";
    
    const pageUrl = targetPagePath
      ? `${API_BASE}/api/sites/${encodeURIComponent(targetSiteId)}/pages/${encodeURIComponent(targetPagePath)}`
      : `${API_BASE}/api/sites/${encodeURIComponent(targetSiteId)}/pages`;
    let res = await fetch(pageUrl);
    
    if (!res.ok && targetPagePath === "" && targetSiteId !== "main") {
      targetSiteId = "main";
      targetPagePath = siteId;
      const fallbackUrl = targetPagePath
        ? `${API_BASE}/api/sites/${encodeURIComponent(targetSiteId)}/pages/${encodeURIComponent(targetPagePath)}`
        : `${API_BASE}/api/sites/${encodeURIComponent(targetSiteId)}/pages`;
      res = await fetch(fallbackUrl);
    }
    
    if (!res.ok) {
      if (res.status === 403) {
        renderErrorMessage("403 Frozen", "This website is currently frozen or suspended by the administrator.");
      } else {
        renderErrorMessage("404 Not Found", "The requested page does not exist on this server.");
      }
      return;
    }
    
    const page = await res.json();
    
    // 1. Inject SEO Metadata
    document.title = page.seo_title || "HSG Global Site";

    // Inject favicon dynamically
    setDynamicFavicon(page.favicon || page.site_favicon || DEFAULT_FAVICON);
    
    Array.from(document.querySelectorAll("meta[data-dynamic='seo']")).forEach(el => el.remove());
    
    if (page.seo_description) {
      const desc = document.createElement("meta");
      desc.setAttribute("data-dynamic", "seo");
      desc.name = "description";
      desc.content = page.seo_description;
      document.head.appendChild(desc);
    }
    
    if (page.featured_image) {
      const ogImg = document.createElement("meta");
      ogImg.setAttribute("data-dynamic", "seo");
      ogImg.property = "og:image";
      ogImg.content = page.featured_image;
      document.head.appendChild(ogImg);
    }
    
    let tags = [];
    try {
      tags = typeof page.meta_tags === "string" ? JSON.parse(page.meta_tags) : (page.meta_tags || []);
    } catch {}
    
    tags.forEach(t => {
      const tag = document.createElement("meta");
      tag.setAttribute("data-dynamic", "seo");
      if (t.name) tag.name = t.name;
      if (t.property) tag.property = t.property;
      tag.content = t.content;
      document.head.appendChild(tag);
    });
    
    // Inject dynamic CSS style tag
    Array.from(document.querySelectorAll("style[data-dynamic='seo']")).forEach(el => el.remove());
    const styleTag = document.createElement("style");
    styleTag.setAttribute("data-dynamic", "seo");
    styleTag.innerHTML = page.css || "";
    document.head.appendChild(styleTag);
    
    // 2. Render HTML Content
    document.body.style.overflow = "auto";
    app.innerHTML = page.html || `
      <div style="padding:100px 20px; text-align:center; font-family:sans-serif; color:#666;">
        <h1>Homepage is empty.</h1>
        <p>Use GrapesJS visual editor to design this layout.</p>
      </div>
    `;

    // 3. Initialize dynamic features like the store stock locator map, forms, and randomized partner logos cloud
    const mapDiv = document.getElementById("visitor-store-map");
    if (mapDiv) {
      initVisitorMap(targetSiteId, mapDiv, targetPagePath);
    }
    initSiteForms(targetSiteId);
    initPartnerLogosCloud();
    initProductCarousels();
    initProductImageSliders();
    
  } catch (err) {
    renderErrorMessage("500 Server Error", "Could not connect to the database resolver.");
  }
}

function initPartnerLogosCloud() {
  const containers = document.querySelectorAll(".ib-partner-logos-container");
  containers.forEach(container => {
    let logos = [];
    try {
      const raw = container.getAttribute("data-partner-logos");
      if (raw) logos = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {}

    if (!Array.isArray(logos) || logos.length === 0) return;

    // Randomize / shuffle array order on every reload/visit
    const shuffled = [...logos].sort(() => Math.random() - 0.5);

    const cloud = container.querySelector(".ib-partner-logos-cloud") || container;
    cloud.innerHTML = shuffled.map(item => {
      if (!item || !item.url) return "";
      // Slight random organic rotation between -2.5deg and +2.5deg for natural layout
      const rot = (Math.random() * 5 - 2.5).toFixed(1);
      return `
        <div class="ib-partner-logo-item" style="display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; transition: transform 0.2s ease, filter 0.2s ease; transform: rotate(${rot}deg);" title="${item.name || ''}">
          <img src="${item.url}" alt="${item.name || 'Partner Logo'}" style="max-height: 48px; max-width: 140px; width: auto; height: auto; object-fit: contain; filter: grayscale(15%); transition: transform 0.2s ease, filter 0.2s ease;" onmouseover="this.style.transform='scale(1.1)'; this.style.filter='none';" onmouseout="this.style.transform='scale(1)'; this.style.filter='grayscale(15%)';" onerror="this.style.display='none';" />
        </div>
      `;
    }).join("");
  });
}

function initSiteForms(siteId) {
  const forms = document.querySelectorAll(".ib-site-form");
  forms.forEach(form => {
    if (form.getAttribute("data-bound") === "true") return;
    form.setAttribute("data-bound", "true");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector("button[type='submit']");
      const statusDiv = form.querySelector(".ib-form-status");
      const formSiteId = form.getAttribute("data-site-id") || siteId || "";
      const recipientEmail = form.getAttribute("data-recipient-email") || "";

      const formData = new FormData(form);
      const name = String(formData.get("name") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const phone = String(formData.get("phone") || "").trim();
      const subject = String(formData.get("subject") || "").trim();
      const message = String(formData.get("message") || "").trim();

      if (!name || !email || !message) {
        if (statusDiv) {
          statusDiv.style.display = "block";
          statusDiv.style.background = "#FEF2F2";
          statusDiv.style.color = "#DC2626";
          statusDiv.style.border = "1px solid #FECACA";
          statusDiv.innerText = "Please fill in all required fields.";
        }
        return;
      }

      const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Sending...`;
      }
      if (statusDiv) statusDiv.style.display = "none";

      try {
        const res = await fetch(`${API_BASE}/api/public/submit-form`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site_id: formSiteId,
            name,
            email,
            phone,
            subject,
            message,
            recipient_email: recipientEmail
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          form.reset();
          if (statusDiv) {
            statusDiv.style.display = "block";
            statusDiv.style.background = "#F0FDF4";
            statusDiv.style.color = "#16A34A";
            statusDiv.style.border = "1px solid #BBF7D0";
            statusDiv.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${data.message || "Thank you! Your message has been sent successfully."}`;
          }
        } else {
          if (statusDiv) {
            statusDiv.style.display = "block";
            statusDiv.style.background = "#FEF2F2";
            statusDiv.style.color = "#DC2626";
            statusDiv.style.border = "1px solid #FECACA";
            statusDiv.innerText = data.error || "Failed to submit form. Please try again.";
          }
        }
      } catch (err) {
        if (statusDiv) {
          statusDiv.style.display = "block";
          statusDiv.style.background = "#FEF2F2";
          statusDiv.style.color = "#DC2626";
          statusDiv.style.border = "1px solid #FECACA";
          statusDiv.innerText = "Network error. Please try again later.";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalBtnHtml;
        }
      }
    });
  });
}

function renderErrorMessage(title, message) {
  const app = document.getElementById("app");
  
  let errorCode = "404";
  let displayMessage = message;
  
  if (title.includes("404")) {
    errorCode = "404";
    displayMessage = "The page you are looking for is temporarily unavailable. Please check the URL or try again later.";
  } else if (title.includes("403")) {
    errorCode = "403";
    displayMessage = "Access is restricted. This website has been suspended or frozen by the system administrator.";
  } else {
    errorCode = title.split(" ")[0] || "500";
  }

  app.innerHTML = `
    <div style="display:flex; flex-direction:column; height:100vh; background:var(--bg-primary); color:var(--text-main); font-family:var(--font-body, 'Inter', sans-serif); padding:40px; box-sizing:border-box; justify-content:space-between; align-items:center; text-align:center;">
      
      <!-- Top header branding -->
      <div style="font-family:var(--font-display, 'Outfit', sans-serif); font-size:14px; font-weight:700; color:var(--text-muted); letter-spacing:0.05em; text-transform:uppercase;">
        HSG Global
      </div>

      <!-- Center content -->
      <div style="display:flex; flex-direction:column; align-items:center; max-width:480px; margin-bottom:120px;">
        <!-- Big center code -->
        <h1 style="font-size:120px; font-weight:900; line-height:1; margin:0 0 16px 0; font-family:var(--font-display, 'Outfit', sans-serif); color:var(--text-main); letter-spacing:-0.05em;">
          ${errorCode}
        </h1>
        
        <!-- Error title -->
        <h2 style="font-size:20px; font-weight:700; color:var(--accent-color); margin:0 0 12px 0; font-family:var(--font-display, 'Outfit', sans-serif);">
          ${title}
        </h2>
        
        <!-- Detailed text -->
        <p style="color:var(--text-muted); font-size:14px; line-height:1.6; margin:0; font-family:var(--font-body, 'Inter', sans-serif);">
          ${displayMessage}
        </p>
      </div>

      <!-- Bottom spacer for vertical centering balance -->
      <div style="height:20px;"></div>
    </div>
  `;
}

// --- Site Settings Modal ---
// --- Site Settings Modal ---
function openSiteSettingsModal(site) {
  const overlay = document.createElement("div");
  overlay.id = "site-settings-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
  overlay.style.backdropFilter = "blur(4px)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "999999";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.2s ease";

  let uploadedFaviconUrl = site.favicon ? site.favicon.replace(/ /g, "%20") : "";
  let uploadedFeaturedImageUrl = (site.social_preview_image || site.featured_image || "").replace(/ /g, "%20");
  let slugAvailable = true;
  let lastCheckedSlug = site.id;

  const isAdmin = currentUser.email === "hsgglobalpteltd@gmail.com" || currentUserRole === "Administrator";

  const card = document.createElement("div");
  card.style.width = "500px";
  card.style.backgroundColor = "var(--bg-card, #ffffff)";
  card.style.border = "1px solid var(--border-color, #D4D4D8)";
  card.style.borderRadius = "12px";
  card.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
  card.style.transform = "scale(0.95)";
  card.style.transition = "transform 0.2s ease";
  card.style.fontFamily = "var(--font-display, 'Outfit', sans-serif)";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.maxHeight = "90vh";

  card.innerHTML = `
    <!-- Header -->
    <div style="padding: 18px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main);"><i class="fa-solid fa-sliders" style="margin-right: 8px;"></i>Site Settings</h3>
      <button id="btn-close-settings" style="background: transparent; border: none; font-size: 16px; color: var(--text-muted); cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
    </div>

    <!-- Scrollable Body -->
    <div style="flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
      
      <!-- 1. Site Name -->
      <div>
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">SITE DISPLAY NAME</label>
        <input type="text" id="settings-site-name" value="${site.name}" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
      </div>

      <!-- 2. Slug -->
      <div>
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">SITE ROUTE SLUG</label>
        <div style="display: flex;">
          <input type="text" id="settings-site-slug" value="${site.id}" style="flex: 1; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
          <button class="btn btn-secondary" id="btn-check-slug" style="height: 36px; font-size: 12px; margin-left: 8px; max-width: 120px; white-space: nowrap;">Check Availability</button>
        </div>
        <div id="slug-feedback" style="font-size: 11px; margin-top: 4px; font-weight: 600;"></div>
      </div>

      <!-- 3. Favicon -->
      <div>
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">FAVICON (MAX 512KB)</label>
        <div style="display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); padding: 10px; border-radius: 8px; background-color: var(--bg-hover);">
          <div id="favicon-preview-container" style="width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            <img src="${uploadedFaviconUrl || DEFAULT_FAVICON}" id="favicon-preview" style="width: 32px; height: 32px; object-fit: contain; ${uploadedFaviconUrl ? 'filter: none; opacity: 1;' : 'filter: grayscale(100%); opacity: 0.4;'}" onerror="this.onerror=null; this.src='${DEFAULT_FAVICON}'; this.style.filter='grayscale(100%)'; this.style.opacity='0.4';" />
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <input type="file" id="settings-favicon-file" accept="image/png, image/jpeg, image/x-icon, image/gif, image/svg+xml" style="display: none;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary" id="btn-upload-favicon" style="height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; margin: 0;">Upload Image</button>
              ${uploadedFaviconUrl ? `
                <button class="btn btn-danger" id="btn-remove-favicon" style="height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; background-color: var(--danger-color, #ef4444); color: white; border: none; border-radius: 6px; cursor: pointer; margin: 0; font-weight: 600;">Remove</button>
              ` : ""}
            </div>
            <span id="favicon-status" style="font-size: 10px; color: var(--text-muted);">${uploadedFaviconUrl ? "Favicon loaded" : "No file chosen"}</span>
          </div>
        </div>
      </div>

      <!-- 4. Default Featured Image / Social Share -->
      <div>
        <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">DEFAULT FEATURED IMAGE / SOCIAL SHARE (MAX 2MB)</label>
        <div style="display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); padding: 10px; border-radius: 8px; background-color: var(--bg-hover);">
          <div id="featured-image-preview-container" style="width: 64px; height: 40px; border-radius: 6px; background-color: #fff; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            ${uploadedFeaturedImageUrl ? `
              <img src="${uploadedFeaturedImageUrl}" id="featured-image-preview" style="width: 100%; height: 100%; object-fit: cover;" />
            ` : `
              <i class="fa-solid fa-image" style="color: var(--text-muted); font-size: 14px;"></i>
            `}
          </div>
          <div style="flex: 1; display: flex; flex-direction: column; gap: 4px;">
            <input type="file" id="settings-featured-image-file" accept="image/png, image/jpeg, image/webp, image/gif" style="display: none;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary" id="btn-upload-featured-image" style="height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; margin: 0;">Upload Image</button>
              ${uploadedFeaturedImageUrl ? `
                <button class="btn btn-danger" id="btn-remove-featured-image" style="height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; background-color: var(--danger-color, #ef4444); color: white; border: none; border-radius: 6px; cursor: pointer; margin: 0; font-weight: 600;">Remove</button>
              ` : ""}
            </div>
            <span id="featured-image-status" style="font-size: 10px; color: var(--text-muted);">${uploadedFeaturedImageUrl ? "Cover image loaded" : "No file chosen (uses gray fallback)"}</span>
          </div>
        </div>
      </div>

      <!-- Toggle for More Settings -->
      <div id="toggle-more-settings" style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; padding: 10px 0; border-top: 1px dashed var(--border-color); margin-top: 8px; user-select: none;">
        <span style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
          <i class="fa-solid fa-chevron-right" id="more-settings-icon" style="font-size: 11px; transition: transform 0.2s ease;"></i>
          More Setting
        </span>
      </div>

      <!-- Collapsible Container -->
      <div id="more-settings-section" style="display: none; flex-direction: column; gap: 16px; transition: all 0.2s ease;">
        <!-- 4. Custom Domain (Coming Soon) -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label style="font-size: 12px; font-weight: 700; color: var(--text-main);">CUSTOM DOMAIN</label>
            <span style="font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 4px; background-color: #fef3c7; color: #d97706; border: 1px solid #fde68a;">COMING SOON</span>
          </div>
          <input type="text" id="settings-site-domain" value="${site.custom_domain || ''}" disabled placeholder="e.g. www.mycompany.com" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box; background-color: var(--bg-hover); cursor: not-allowed; opacity: 0.7;">
        </div>

        <div style="border-top: 1px dashed var(--border-color); margin: 6px 0;"></div>

        <!-- 5. Facebook Pixel -->
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;"><i class="fa-brands fa-facebook" style="color:#1877f2; margin-right: 6px;"></i>FACEBOOK PIXEL ID</label>
          <input type="text" id="settings-fb-pixel" value="${site.fb_pixel || ''}" placeholder="e.g. 123456789012345" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
        </div>

        <!-- 6. Google AdSense -->
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;"><i class="fa-brands fa-google" style="color:#ea4335; margin-right: 6px;"></i>GOOGLE ADSENSE ID</label>
          <input type="text" id="settings-adsense-id" value="${site.adsense_id || ''}" placeholder="e.g. ca-pub-1234567890123456" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
        </div>

        <!-- 7. TikTok Pixel -->
        <div>
          <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;"><i class="fa-brands fa-tiktok" style="color:var(--text-main); margin-right: 6px;"></i>TIKTOK PIXEL ID</label>
          <input type="text" id="settings-tiktok-pixel" value="${site.tiktok_pixel || ''}" placeholder="e.g. C1234567890ABCDE" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
        </div>
      </div>

      <!-- 8. Allowed Brands Allocation -->
      ${isAdmin && site.id !== "main" ? `
        <div style="border-top: 1px dashed var(--border-color); padding-top: 16px; margin-top: 8px; box-sizing: border-box;">
          <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">ALLOWED BRANDS</label>
          <div id="site-settings-brands-container" style="display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border-color); border-radius: 8px; max-height: 150px; overflow-y: auto; padding: 10px; background-color: var(--bg-hover); box-sizing: border-box;">
            <span style="font-size: 11px; color: var(--text-muted); font-style: italic; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-spinner fa-spin"></i> Loading brands catalog...
            </span>
          </div>
          
          <!-- Add Brand Input with Datalist Autocomplete & Button -->
          <div style="display: flex; gap: 8px; margin-top: 8px;">
            <input type="text" id="input-add-brand-name" list="settings-brands-datalist" placeholder="Type brand name to assign..." style="flex: 1; height: 32px; padding: 0 10px; font-size: 12px; border: 1px solid var(--border-color); border-radius: 6px; outline: none; box-sizing: border-box; background: var(--bg-card); color: var(--text-color);">
            <datalist id="settings-brands-datalist"></datalist>
            <button class="btn btn-secondary" id="btn-add-brand-by-name" style="height: 32px; font-size: 11px; padding: 0 12px; max-width: 100px; white-space: nowrap; margin: 0; display: flex; align-items: center; justify-content: center;">Assign Brand</button>
          </div>
        </div>
      ` : ""}

      <!-- 9. Assigned Users Allocation -->
      ${isAdmin && site.id !== "main" ? `
        <div style="border-top: 1px dashed var(--border-color); padding-top: 16px; margin-top: 8px; box-sizing: border-box;">
          <label style="display: block; font-size: 12px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">ASSIGNED USERS (EMAILS)</label>
          <input type="text" id="settings-assigned-emails" value="${(site.tenant_emails || []).join(', ')}" placeholder="e.g. user1@test.com, user2@test.com" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box; background: var(--bg-card); color: var(--text-color);">
          <span style="font-size: 10px; color: var(--text-muted); margin-top: 4px; display: block;">Enter comma-separated emails. Leave blank for Administrator only (owned by admin).</span>
        </div>
      ` : ""}

    </div>

    <!-- Footer -->
    <div style="padding: 16px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 8px; flex-shrink: 0;">
      <button id="settings-btn-cancel" style="height: 36px; padding: 0 16px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-hover); color: var(--text-muted); cursor: pointer; transition: all 0.15s ease;">Cancel</button>
      <button id="settings-btn-save" style="height: 36px; padding: 0 20px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid var(--accent-color); background-color: var(--accent-color); color: #ffffff; cursor: pointer; transition: all 0.15s ease; min-width: 100px;">Save Settings</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Asynchronously fetch allowed brands in the background to prevent lagging
  let loadedBrands = [];
  let selectedAllowedBrandIds = [];

  if (isAdmin && site.id !== "main") {
    const rawBrandAssigned = site.brand_assigned;
    if (rawBrandAssigned) {
      try {
        const parsed = typeof rawBrandAssigned === "string"
          ? JSON.parse(rawBrandAssigned)
          : (rawBrandAssigned || []);
        selectedAllowedBrandIds = (Array.isArray(parsed) ? parsed : []).map(x => String(x).trim()).filter(Boolean);
      } catch {}
    }

    const renderAssignedBrands = () => {
      const container = card.querySelector("#site-settings-brands-container");
      if (!container) return;

      const assigned = loadedBrands.filter(b => selectedAllowedBrandIds.includes(String(b.ID)));
      
      container.innerHTML = assigned.length === 0
        ? `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No brands currently assigned.</span>`
        : assigned.map(b => `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding: 6px 0; box-sizing: border-box;">
              <span style="font-size: 12px; font-weight: 600; color: var(--text-main);">${b["Display Name"] || b.Name} (ID: ${b.ID})</span>
              <button type="button" class="btn-remove-assigned-brand" data-id="${b.ID}" style="background: none; border: none; color: var(--danger-color, #ef4444); cursor: pointer; font-size: 12px; padding: 4px; display: flex; align-items: center; justify-content: center; margin: 0;">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `).join("");

      // Bind remove buttons
      container.querySelectorAll(".btn-remove-assigned-brand").forEach(btn => {
        btn.addEventListener("click", () => {
          const idToRemove = String(btn.getAttribute("data-id"));
          selectedAllowedBrandIds = selectedAllowedBrandIds.filter(id => String(id) !== idToRemove);
          renderAssignedBrands();
          showToast("Brand unassigned.");
        });
      });
    };

    const brandCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=1515484464&single=true&output=csv";
    getCachedCSVData("cached_brands", brandCsvUrl).then((data) => {
      loadedBrands = Array.isArray(data) ? data : [];
      
      // Populate Datalist Options
      const datalist = card.querySelector("#settings-brands-datalist");
      if (datalist) {
        datalist.innerHTML = loadedBrands.map(b => {
          const name = b["Display Name"] || b.Name || "";
          return `<option value="${name}"></option>`;
        }).join("");
      }

      renderAssignedBrands();
    }).catch((e) => {
      console.error("Failed to load brands CSV:", e);
      const container = card.querySelector("#site-settings-brands-container");
      if (container) {
        container.innerHTML = `<span style="font-size: 11px; color: var(--danger-color); font-style: italic;">Failed to load brands catalog.</span>`;
      }
    });

    // Add brand by name lookup binding
    const addBrandInput = card.querySelector("#input-add-brand-name");
    const addBrandBtn = card.querySelector("#btn-add-brand-by-name");
    if (addBrandBtn && addBrandInput) {
      addBrandBtn.addEventListener("click", () => {
        const term = addBrandInput.value.trim().toLowerCase();
        if (!term) return;

        if (loadedBrands.length === 0) {
          showToast("Brands catalog is still loading, please wait.", "warning");
          return;
        }

        const matched = loadedBrands.find(b => 
          (b.Name && b.Name.toLowerCase() === term) ||
          (b["Display Name"] && b["Display Name"].toLowerCase() === term) ||
          (String(b.ID).toLowerCase() === term)
        );

        if (matched) {
          const idStr = String(matched.ID);
          if (selectedAllowedBrandIds.includes(idStr)) {
            showToast("Brand is already assigned.", "warning");
            return;
          }
          selectedAllowedBrandIds.push(idStr);
          renderAssignedBrands();
          addBrandInput.value = "";
          showToast(`Assigned brand: ${matched["Display Name"] || matched.Name}`);
        } else {
          showToast("No matching brand found in database catalog.", "warning");
        }
      });
    }
  }

  const nameInput = card.querySelector("#settings-site-name");
  const slugInput = card.querySelector("#settings-site-slug");
  const checkBtn = card.querySelector("#btn-check-slug");
  const feedbackDiv = card.querySelector("#slug-feedback");
  const fileInput = card.querySelector("#settings-favicon-file");
  const uploadBtn = card.querySelector("#btn-upload-favicon");
  const fileStatus = card.querySelector("#favicon-status");
  const previewContainer = card.querySelector("#favicon-preview-container");

  const closeBtn = card.querySelector("#btn-close-settings");
  const cancelBtn = card.querySelector("#settings-btn-cancel");
  const saveBtn = card.querySelector("#settings-btn-save");

  const toggleMoreBtn = card.querySelector("#toggle-more-settings");
  const moreSection = card.querySelector("#more-settings-section");
  const moreIcon = card.querySelector("#more-settings-icon");

  toggleMoreBtn.addEventListener("click", () => {
    const isOpen = moreSection.style.display === "flex";
    if (isOpen) {
      moreSection.style.display = "none";
      moreIcon.style.transform = "rotate(0deg)";
    } else {
      moreSection.style.display = "flex";
      moreIcon.style.transform = "rotate(90deg)";
    }
  });

  const checkSlugAvailability = async () => {
    const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!slug) {
      feedbackDiv.innerText = "Slug cannot be empty.";
      feedbackDiv.style.color = "var(--danger-color)";
      slugAvailable = false;
      return;
    }

    feedbackDiv.innerText = "Checking availability...";
    feedbackDiv.style.color = "var(--text-muted)";

    try {
      const res = await apiRequest(`/api/tenant/sites/check-slug?slug=${slug}&exclude=${site.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.available) {
          feedbackDiv.innerText = "✓ Slug is available.";
          feedbackDiv.style.color = "var(--success-color)";
          slugAvailable = true;
          lastCheckedSlug = slug;
        } else {
          feedbackDiv.innerText = "✗ Slug is already in use.";
          feedbackDiv.style.color = "var(--danger-color)";
          slugAvailable = false;
        }
      } else {
        feedbackDiv.innerText = "Error checking slug.";
        feedbackDiv.style.color = "var(--danger-color)";
        slugAvailable = false;
      }
    } catch {
      feedbackDiv.innerText = "Network error checking slug.";
      feedbackDiv.style.color = "var(--danger-color)";
      slugAvailable = false;
    }
  };

  checkBtn.addEventListener("click", checkSlugAvailability);

  slugInput.addEventListener("input", () => {
    const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (slug === site.id) {
      feedbackDiv.innerText = "";
      slugAvailable = true;
      lastCheckedSlug = site.id;
    } else {
      feedbackDiv.innerText = "Slug changed. Click Check Availability.";
      feedbackDiv.style.color = "var(--warning-color)";
      slugAvailable = false;
    }
  });

  const bindRemoveFavicon = () => {
    const removeBtn = card.querySelector("#btn-remove-favicon");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        uploadedFaviconUrl = "";
        previewContainer.innerHTML = `<img src="${DEFAULT_FAVICON}" id="favicon-preview" style="width: 32px; height: 32px; object-fit: contain; filter: grayscale(100%); opacity: 0.4;" />`;
        fileStatus.innerText = "Default favicon";
        removeBtn.remove();
        showToast("Favicon reset to default. Save changes to apply.");
      });
    }
  };
  bindRemoveFavicon();

  uploadBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (file.size > 524288) {
      showToast("Favicon size exceeds the 512KB limit.", "warning");
      fileInput.value = "";
      fileStatus.innerText = "No file chosen";
      return;
    }

    fileStatus.innerText = `Uploading: ${file.name}...`;
    uploadBtn.disabled = true;

    try {
      const fileData = await file.arrayBuffer();
      const filename = `favicons/${site.id}/${Date.now()}_${file.name}`;
      const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${currentUser.accessToken}`,
          "Content-Type": file.type || "application/octet-stream"
        },
        body: fileData
      });

      if (res.ok) {
        const data = await res.json();
        uploadedFaviconUrl = data.url;
        previewContainer.innerHTML = `<img src="${uploadedFaviconUrl}" id="favicon-preview" style="width: 32px; height: 32px; object-fit: contain; filter: none; opacity: 1;" />`;
        fileStatus.innerText = `✓ Uploaded: ${file.name}`;
        
        // Dynamically append Remove button if not present
        if (!card.querySelector("#btn-remove-favicon")) {
          const btnContainer = uploadBtn.parentElement;
          const removeBtn = document.createElement("button");
          removeBtn.className = "btn btn-danger";
          removeBtn.id = "btn-remove-favicon";
          removeBtn.style.cssText = "height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; background-color: var(--danger-color, #ef4444); color: white; border: none; border-radius: 6px; cursor: pointer; margin: 0; font-weight: 600;";
          removeBtn.innerText = "Remove";
          btnContainer.appendChild(removeBtn);
          bindRemoveFavicon();
        }
        
        showToast("Favicon uploaded successfully.");
      } else {
        fileStatus.innerText = "✗ Upload failed.";
        showToast("Failed to upload favicon to storage.", "danger");
      }
    } catch (e) {
      fileStatus.innerText = "✗ Network error.";
      showToast("Network error uploading favicon.", "danger");
    } finally {
      uploadBtn.disabled = false;
    }
  });

  // Featured Image Upload Handlers
  const featuredFileInput = card.querySelector("#settings-featured-image-file");
  const featuredUploadBtn = card.querySelector("#btn-upload-featured-image");
  const featuredFileStatus = card.querySelector("#featured-image-status");
  const featuredPreviewContainer = card.querySelector("#featured-image-preview-container");

  const bindRemoveFeaturedImage = () => {
    const removeBtn = card.querySelector("#btn-remove-featured-image");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        uploadedFeaturedImageUrl = "";
        featuredPreviewContainer.innerHTML = `<i class="fa-solid fa-image" style="color: var(--text-muted); font-size: 14px;"></i>`;
        featuredFileStatus.innerText = "No file chosen (uses gray fallback)";
        removeBtn.remove();
        showToast("Featured cover image removed. Save changes to apply.");
      });
    }
  };
  bindRemoveFeaturedImage();

  featuredUploadBtn.addEventListener("click", () => featuredFileInput.click());

  featuredFileInput.addEventListener("change", async () => {
    const file = featuredFileInput.files[0];
    if (!file) return;

    if (file.size > 2097152) {
      showToast("Featured image size exceeds the 2MB limit.", "warning");
      featuredFileInput.value = "";
      featuredFileStatus.innerText = "No file chosen (uses gray fallback)";
      return;
    }

    featuredFileStatus.innerText = `Uploading: ${file.name}...`;
    featuredUploadBtn.disabled = true;

    try {
      const fileData = await file.arrayBuffer();
      const filename = `featured/${site.id}/${Date.now()}_${file.name}`;
      const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${currentUser.accessToken}`,
          "Content-Type": file.type || "application/octet-stream"
        },
        body: fileData
      });

      if (res.ok) {
        const data = await res.json();
        uploadedFeaturedImageUrl = data.url;
        featuredPreviewContainer.innerHTML = `<img src="${uploadedFeaturedImageUrl}" id="featured-image-preview" style="width: 100%; height: 100%; object-fit: cover;" />`;
        featuredFileStatus.innerText = `✓ Uploaded: ${file.name}`;
        
        // Dynamically append Remove button if not present
        if (!card.querySelector("#btn-remove-featured-image")) {
          const btnContainer = featuredUploadBtn.parentElement;
          const removeBtn = document.createElement("button");
          removeBtn.className = "btn btn-danger";
          removeBtn.id = "btn-remove-featured-image";
          removeBtn.style.cssText = "height: 28px; font-size: 11px; padding: 0 12px; max-width: 120px; background-color: var(--danger-color, #ef4444); color: white; border: none; border-radius: 6px; cursor: pointer; margin: 0; font-weight: 600;";
          removeBtn.innerText = "Remove";
          btnContainer.appendChild(removeBtn);
          bindRemoveFeaturedImage();
        }
        
        showToast("Featured cover image uploaded successfully.");
      } else {
        featuredFileStatus.innerText = "✗ Upload failed.";
        showToast("Failed to upload featured image to storage.", "danger");
      }
    } catch (e) {
      featuredFileStatus.innerText = "✗ Network error.";
      showToast("Network error uploading featured image.", "danger");
    } finally {
      featuredUploadBtn.disabled = false;
    }
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    card.style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);

  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const slug = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");

    if (!name) {
      showToast("Site display name cannot be empty.", "warning");
      return;
    }

    if (!slug) {
      showToast("Site route slug cannot be empty.", "warning");
      return;
    }

    if (slug !== site.id && (!slugAvailable || slug !== lastCheckedSlug)) {
      showToast("Please check slug availability first.", "warning");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    try {
      const fbPixel = card.querySelector("#settings-fb-pixel").value.trim();
      const adsenseId = card.querySelector("#settings-adsense-id").value.trim();
      const tiktokPixel = card.querySelector("#settings-tiktok-pixel").value.trim();

      // Gather brand_assigned if saving as Administrator
      let brandAssignedArray = undefined;
      let assignedEmails = undefined;
      if (isAdmin && site.id !== "main") {
        brandAssignedArray = selectedAllowedBrandIds;
        const emailsInput = card.querySelector("#settings-assigned-emails");
        if (emailsInput) {
          assignedEmails = emailsInput.value.split(",")
            .map(e => e.trim().toLowerCase())
            .filter(Boolean);
        }
      }

      const res = await apiRequest("/api/tenant/sites/update", {
        method: "POST",
        body: JSON.stringify({
          site_id: site.id,
          new_id: slug !== site.id ? slug : undefined,
          name: name,
          favicon: uploadedFaviconUrl,
          featured_image: uploadedFeaturedImageUrl,
          custom_domain: site.custom_domain || "",
          fb_pixel: fbPixel,
          adsense_id: adsenseId,
          tiktok_pixel: tiktokPixel,
          brand_assigned: brandAssignedArray,
          assigned_emails: assignedEmails
        })
      });

      if (res.ok) {
        showToast("Site settings updated successfully!");
        closeModal();
        if (slug !== site.id) {
          activeSidebar = slug;
        }

        // Refresh settings list dynamically
        try {
          const listRes = await apiRequest("/api/tenant/sites");
          if (listRes.ok) {
            tenantSites = await listRes.json();
          }
        } catch (e) {
          console.error("Failed to refresh tenant sites:", e);
        }

        renderDashboardView();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to save settings.", "danger");
      }
    } catch {
      showToast("Network error saving site settings.", "danger");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = "Save Settings";
    }
  });

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    card.style.transform = "scale(1)";
  });
}

function openUserProfileModal() {
  const overlay = document.createElement("div");
  overlay.id = "user-profile-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100vw";
  overlay.style.height = "100vh";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.4)";
  overlay.style.backdropFilter = "blur(4px)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = "999999";
  overlay.style.opacity = "0";
  overlay.style.transition = "opacity 0.2s ease";

  const card = document.createElement("div");
  card.style.width = "400px";
  card.style.backgroundColor = "var(--bg-card, #ffffff)";
  card.style.border = "1px solid var(--border-color, #D4D4D8)";
  card.style.borderRadius = "12px";
  card.style.padding = "24px";
  card.style.boxShadow = "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
  card.style.transform = "scale(0.95)";
  card.style.transition = "transform 0.2s ease";
  card.style.fontFamily = "var(--font-display, 'Outfit', sans-serif)";

  const displayName = currentTenant?.name || currentUser.displayName || "";
  const displayPhone = currentTenant?.phone || "";

  card.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 4px 0; font-size: 16px; font-weight: 700; color: var(--text-main);"><i class="fa-solid fa-user-gear" style="margin-right: 8px;"></i>Edit Profile</h3>
      <p style="margin: 0; font-size: 12px; color: var(--text-muted);">Update your account display name and phone number.</p>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 14px; margin-bottom: 20px;">
      <div>
        <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">DISPLAY NAME</label>
        <input type="text" id="profile-name" value="${displayName}" placeholder="Your Name" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">PHONE NUMBER</label>
        <input type="text" id="profile-phone" value="${displayPhone}" placeholder="e.g. +65 1234 5678" style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; outline: none; box-sizing: border-box;">
      </div>
      <div>
        <label style="display: block; font-size: 11px; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">EMAIL (READ-ONLY)</label>
        <input type="text" value="${currentUser.email}" disabled style="width: 100%; height: 36px; padding: 0 12px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; background-color: var(--bg-hover); outline: none; box-sizing: border-box; cursor: not-allowed; opacity: 0.7;">
      </div>
    </div>

    <div style="display: flex; justify-content: flex-end; gap: 8px;">
      <button id="profile-btn-cancel" style="height: 36px; padding: 0 16px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid var(--border-color); background-color: var(--bg-hover); color: var(--text-muted); cursor: pointer; transition: all 0.15s ease;">Cancel</button>
      <button id="profile-btn-save" style="height: 36px; padding: 0 20px; font-size: 13px; font-weight: 700; border-radius: 8px; border: 1px solid var(--accent-color); background-color: var(--accent-color); color: #ffffff; cursor: pointer; transition: all 0.15s ease; min-width: 80px;">Save Profile</button>
    </div>
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const nameInput = card.querySelector("#profile-name");
  const phoneInput = card.querySelector("#profile-phone");
  const cancelBtn = card.querySelector("#profile-btn-cancel");
  const saveBtn = card.querySelector("#profile-btn-save");

  setTimeout(() => nameInput.focus(), 50);

  const closeModal = () => {
    overlay.style.opacity = "0";
    card.style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  cancelBtn.onclick = closeModal;

  saveBtn.onclick = async () => {
    const nameVal = nameInput.value.trim();
    const phoneVal = phoneInput.value.trim();

    if (!nameVal) {
      showToast("Name cannot be empty.", "warning");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;

    try {
      const res = await apiRequest("/api/tenant/profile/update", {
        method: "POST",
        body: JSON.stringify({ name: nameVal, phone: phoneVal })
      });

      if (res.ok) {
        const data = await res.json();
        currentTenant = { ...data.tenant, role: currentUserRole };
        
        currentUser.displayName = data.tenant.name;
        
        showToast("Profile updated successfully!");
        closeModal();
        
        renderDashboardView();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "Failed to update profile.", "danger");
      }
    } catch {
      showToast("Network error updating profile.", "danger");
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = "Save Profile";
    }
  };

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    card.style.transform = "scale(1)";
  });
}

// --- Map Config Modal inside Editor ---
async function openMapConfigModal(siteId, pagePath = "") {
  // Create modal container overlay
  const overlay = document.createElement("div");
  overlay.id = "map-config-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="map-config-modal-card" style="
      width: 450px;
      max-width: 90%;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px; box-sizing:border-box;">
        <h3 style="margin:0; font-size:16px; font-weight:700; color:var(--text-main);">Configure Store Map Stock</h3>
        <button id="map-modal-close" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:16px;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <div id="map-modal-loading" style="text-align:center; padding:30px 0; color:var(--text-muted);">
        <i class="fa-solid fa-spinner fa-spin" style="font-size:24px; color:var(--accent-color); margin-bottom:8px;"></i>
        <div style="font-size:12px;">Loading catalog data...</div>
      </div>

      <div id="map-modal-content" style="display:none; flex-direction:column; gap:16px; box-sizing:border-box;">
        <div style="display:flex; flex-direction:column; gap:6px;">
          <label style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform: uppercase; tracking-wider;">Select Brand</label>
          <select id="map-modal-brand-select" style="width:100%; border:1px solid #E2E8F0; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; outline:none; background:#FFFFFF; color:var(--text-main); cursor:pointer; box-shadow:0 1px 2px rgba(0,0,0,0.03);"></select>
        </div>

        <!-- Center Coordinates & Zoom Settings (System Managed) -->
        <div style="display:none;">
          <input id="map-modal-lat" type="number" step="any" placeholder="1.3521" />
          <input id="map-modal-lng" type="number" step="any" placeholder="103.8198" />
          <input id="map-modal-zoom" type="number" min="1" max="20" placeholder="12" />
        </div>

        <div style="display:flex; flex-direction:column; gap:6px; flex:1; min-height:0; box-sizing:border-box;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <label style="font-size:11px; font-weight:700; color:var(--text-muted); text-transform: uppercase; tracking-wider;">Select Products</label>
            <div style="display:flex; gap:8px; font-size:10px; font-weight:700; color:var(--accent-color);">
              <button id="map-modal-select-all" style="background:none; border:none; cursor:pointer; padding:0; color:var(--accent-color); font-weight:700;">All</button>
              <span>|</span>
              <button id="map-modal-select-none" style="background:none; border:none; cursor:pointer; padding:0; color:var(--accent-color); font-weight:700;">None</button>
            </div>
          </div>
          <div id="map-modal-products-list" style="border:1px solid #E2E8F0; border-radius:8px; background:#F8FAFC; color:var(--text-main); max-height:220px; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px; box-sizing:border-box;">
            <!-- Checkboxes injected here -->
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid #E2E8F0; padding-top:16px;">
          <button id="map-modal-cancel" style="padding:8px 16px; border:1px solid #E2E8F0; border-radius:8px; background:#FFFFFF; color:var(--text-muted); font-size:12px; font-weight:600; cursor:pointer;">Cancel</button>
          <button id="map-modal-save" style="padding:8px 16px; border:none; border-radius:8px; background:var(--accent-color); color:white; font-size:12px; font-weight:600; cursor:pointer;">Save Config</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Animate in
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("map-config-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("map-config-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("map-modal-close").addEventListener("click", closeModal);
  document.getElementById("map-modal-cancel").addEventListener("click", closeModal);

  try {
    // Read local attributes from GrapesJS component first (Page-specific configuration)
    const selectedComponent = grapesEditor.getSelected();
    let selectedBrandId = "";
    let selectedSkus = [];
    let defaultLat = "1.3521";
    let defaultLng = "103.8198";
    let defaultZoom = "12";

    if (selectedComponent) {
      const attrs = selectedComponent.getAttributes();
      selectedBrandId = attrs["data-brand-id"] || "";
      try {
        selectedSkus = JSON.parse(attrs["data-product-skus"] || "[]");
      } catch {}
      defaultLat = attrs["data-center-lat"] || "1.3521";
      defaultLng = attrs["data-center-lng"] || "103.8198";
      defaultZoom = attrs["data-zoom"] || "12";
    }

    // Read existing SKUs from D1 if local component attributes are empty
    if (!selectedSkus || selectedSkus.length === 0) {
      try {
        const configRes = await apiRequest(`/api/tenant/sites/map-config?site_id=${siteId}&page_path=${pagePath}`);
        if (configRes.ok) {
          const configData = await configRes.json();
          if (configData.map_product_skus) {
            const parsed = typeof configData.map_product_skus === "string"
              ? JSON.parse(configData.map_product_skus)
              : configData.map_product_skus;
            selectedSkus = (Array.isArray(parsed) ? parsed : []).map(x => String(x).trim()).filter(Boolean);
          }
        }
      } catch (e) {
        console.error("Error loading map config SKUs from server:", e);
      }
    }

    // Populate Latitude, Longitude, and Zoom inputs
    document.getElementById("map-modal-lat").value = defaultLat;
    document.getElementById("map-modal-lng").value = defaultLng;
    document.getElementById("map-modal-zoom").value = defaultZoom;

    // Fetch brands and products catalog
    const brandCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=1515484464&single=true&output=csv";
    const productCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=140966730&single=true&output=csv";

    const [brands, products] = await Promise.all([
      getCachedCSVData("cached_brands", brandCsvUrl),
      getCachedCSVData("cached_products", productCsvUrl)
    ]);

    // Read brand_assigned freshly from D1 sites for the current site
    let allowedBrandIds = [];
    try {
      const sitesRes = await apiRequest("/api/tenant/sites");
      if (sitesRes.ok) {
        const freshSites = await sitesRes.json();
        tenantSites = freshSites;
        const currentSite = freshSites.find(s => s.id === siteId);
        if (currentSite && currentSite.brand_assigned) {
          const parsed = typeof currentSite.brand_assigned === "string"
            ? JSON.parse(currentSite.brand_assigned)
            : (currentSite.brand_assigned || []);
          allowedBrandIds = (Array.isArray(parsed) ? parsed : []).map(x => String(x).trim()).filter(Boolean);
        }
      }
    } catch (e) {
      console.error("Failed to load site brand_assigned:", e);
    }

    let filteredBrands = brands.filter(b => allowedBrandIds.includes(String(b.ID)));
    if (filteredBrands.length === 0) {
      filteredBrands = brands;
    }

    if (!selectedBrandId || !filteredBrands.some(b => String(b.ID) === selectedBrandId)) {
      if (filteredBrands.length > 0) {
        selectedBrandId = String(filteredBrands[0].ID);
      }
    }

    const brandSelect = document.getElementById("map-modal-brand-select");
    brandSelect.innerHTML = ""; // Clear existing options
    filteredBrands.forEach((brand) => {
      const opt = document.createElement("option");
      opt.value = String(brand.ID);
      opt.textContent = brand["Display Name"] || brand.Name || brand.ID;
      if (String(brand.ID) === selectedBrandId) {
        opt.selected = true;
      }
      brandSelect.appendChild(opt);
    });

    const productsListDiv = document.getElementById("map-modal-products-list");

    const renderProductCheckboxes = (brandId) => {
      productsListDiv.innerHTML = "";
      const brandProducts = products.filter(p => {
        const bId = p["Brands ID"] || p["Brand ID"];
        return String(bId) === String(brandId);
      });

      if (brandProducts.length === 0) {
        productsListDiv.innerHTML = `<span style="font-size:12px; color:#a1a1aa; font-style:italic; text-align:center; margin:auto;">No products for this brand.</span>`;
        return;
      }

      brandProducts.forEach(p => {
        const label = document.createElement("label");
        label.style.cssText = "display:flex; align-items:start; gap:10px; padding:8px 10px; background:#FFFFFF; border:1px solid #E2E8F0; border-radius:8px; cursor:pointer; font-size:12px; text-align:left; box-sizing:border-box; box-shadow:0 1px 2px rgba(0,0,0,0.03);";
        
        const isChecked = selectedSkus.includes(String(p.SKU));
        label.innerHTML = `
          <input type="checkbox" class="product-sku-checkbox" value="${p.SKU}" ${isChecked ? "checked" : ""} style="margin-top:2px; cursor:pointer;">
          <div style="display:flex; flex-direction:column; line-height:1.2;">
            <span style="font-weight:700; color:#27272a;">${p["Display Name"]}</span>
            <span style="font-size:10px; color:#71717a; font-family:monospace; margin-top:2px;">${p.SKU}</span>
          </div>
        `;
        productsListDiv.appendChild(label);
      });
    };

    renderProductCheckboxes(selectedBrandId);

    brandSelect.addEventListener("change", (e) => {
      selectedBrandId = e.target.value;
      selectedSkus = []; // Reset selected skus when brand changes
      renderProductCheckboxes(selectedBrandId);
    });

    // Select All / Select None
    document.getElementById("map-modal-select-all").addEventListener("click", () => {
      document.querySelectorAll(".product-sku-checkbox").forEach(cb => cb.checked = true);
    });
    document.getElementById("map-modal-select-none").addEventListener("click", () => {
      document.querySelectorAll(".product-sku-checkbox").forEach(cb => cb.checked = false);
    });

    // Hide loader, show content
    document.getElementById("map-modal-loading").style.display = "none";
    document.getElementById("map-modal-content").style.display = "flex";

    // Save configuration
    document.getElementById("map-modal-save").addEventListener("click", async () => {
      const checkedBoxes = document.querySelectorAll(".product-sku-checkbox:checked");
      const checkedSkus = Array.from(checkedBoxes).map(cb => cb.value);

      const latVal = document.getElementById("map-modal-lat").value || "1.3521";
      const lngVal = document.getElementById("map-modal-lng").value || "103.8198";
      const zoomVal = document.getElementById("map-modal-zoom").value || "12";

      const saveBtn = document.getElementById("map-modal-save");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {
        // Save attributes locally on the GrapesJS component in the page layout design
        if (selectedComponent) {
          selectedComponent.setAttributes({
            "data-brand-id": selectedBrandId,
            "data-product-skus": JSON.stringify(checkedSkus),
            "data-center-lat": latVal,
            "data-center-lng": lngVal,
            "data-zoom": zoomVal
          });
          
          const mapEl = selectedComponent.getEl();
          if (mapEl) {
            const placeholder = mapEl.querySelector("#visitor-store-map");
            if (placeholder) {
              placeholder.textContent = `Map Configured - Brand: ${selectedBrandId}, Products: ${checkedSkus.length} active. Center: ${latVal}, ${lngVal}, Zoom: ${zoomVal}`;
            }
          }
          builderHasUnsavedChanges = true;
        }

        // Silent site default update backup
        let token = "";
        if (auth && auth.currentUser) {
          token = await auth.currentUser.getIdToken();
        }

        await apiRequest("/api/tenant/sites/map-config", {
          method: "POST",
          body: JSON.stringify({
            site_id: siteId,
            page_path: pagePath,
            map_brand_id: selectedBrandId,
            map_product_skus: checkedSkus,
            map_center_lat: parseFloat(latVal),
            map_center_lng: parseFloat(lngVal),
            map_zoom: parseInt(zoomVal)
          })
        });

        showToast("Map configuration saved successfully!");
        closeModal();
      } catch {
        showToast("Failed to save map configuration.", "danger");
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Config";
      }
    });

  } catch (err) {
    document.getElementById("map-modal-loading").innerHTML = `
      <i class="fa-solid fa-circle-exclamation" style="font-size:24px; color:#ef4444; margin-bottom:8px;"></i>
      <div style="font-size:12px; color:#ef4444; font-weight:600;">Failed to load data</div>
    `;
  }
}

// --- Partner Logos Config Modal inside Editor ---
async function openPartnerLogosModal(selectedComponent) {
  let initialLogos = [];
  if (selectedComponent) {
    const attrs = selectedComponent.getAttributes();
    try {
      const raw = attrs["data-partner-logos"];
      if (raw) initialLogos = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {}
  }

  let logos = Array.isArray(initialLogos) ? [...initialLogos] : [];

  const overlay = document.createElement("div");
  overlay.id = "partner-logos-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="partner-logos-modal-card" style="
      width: 520px;
      max-width: 92%;
      max-height: 88vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-shapes" style="margin-right: 8px; color: #0B57D0;"></i>Configure Partner Logos</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Add partner & retailer PNG logos. They float dynamically around true center on each visit.</p>
        </div>
        <button id="btn-close-partner-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Scrollable Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Add New Logo Row -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <span style="font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase;">Add Partner Logo</span>
          
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input type="text" id="partner-new-name" placeholder="Partner Name (e.g. FairPrice)" style="flex: 1; min-width: 140px; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff;" />
            <input type="text" id="partner-new-url" placeholder="Or paste Logo PNG URL..." style="flex: 1.5; min-width: 180px; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff;" />
          </div>

          <div style="display: flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="file" id="partner-file-input" accept="image/png,image/svg+xml,image/webp,image/jpeg" style="position: absolute; opacity: 0; width: 0.1px; height: 0.1px; overflow: hidden; z-index: -1;" />
              <label for="partner-file-input" class="btn btn-secondary" id="btn-partner-upload" style="height: 32px; padding: 0 12px; font-size: 11.5px; font-weight: 600; border-radius: 6px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
                <i class="fa-solid fa-cloud-arrow-up" style="color: #0B57D0;"></i> <span id="partner-upload-text">Upload PNG</span>
              </label>
            </div>
            <button type="button" class="btn btn-primary" id="btn-add-partner-item" style="height: 32px; padding: 0 14px; font-size: 12px; font-weight: 600; border-radius: 6px; margin: 0;">
              <i class="fa-solid fa-plus"></i> Add to List
            </button>
          </div>
        </div>

        <!-- Current Logos List -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 12px; font-weight: 700; color: #1e293b;">Configured Logos</span>
            <span style="font-size: 11px; color: #64748b;" id="partner-logos-count">${logos.length} logos</span>
          </div>
          <div id="partner-logos-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow-y: auto;">
            <!-- Rendered below -->
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-partner-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-partner-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Logos</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("partner-logos-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("partner-logos-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-partner-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-partner-modal").addEventListener("click", closeModal);

  const renderLogosList = () => {
    const listDiv = document.getElementById("partner-logos-list");
    const countSpan = document.getElementById("partner-logos-count");
    if (!listDiv) return;

    countSpan.innerText = `${logos.length} logos`;
    if (logos.length === 0) {
      listDiv.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 12px; background: #F8FAFC; border-radius: 8px; border: 1px dashed #cbd5e1;">No logos added yet. Add a partner logo above.</div>`;
      return;
    }

    listDiv.innerHTML = logos.map((item, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; gap: 12px;">
        <div style="width: 50px; height: 34px; background: repeating-conic-gradient(#f1f5f9 0% 25%, #ffffff 0% 50%) 50% / 10px 10px; border-radius: 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid #e2e8f0; flex-shrink: 0;">
          <img src="${item.url}" alt="${item.name || ''}" style="max-width: 100%; max-height: 100%; object-fit: contain;" />
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.name || 'Unnamed Partner'}</div>
          <div style="font-size: 10.5px; color: #64748b; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${item.url}</div>
        </div>
        <button class="btn-del-partner" data-idx="${idx}" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #fee2e2; background: #fff5f5; color: #ef4444; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join("");

    listDiv.querySelectorAll(".btn-del-partner").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        logos.splice(idx, 1);
        renderLogosList();
      });
    });
  };

  renderLogosList();

  // Handle Upload File
  const fileInput = document.getElementById("partner-file-input");
  const uploadText = document.getElementById("partner-upload-text");
  const uploadBtn = document.getElementById("btn-partner-upload");
  const nameInput = document.getElementById("partner-new-name");
  const urlInput = document.getElementById("partner-new-url");

  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      if (uploadText) uploadText.innerText = "Uploading...";
      if (uploadBtn) uploadBtn.style.pointerEvents = "none";

      try {
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const resStr = String(reader.result || "");
            resolve(resStr.includes(",") ? resStr.split(",")[1] : resStr);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const ext = file.name.split('.').pop() || 'png';
        const uploadRes = await apiRequest("/api/assets/upload", "POST", {
          parentId: "partners/",
          fileName: `partner_${Date.now()}.${ext}`,
          base64Data: base64Data,
          contentType: file.type || "image/png"
        });

        if (uploadRes.ok) {
          const json = await uploadRes.json();
          if (json.url) {
            urlInput.value = json.url;
            if (!nameInput.value) {
              nameInput.value = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
            }
            showToast("Logo uploaded. Click 'Add to List'.");
          }
        } else {
          urlInput.value = `data:${file.type || 'image/png'};base64,${base64Data}`;
          if (!nameInput.value) {
            nameInput.value = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
          }
        }
      } catch (err) {
        console.error("Failed to upload partner logo:", err);
        showToast("Upload failed", "error");
      } finally {
        if (uploadText) uploadText.innerText = "Upload PNG";
        if (uploadBtn) uploadBtn.style.pointerEvents = "auto";
        fileInput.value = "";
      }
    });
  }

  // Handle Add Item
  document.getElementById("btn-add-partner-item").addEventListener("click", () => {
    const url = urlInput.value.trim();
    const name = nameInput.value.trim();
    if (!url) {
      showToast("Please provide a logo image URL or upload a PNG.", "warning");
      return;
    }
    logos.push({ url, name: name || "Partner Logo" });
    urlInput.value = "";
    nameInput.value = "";
    renderLogosList();
  });

  // Handle Save
  document.getElementById("btn-save-partner-modal").addEventListener("click", () => {
    if (selectedComponent) {
      selectedComponent.addAttributes({ "data-partner-logos": JSON.stringify(logos) });
      
      // Update canvas component content to show the randomized true-center cloud
      const innerHtml = `
        <div class="ib-partner-logos-container" data-partner-logos='${JSON.stringify(logos)}' style="padding: 40px 20px; display: flex; justify-content: center; align-items: center; min-height: 120px; width: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div class="ib-partner-logos-cloud" style="display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 28px 36px; max-width: 1000px; width: 100%; margin: 0 auto;">
            ${logos.length > 0 
              ? logos.map(l => `
                  <div class="ib-partner-logo-item" style="display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px;">
                    <img src="${l.url}" alt="${l.name || ''}" style="max-height: 48px; max-width: 135px; width: auto; height: auto; object-fit: contain; filter: grayscale(15%);" />
                  </div>
                `).join("")
              : `<div style="padding: 20px 32px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc;">Partner Logos Cloud (Empty - Double-click to configure)</div>`
            }
          </div>
        </div>
      `;
      
      selectedComponent.components(innerHtml);
      builderHasUnsavedChanges = true;
    }
    showToast("Partner logos updated!");
    closeModal();
  });
}

// --- Product Grid Showcase Config Modal inside Editor ---
async function openProductGridModal(selectedComponent, siteId) {
  let initialSkus = [];
  let metaConfig = {
    showImage: true,
    showSku: true,
    showTitle: true,
    showSpecs: true,
    showButton: true,
    columns: 3,
    buttonText: "Find In Stores",
    buttonLink: "#stores"
  };

  if (selectedComponent) {
    const attrs = selectedComponent.getAttributes();
    try {
      const rawSkus = attrs["data-product-skus"];
      if (rawSkus) initialSkus = typeof rawSkus === "string" ? JSON.parse(rawSkus) : rawSkus;
    } catch {}
    try {
      const rawMeta = attrs["data-meta-config"];
      if (rawMeta) {
        const parsed = typeof rawMeta === "string" ? JSON.parse(rawMeta) : rawMeta;
        metaConfig = { ...metaConfig, ...parsed };
      }
    } catch {}
  }

  const overlay = document.createElement("div");
  overlay.id = "product-grid-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="product-grid-modal-card" style="
      width: 580px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-boxes-stacked" style="margin-right: 8px; color: #0B57D0;"></i>Configure Product Showcase</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Select catalog products and choose what metadata to display.</p>
        </div>
        <button id="btn-close-product-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Loading State -->
      <div id="product-modal-loading" style="text-align: center; padding: 40px 20px; color: #64748b;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 26px; color: #0B57D0; margin-bottom: 10px;"></i>
        <div style="font-size: 13px;">Loading product catalog...</div>
      </div>

      <!-- Content -->
      <div id="product-modal-content" style="display: none; flex: 1; overflow-y: auto; padding: 20px 24px; flex-direction: column; gap: 18px; box-sizing: border-box;">
        
        <!-- Filter Bar -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Filter Brand</label>
            <select id="grid-filter-brand" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff;"></select>
          </div>
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Search Product</label>
            <input type="text" id="grid-search-product" placeholder="Search SKU or name..." style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
          </div>
        </div>

        <!-- Products List with Checkboxes -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 700; color: #1e293b;">Choose Products to Showcase</label>
            <div style="display: flex; gap: 10px; font-size: 11px; font-weight: 700;">
              <button type="button" id="grid-btn-select-all" style="background: none; border: none; color: #0B57D0; cursor: pointer; padding: 0;">Select All</button>
              <span style="color: #cbd5e1;">|</span>
              <button type="button" id="grid-btn-select-none" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 0;">Clear All</button>
            </div>
          </div>
          <div id="grid-products-list" style="border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; max-height: 200px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
            <!-- Injected here -->
          </div>
        </div>

        <!-- Metadata Display Options Section -->
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
          <span style="font-size: 12px; font-weight: 700; color: #1e293b; text-transform: uppercase;">Card Metadata & Elements</span>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 12.5px; color: #334155;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="meta-show-image" ${metaConfig.showImage ? 'checked' : ''} />
              <span>Product Image</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="meta-show-sku" ${metaConfig.showSku ? 'checked' : ''} />
              <span>SKU Badge</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="meta-show-title" ${metaConfig.showTitle ? 'checked' : ''} />
              <span>Product Title</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="meta-show-specs" ${metaConfig.showSpecs ? 'checked' : ''} />
              <span>Weight / Specs</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="meta-show-button" ${metaConfig.showButton ? 'checked' : ''} />
              <span>CTA Button</span>
            </label>
          </div>

          <!-- Button Configuration & Columns -->
          <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
            <div style="flex: 1; min-width: 140px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Button Label</label>
              <input type="text" id="meta-btn-text" value="${metaConfig.buttonText || 'Find In Stores'}" style="width: 100%; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box;" />
            </div>
            <div style="flex: 1; min-width: 140px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Button Link (URL / #stores)</label>
              <input type="text" id="meta-btn-link" value="${metaConfig.buttonLink || '#stores'}" style="width: 100%; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box;" />
            </div>
            <div style="width: 110px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Columns</label>
              <select id="meta-columns" style="width: 100%; height: 34px; padding: 0 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box;">
                <option value="2" ${Number(metaConfig.columns) === 2 ? 'selected' : ''}>2 Cols</option>
                <option value="3" ${Number(metaConfig.columns) === 3 || !metaConfig.columns ? 'selected' : ''}>3 Cols</option>
                <option value="4" ${Number(metaConfig.columns) === 4 ? 'selected' : ''}>4 Cols</option>
              </select>
            </div>
          </div>

        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-product-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-product-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Products</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("product-grid-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("product-grid-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-product-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-product-modal").addEventListener("click", closeModal);

  // Fetch Site Catalog and master products lookup in parallel
  let siteCatalog = [];
  let masterLookup = { brands: [], products: [] };
  try {
    const [catRes, lookupRes] = await Promise.all([
      apiRequest(`/api/tenant/sites/${encodeURIComponent(siteId)}/catalog`),
      apiRequest(`/api/tenant/products-lookup?site_id=${encodeURIComponent(siteId)}`)
    ]);
    if (catRes.ok) {
      const catData = await catRes.json();
      siteCatalog = Array.isArray(catData) ? catData : (catData.catalog || catData.products || []);
    }
    if (lookupRes.ok) masterLookup = await lookupRes.json();
  } catch (err) {
    console.error("Failed to load catalog products:", err);
  }

  const masterMap = {};
  (masterLookup.products || []).forEach(p => {
    if (p.sku) masterMap[p.sku] = p;
    if (p.SKU) masterMap[p.SKU] = p;
  });

  const masterBrands = masterLookup.brands || [];
  const brandMap = {};
  masterBrands.forEach(b => {
    brandMap[b.id] = b.display_name || b.Name || b.id;
  });

  // ONLY products configured in this Site's Catalog appear here
  const allProducts = (siteCatalog || []).map(catItem => {
    const sku = catItem.sku;
    const master = masterMap[sku] || {};
    const photos = Array.isArray(catItem.photos) ? catItem.photos : [];
    const masterImg = master.image || (Array.isArray(master.photos) && master.photos[0]) || "";
    const imgUrl = (photos.length > 0 && photos[0]) ? photos[0] : masterImg;
    const brandId = catItem.brand_id || master.brands_id || master.brand_id || "";
    const brandName = catItem.brand_name || brandMap[brandId] || brandId || "";

    return {
      sku: sku,
      display_name: catItem.display_name || master.display_name || master.Name || sku,
      description: catItem.description || master.description || master.net_weight || "",
      photos: photos.length > 0 ? photos : (masterImg ? [masterImg] : []),
      image: imgUrl,
      brand_id: brandId,
      brand_name: brandName,
      net_weight: master.net_weight || master.weight || ""
    };
  });

  // Collect unique brands from the site catalog
  const catalogBrands = [];
  const seenBrandIds = new Set();
  allProducts.forEach(p => {
    if (p.brand_id && !seenBrandIds.has(p.brand_id)) {
      seenBrandIds.add(p.brand_id);
      catalogBrands.push({ id: p.brand_id, name: p.brand_name || p.brand_id });
    }
  });

  // Populate Brand Dropdown
  const brandSelect = document.getElementById("grid-filter-brand");
  brandSelect.innerHTML = `
    <option value="ALL">All Brands in Site Catalog (${allProducts.length} items)</option>
    ${catalogBrands.map(b => `<option value="${b.id}">${b.name}</option>`).join("")}
  `;

  // Render product list with photo selector and slideshow toggle
  let selectedPhotoMap = {};
  let slidePhotosMap = {};

  const renderProductsList = () => {
    const listDiv = document.getElementById("grid-products-list");
    const selectedBrand = brandSelect.value;
    const searchFilter = (document.getElementById("grid-search-product")?.value || "").toLowerCase().trim();

    let filtered = allProducts;
    if (selectedBrand !== "ALL") {
      filtered = filtered.filter(p => String(p.brand_id || "") === selectedBrand);
    }
    if (searchFilter) {
      filtered = filtered.filter(p => 
        (p.sku || "").toLowerCase().includes(searchFilter) ||
        (p.display_name || "").toLowerCase().includes(searchFilter)
      );
    }

    if (filtered.length === 0) {
      listDiv.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 12.5px;">No products found in this Site Catalog.</div>`;
      return;
    }

    listDiv.innerHTML = filtered.map(p => {
      const sku = p.sku;
      const name = p.display_name;
      const isChecked = initialSkus.includes(sku);
      const photos = Array.isArray(p.photos) ? p.photos : (p.image ? [p.image] : []);
      const currentPhotoIdx = selectedPhotoMap[sku] !== undefined ? selectedPhotoMap[sku] : 0;
      const currentImg = photos[currentPhotoIdx] || p.image || "";
      const weight = p.net_weight || p.description || "";
      const isSliding = !!slidePhotosMap[sku];

      return `
        <div style="display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <input type="checkbox" class="product-grid-sku-checkbox" value="${sku}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
            <div style="width: 44px; height: 44px; border-radius: 6px; background: #f8fafc; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
              ${currentImg ? `<img src="${currentImg}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<i class="fa-solid fa-box-open" style="color: #cbd5e1; font-size: 18px;"></i>`}
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 13px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
              <div style="display: flex; gap: 8px; font-size: 11px; color: #64748b;">
                <span style="font-weight: 700; color: #0B57D0;">${sku}</span>
                ${weight ? `<span>· ${weight}</span>` : ''}
              </div>
            </div>
          </div>

          ${photos.length > 1 ? `
            <div style="display: flex; align-items: center; justify-content: space-between; padding-left: 26px; border-top: 1px dashed #f1f5f9; padding-top: 6px; flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 10.5px; color: #64748b; font-weight: 600;">Photos:</span>
                ${photos.map((ph, idx) => `
                  <button type="button" class="btn-pick-photo" data-sku="${sku}" data-idx="${idx}" style="width: 26px; height: 26px; border-radius: 4px; border: 1.5px solid ${currentPhotoIdx === idx ? '#0B57D0' : '#E2E8F0'}; padding: 0; overflow: hidden; cursor: pointer; background: #fff;">
                    <img src="${ph}" style="width: 100%; height: 100%; object-fit: cover;" />
                  </button>
                `).join("")}
              </div>
              <label style="font-size: 11px; color: #0B57D0; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" class="cb-slide-product-photos" data-sku="${sku}" ${isSliding ? 'checked' : ''} />
                <span><i class="fa-solid fa-images" style="margin-right: 2px;"></i> Slide (${photos.length} photos)</span>
              </label>
            </div>
          ` : ''}
        </div>
      `;
    }).join("");

    listDiv.querySelectorAll(".btn-pick-photo").forEach(btn => {
      btn.addEventListener("click", () => {
        const sku = btn.getAttribute("data-sku");
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        selectedPhotoMap[sku] = idx;
        renderProductsList();
      });
    });

    listDiv.querySelectorAll(".cb-slide-product-photos").forEach(cb => {
      cb.addEventListener("change", () => {
        const sku = cb.getAttribute("data-sku");
        slidePhotosMap[sku] = cb.checked;
      });
    });
  };

  brandSelect.addEventListener("change", renderProductsList);
  document.getElementById("grid-search-product").addEventListener("input", renderProductsList);

  document.getElementById("grid-btn-select-all").addEventListener("click", () => {
    document.querySelectorAll(".product-grid-sku-checkbox").forEach(cb => cb.checked = true);
  });
  document.getElementById("grid-btn-select-none").addEventListener("click", () => {
    document.querySelectorAll(".product-grid-sku-checkbox").forEach(cb => cb.checked = false);
  });

  // Hide loader, show content
  document.getElementById("product-modal-loading").style.display = "none";
  document.getElementById("product-modal-content").style.display = "flex";
  renderProductsList();

  // Save changes
  document.getElementById("btn-save-product-modal").addEventListener("click", () => {
    const checkedCheckboxes = document.querySelectorAll(".product-grid-sku-checkbox:checked");
    const chosenSkus = Array.from(checkedCheckboxes).map(cb => cb.value);

    const showImage = document.getElementById("meta-show-image").checked;
    const showSku = document.getElementById("meta-show-sku").checked;
    const showTitle = document.getElementById("meta-show-title").checked;
    const showSpecs = document.getElementById("meta-show-specs").checked;
    const showButton = document.getElementById("meta-show-button").checked;
    const buttonText = document.getElementById("meta-btn-text").value.trim() || "Find In Stores";
    const buttonLink = document.getElementById("meta-btn-link").value.trim() || "#stores";
    const columns = parseInt(document.getElementById("meta-columns").value, 10) || 3;

    const newMetaConfig = {
      showImage,
      showSku,
      showTitle,
      showSpecs,
      showButton,
      buttonText,
      buttonLink,
      columns,
      selectedPhotoMap,
      slidePhotosMap
    };

    // Find the target component reliably
    let targetComp = selectedComponent || (grapesEditor && grapesEditor.getSelected());
    if (targetComp) {
      let curr = targetComp;
      while (curr) {
        if (curr.get && (curr.get('type') === 'product-grid' || (curr.getAttributes && curr.getAttributes()['data-product-skus'] !== undefined))) {
          targetComp = curr;
          break;
        }
        curr = curr.parent && curr.parent();
      }
    }

    const defaultProductGridCss = `
      .ib-product-grid-container {
        padding: 40px 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-sizing: border-box;
      }
      .ib-product-grid {
        display: grid;
        gap: 24px;
        max-width: 1100px;
        margin: 0 auto;
      }
      .ib-product-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.04);
        box-sizing: border-box;
        position: relative;
      }
      .ib-product-image-wrap {
        width: 100%;
        aspect-ratio: 1/1;
        background: #f8fafc;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border: 1px solid #f1f5f9;
        position: relative;
      }
      .ib-product-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: opacity 0.3s ease;
      }
      .ib-product-info {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .ib-product-sku {
        align-self: flex-start;
        font-size: 11px;
        font-weight: 700;
        color: #0B57D0;
        background: #EFF6FF;
        padding: 2px 8px;
        border-radius: 4px;
      }
      .ib-product-title {
        font-size: 15px;
        font-weight: 700;
        color: #1e293b;
        margin: 4px 0 2px 0;
        line-height: 1.3;
      }
      .ib-product-specs {
        font-size: 12px;
        color: #64748b;
        line-height: 1.4;
        margin: 0;
      }
      .ib-product-btn {
        margin-top: auto;
        display: block;
        text-align: center;
        padding: 9px 14px;
        background: #0B57D0;
        color: #ffffff;
        text-decoration: none;
        border-radius: 6px;
        font-size: 12.5px;
        font-weight: 600;
        transition: background 0.15s ease;
      }
    `;

    if (grapesEditor) {
      grapesEditor.addStyle(defaultProductGridCss);
    }

    const matchingProducts = allProducts.filter(p => chosenSkus.includes(p.sku));

    const innerHtml = `
      <div class="ib-product-grid-container" data-product-skus='${JSON.stringify(chosenSkus)}' data-meta-config='${JSON.stringify(newMetaConfig)}'>
        <div class="ib-product-grid" style="grid-template-columns: repeat(${columns}, minmax(0, 1fr));">
          ${matchingProducts.length > 0
            ? matchingProducts.map(p => {
                const sku = p.sku;
                const name = p.display_name;
                const photos = Array.isArray(p.photos) ? p.photos : (p.image ? [p.image] : []);
                const photoIdx = selectedPhotoMap[sku] !== undefined ? selectedPhotoMap[sku] : 0;
                const primaryImg = photos[photoIdx] || p.image || "";
                const isSliding = !!slidePhotosMap[sku] && photos.length > 1;
                const weight = p.net_weight || p.description || "";

                return `
                  <div class="ib-product-card">
                    ${showImage ? `
                      <div class="ib-product-image-wrap ${isSliding ? 'ib-product-slider' : ''}" data-photos='${JSON.stringify(photos)}'>
                        ${primaryImg ? `<img class="ib-product-image" src="${primaryImg}" alt="${name}" />` : `<i class="fa-solid fa-box-open" style="font-size: 36px; color: #cbd5e1;"></i>`}
                        ${isSliding ? `
                          <div class="ib-slider-dots" style="position: absolute; bottom: 6px; left: 0; width: 100%; display: flex; justify-content: center; gap: 4px; z-index: 2;">
                            ${photos.map((_, i) => `<span class="ib-dot ${i === 0 ? 'active' : ''}" style="width: 6px; height: 6px; border-radius: 50%; background: ${i === 0 ? '#0B57D0' : 'rgba(255,255,255,0.7)'}; box-shadow: 0 1px 2px rgba(0,0,0,0.3);"></span>`).join("")}
                          </div>
                        ` : ''}
                      </div>
                    ` : ''}
                    <div class="ib-product-info">
                      ${showSku ? `<span class="ib-product-sku">${sku}</span>` : ''}
                      ${showTitle ? `<h4 class="ib-product-title">${name}</h4>` : ''}
                      ${showSpecs && weight ? `<p class="ib-product-specs">${weight}</p>` : ''}
                    </div>
                    ${showButton ? `
                      <a class="ib-product-btn" href="${buttonLink}">${buttonText}</a>
                    ` : ''}
                  </div>
                `;
              }).join("")
            : `<div style="padding: 32px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc; grid-column: 1 / -1;">No products selected. Double-click to configure showcase.</div>`
          }
        </div>
      </div>
    `;

    if (targetComp) {
      const newEl = targetComp.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    } else if (selectedComponent) {
      const newEl = selectedComponent.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    }
    builderHasUnsavedChanges = true;

    showToast("Product showcase updated!");
    closeModal();
  });
}

// --- Product Carousel Config Modal inside Editor ---
async function openProductCarouselModal(selectedComponent, siteId) {
  let initialSkus = [];
  let metaConfig = {
    showImage: true,
    showSku: true,
    showTitle: true,
    showSpecs: true,
    showButton: true,
    buttonText: "Find In Stores",
    buttonLink: "#stores"
  };

  if (selectedComponent) {
    const attrs = selectedComponent.getAttributes();
    try {
      const rawSkus = attrs["data-product-skus"];
      if (rawSkus) initialSkus = typeof rawSkus === "string" ? JSON.parse(rawSkus) : rawSkus;
    } catch {}
    try {
      const rawMeta = attrs["data-meta-config"];
      if (rawMeta) {
        const parsed = typeof rawMeta === "string" ? JSON.parse(rawMeta) : rawMeta;
        metaConfig = { ...metaConfig, ...parsed };
      }
    } catch {}
  }

  const overlay = document.createElement("div");
  overlay.id = "product-carousel-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="product-carousel-modal-card" style="
      width: 580px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-sliders" style="margin-right: 8px; color: #0B57D0;"></i>Configure Product Carousel</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Select sliding products from your Site Catalog with navigation controls.</p>
        </div>
        <button id="btn-close-carousel-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Loading State -->
      <div id="carousel-modal-loading" style="text-align: center; padding: 40px 20px; color: #64748b;">
        <i class="fa-solid fa-spinner fa-spin" style="font-size: 26px; color: #0B57D0; margin-bottom: 10px;"></i>
        <div style="font-size: 13px;">Loading catalog products...</div>
      </div>

      <!-- Content -->
      <div id="carousel-modal-content" style="display: none; flex: 1; overflow-y: auto; padding: 20px 24px; flex-direction: column; gap: 18px; box-sizing: border-box;">
        
        <!-- Filter Bar -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Filter Brand</label>
            <select id="carousel-filter-brand" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff;"></select>
          </div>
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; margin-bottom: 4px;">Search Product</label>
            <input type="text" id="carousel-search-product" placeholder="Search SKU or name..." style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
          </div>
        </div>

        <!-- Products List -->
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label style="font-size: 12px; font-weight: 700; color: #1e293b;">Choose Products for Carousel</label>
            <div style="display: flex; gap: 10px; font-size: 11px; font-weight: 700;">
              <button type="button" id="carousel-btn-select-all" style="background: none; border: none; color: #0B57D0; cursor: pointer; padding: 0;">Select All</button>
              <span style="color: #cbd5e1;">|</span>
              <button type="button" id="carousel-btn-select-none" style="background: none; border: none; color: #64748b; cursor: pointer; padding: 0;">Clear All</button>
            </div>
          </div>
          <div id="carousel-products-list" style="border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; max-height: 200px; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px;">
            <!-- Injected here -->
          </div>
        </div>

        <!-- Metadata Display Options Section -->
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
          <span style="font-size: 12px; font-weight: 700; color: #1e293b; text-transform: uppercase;">Card Metadata & Elements</span>
          
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 12.5px; color: #334155;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="c-meta-show-image" ${metaConfig.showImage ? 'checked' : ''} />
              <span>Product Image</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="c-meta-show-sku" ${metaConfig.showSku ? 'checked' : ''} />
              <span>SKU Badge</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="c-meta-show-title" ${metaConfig.showTitle ? 'checked' : ''} />
              <span>Product Title</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="c-meta-show-specs" ${metaConfig.showSpecs ? 'checked' : ''} />
              <span>Weight / Specs</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input type="checkbox" id="c-meta-show-button" ${metaConfig.showButton ? 'checked' : ''} />
              <span>CTA Button</span>
            </label>
          </div>

          <!-- Button Configuration -->
          <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 4px; border-top: 1px dashed #e2e8f0; padding-top: 10px;">
            <div style="flex: 1; min-width: 140px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Button Label</label>
              <input type="text" id="c-meta-btn-text" value="${metaConfig.buttonText || 'Find In Stores'}" style="width: 100%; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box;" />
            </div>
            <div style="flex: 1; min-width: 140px;">
              <label style="display: block; font-size: 11px; font-weight: 600; color: #64748b; margin-bottom: 4px;">Button Link (URL / #stores)</label>
              <input type="text" id="c-meta-btn-link" value="${metaConfig.buttonLink || '#stores'}" style="width: 100%; height: 34px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 12px; outline: none; background: #fff; box-sizing: border-box;" />
            </div>
          </div>

        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-carousel-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-carousel-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Carousel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("product-carousel-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("product-carousel-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-carousel-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-carousel-modal").addEventListener("click", closeModal);

  // Fetch Site Catalog and master products lookup in parallel
  let siteCatalog = [];
  let masterLookup = { brands: [], products: [] };
  try {
    const [catRes, lookupRes] = await Promise.all([
      apiRequest(`/api/tenant/sites/${encodeURIComponent(siteId)}/catalog`),
      apiRequest(`/api/tenant/products-lookup?site_id=${encodeURIComponent(siteId)}`)
    ]);
    if (catRes.ok) {
      const catData = await catRes.json();
      siteCatalog = Array.isArray(catData) ? catData : (catData.catalog || catData.products || []);
    }
    if (lookupRes.ok) masterLookup = await lookupRes.json();
  } catch (err) {
    console.error("Failed to load carousel products:", err);
  }

  const masterMap = {};
  (masterLookup.products || []).forEach(p => {
    if (p.sku) masterMap[p.sku] = p;
    if (p.SKU) masterMap[p.SKU] = p;
  });

  const masterBrands = masterLookup.brands || [];
  const brandMap = {};
  masterBrands.forEach(b => {
    brandMap[b.id] = b.display_name || b.Name || b.id;
  });

  const allProducts = (siteCatalog || []).map(catItem => {
    const sku = catItem.sku;
    const master = masterMap[sku] || {};
    const photos = Array.isArray(catItem.photos) ? catItem.photos : [];
    const masterImg = master.image || (Array.isArray(master.photos) && master.photos[0]) || "";
    const imgUrl = (photos.length > 0 && photos[0]) ? photos[0] : masterImg;
    const brandId = catItem.brand_id || master.brands_id || master.brand_id || "";
    const brandName = catItem.brand_name || brandMap[brandId] || brandId || "";

    return {
      sku: sku,
      display_name: catItem.display_name || master.display_name || master.Name || sku,
      description: catItem.description || master.description || master.net_weight || "",
      photos: photos.length > 0 ? photos : (masterImg ? [masterImg] : []),
      image: imgUrl,
      brand_id: brandId,
      brand_name: brandName,
      net_weight: master.net_weight || master.weight || ""
    };
  });

  const catalogBrands = [];
  const seenBrandIds = new Set();
  allProducts.forEach(p => {
    if (p.brand_id && !seenBrandIds.has(p.brand_id)) {
      seenBrandIds.add(p.brand_id);
      catalogBrands.push({ id: p.brand_id, name: p.brand_name || p.brand_id });
    }
  });

  const brandSelect = document.getElementById("carousel-filter-brand");
  brandSelect.innerHTML = `
    <option value="ALL">All Brands in Site Catalog (${allProducts.length} items)</option>
    ${catalogBrands.map(b => `<option value="${b.id}">${b.name}</option>`).join("")}
  `;

  const renderProductsList = () => {
    const listDiv = document.getElementById("carousel-products-list");
    const selectedBrand = brandSelect.value;
    const searchFilter = (document.getElementById("carousel-search-product")?.value || "").toLowerCase().trim();

    let filtered = allProducts;
    if (selectedBrand !== "ALL") {
      filtered = filtered.filter(p => String(p.brand_id || "") === selectedBrand);
    }
    if (searchFilter) {
      filtered = filtered.filter(p => 
        (p.sku || "").toLowerCase().includes(searchFilter) ||
        (p.display_name || "").toLowerCase().includes(searchFilter)
      );
    }

    if (filtered.length === 0) {
      listDiv.innerHTML = `<div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 12.5px;">No products found in Site Catalog.</div>`;
      return;
    }

    listDiv.innerHTML = filtered.map(p => {
      const sku = p.sku;
      const name = p.display_name;
      const isChecked = initialSkus.includes(sku);
      const imgUrl = p.image || "";
      const weight = p.net_weight || p.description || "";

      return `
        <label style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; cursor: pointer;">
          <input type="checkbox" class="product-carousel-sku-checkbox" value="${sku}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
          <div style="width: 38px; height: 38px; border-radius: 6px; background: #f8fafc; border: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            ${imgUrl ? `<img src="${imgUrl}" alt="${name}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<i class="fa-solid fa-box-open" style="color: #cbd5e1; font-size: 16px;"></i>`}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; font-weight: 600; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
            <div style="display: flex; gap: 8px; font-size: 11px; color: #64748b;">
              <span style="font-weight: 700; color: #0B57D0;">${sku}</span>
              ${weight ? `<span>· ${weight}</span>` : ''}
            </div>
          </div>
        </label>
      `;
    }).join("");
  };

  brandSelect.addEventListener("change", renderProductsList);
  document.getElementById("carousel-search-product").addEventListener("input", renderProductsList);

  document.getElementById("carousel-btn-select-all").addEventListener("click", () => {
    document.querySelectorAll(".product-carousel-sku-checkbox").forEach(cb => cb.checked = true);
  });
  document.getElementById("carousel-btn-select-none").addEventListener("click", () => {
    document.querySelectorAll(".product-carousel-sku-checkbox").forEach(cb => cb.checked = false);
  });

  document.getElementById("carousel-modal-loading").style.display = "none";
  document.getElementById("carousel-modal-content").style.display = "flex";
  renderProductsList();

  document.getElementById("btn-save-carousel-modal").addEventListener("click", () => {
    const checkedCheckboxes = document.querySelectorAll(".product-carousel-sku-checkbox:checked");
    const chosenSkus = Array.from(checkedCheckboxes).map(cb => cb.value);

    const showImage = document.getElementById("c-meta-show-image").checked;
    const showSku = document.getElementById("c-meta-show-sku").checked;
    const showTitle = document.getElementById("c-meta-show-title").checked;
    const showSpecs = document.getElementById("c-meta-show-specs").checked;
    const showButton = document.getElementById("c-meta-show-button").checked;
    const buttonText = document.getElementById("c-meta-btn-text").value.trim() || "Find In Stores";
    const buttonLink = document.getElementById("c-meta-btn-link").value.trim() || "#stores";

    const newMetaConfig = {
      showImage,
      showSku,
      showTitle,
      showSpecs,
      showButton,
      buttonText,
      buttonLink
    };

    let targetComp = selectedComponent || (grapesEditor && grapesEditor.getSelected());
    if (targetComp) {
      let curr = targetComp;
      while (curr) {
        if (curr.get && (curr.get('type') === 'product-carousel' || (curr.getAttributes && curr.getAttributes()['data-product-skus'] !== undefined))) {
          targetComp = curr;
          break;
        }
        curr = curr.parent && curr.parent();
      }
    }

    const matchingProducts = allProducts.filter(p => chosenSkus.includes(p.sku));

    const innerHtml = `
      <div class="ib-product-carousel-container" data-product-skus='${JSON.stringify(chosenSkus)}' data-meta-config='${JSON.stringify(newMetaConfig)}' style="padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box; position: relative; max-width: 1200px; margin: 0 auto;">
        <div class="ib-carousel-wrapper" style="position: relative; overflow: hidden; padding: 10px 0;">
          <div class="ib-carousel-track" style="display: flex; gap: 20px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; padding: 10px 4px;">
            ${matchingProducts.length > 0
              ? matchingProducts.map(p => `
                  <div class="ib-product-card" style="flex: 0 0 240px; min-width: 240px;">
                    ${showImage ? `
                      <div class="ib-product-image-wrap">
                        ${p.image ? `<img class="ib-product-image" src="${p.image}" alt="${p.display_name}" />` : `<i class="fa-solid fa-box-open" style="font-size: 36px; color: #cbd5e1;"></i>`}
                      </div>
                    ` : ''}
                    <div class="ib-product-info">
                      ${showSku ? `<span class="ib-product-sku">${p.sku}</span>` : ''}
                      ${showTitle ? `<h4 class="ib-product-title">${p.display_name}</h4>` : ''}
                      ${showSpecs && (p.net_weight || p.description) ? `<p class="ib-product-specs">${p.net_weight || p.description}</p>` : ''}
                    </div>
                    ${showButton ? `
                      <a class="ib-product-btn" href="${buttonLink}">${buttonText}</a>
                    ` : ''}
                  </div>
                `).join("")
              : `<div style="padding: 32px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 13px; font-weight: 600; text-align: center; background: #f8fafc; width: 100%;">No products selected for carousel. Double-click to configure.</div>`
            }
          </div>
          <button class="ib-carousel-btn ib-carousel-prev" type="button" style="position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; background: #FFFFFF; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #0B57D0; z-index: 10;">
            <i class="fa-solid fa-chevron-left"></i>
          </button>
          <button class="ib-carousel-btn ib-carousel-next" type="button" style="position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; background: #FFFFFF; border: 1px solid #e2e8f0; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; cursor: pointer; color: #0B57D0; z-index: 10;">
            <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      </div>
    `;

    if (targetComp) {
      const newEl = targetComp.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    } else if (selectedComponent) {
      const newEl = selectedComponent.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    }
    builderHasUnsavedChanges = true;

    showToast("Product carousel updated!");
    closeModal();
  });
}

// --- Hero Banner & Multi-Photo Slider Config Modal inside Editor ---
async function openHeroBannerModal(selectedComponent, siteId) {
  let bannerConfig = {
    title: "Authentic Culinary Flavors",
    subtitle: "Discover our signature pastes and seasonings crafted for authentic home cooking and professional kitchens.",
    buttonText: "Explore Products",
    buttonLink: "#products",
    images: [],
    imageUrl: "",
    overlay: 0.4,
    height: "480px",
    autoplay: true,
    interval: 5000,
    showDots: true,
    showArrows: true
  };

  let targetComp = selectedComponent || (grapesEditor && grapesEditor.getSelected());
  if (targetComp) {
    let curr = targetComp;
    while (curr) {
      if (curr.get && (curr.get('type') === 'hero-banner' || (curr.getAttributes && curr.getAttributes()['data-banner-config'] !== undefined))) {
        targetComp = curr;
        break;
      }
      curr = curr.parent && curr.parent();
    }
  }

  if (targetComp) {
    const attrs = targetComp.getAttributes ? targetComp.getAttributes() : {};
    try {
      const raw = attrs["data-banner-config"];
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        bannerConfig = { ...bannerConfig, ...parsed };
      }
    } catch {}
  }

  if ((!bannerConfig.images || bannerConfig.images.length === 0) && bannerConfig.imageUrl) {
    bannerConfig.images = [bannerConfig.imageUrl];
  }
  if (!Array.isArray(bannerConfig.images)) {
    bannerConfig.images = [];
  }

  let currentImages = [...bannerConfig.images];

  const overlay = document.createElement("div");
  overlay.id = "hero-banner-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="hero-banner-modal-card" style="
      width: 580px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-panorama" style="margin-right: 8px; color: #0B57D0;"></i>Configure Hero Banner & Slider</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Set headline, subtitle, action button, and multi-photo background slides.</p>
        </div>
        <button id="btn-close-banner-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Headline -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Banner Headline</label>
          <input type="text" id="banner-title" value="${bannerConfig.title || ''}" placeholder="Main Title (e.g. Authentic Culinary Flavors)" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

        <!-- Subtitle -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Subtitle / Description</label>
          <textarea id="banner-subtitle" rows="2" placeholder="Supporting message or brand promise..." style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff; box-sizing: border-box; resize: vertical;">${bannerConfig.subtitle || ''}</textarea>
        </div>

        <!-- Button Label & Link -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Button Text</label>
            <input type="text" id="banner-btn-text" value="${bannerConfig.buttonText || 'Explore Products'}" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
          </div>
          <div style="flex: 1; min-width: 180px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Button Link</label>
            <input type="text" id="banner-btn-link" value="${bannerConfig.buttonLink || '#products'}" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
          </div>
        </div>

        <!-- Multi-Photo Slider Management Section -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 12px; font-weight: 700; color: #1E293B; text-transform: uppercase;">
              <i class="fa-solid fa-images" style="color: #0B57D0; margin-right: 6px;"></i>Background Slides (<span id="slide-count-text">${currentImages.length}</span>)
            </span>
            <span style="font-size: 11px; color: #64748B;">Upload 1 or multiple images for automated slider</span>
          </div>

          <!-- Add Photo Controls -->
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="file" id="banner-file-input" accept="image/*" multiple style="display: none;" />
            <button type="button" class="btn btn-primary" id="btn-upload-banner-files" style="height: 36px; padding: 0 14px; font-size: 12px; font-weight: 600; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer;">
              <i class="fa-solid fa-cloud-arrow-up"></i> <span id="banner-upload-text">Upload Photo(s)</span>
            </button>
            
            <input type="text" id="banner-custom-url" placeholder="Or paste image URL..." style="flex: 1; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12px; outline: none; background: #fff; min-width: 0;" />
            <button type="button" class="btn btn-secondary" id="btn-add-custom-url" style="height: 36px; padding: 0 12px; font-size: 12px; font-weight: 600; border-radius: 8px; white-space: nowrap; cursor: pointer;">
              <i class="fa-solid fa-plus"></i> Add Link
            </button>
          </div>

          <!-- Slides List Container -->
          <div id="banner-slides-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 180px; overflow-y: auto; padding: 2px; box-sizing: border-box;">
            <!-- Rendered dynamically -->
          </div>

          <!-- Slider Transition Settings (Shown when >= 2 slides) -->
          <div id="banner-slider-options" style="border-top: 1px solid #E2E8F0; padding-top: 10px; display: ${currentImages.length > 1 ? 'grid' : 'none'}; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; font-size: 12px; color: #334155;">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="banner-autoplay" ${bannerConfig.autoplay !== false ? 'checked' : ''} />
              <span>Auto-slide (5s)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="banner-show-dots" ${bannerConfig.showDots !== false ? 'checked' : ''} />
              <span>Show Slide Dots</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="banner-show-arrows" ${bannerConfig.showArrows !== false ? 'checked' : ''} />
              <span>Show Nav Arrows</span>
            </label>
          </div>
        </div>

        <!-- Height & Overlay -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 160px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Banner Height</label>
            <select id="banner-height" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              <option value="380px" ${bannerConfig.height === "380px" ? 'selected' : ''}>Compact (380px)</option>
              <option value="480px" ${bannerConfig.height === "480px" || !bannerConfig.height ? 'selected' : ''}>Standard (480px)</option>
              <option value="580px" ${bannerConfig.height === "580px" ? 'selected' : ''}>Large (580px)</option>
              <option value="100vh" ${bannerConfig.height === "100vh" ? 'selected' : ''}>Full Screen (100vh)</option>
            </select>
          </div>
          <div style="flex: 1; min-width: 160px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Dark Overlay: <span id="overlay-val" style="color: #0B57D0; font-weight: 700;">${Math.round((bannerConfig.overlay !== undefined ? bannerConfig.overlay : 0.4) * 100)}%</span></label>
            <input type="range" id="banner-overlay" min="0" max="0.8" step="0.05" value="${bannerConfig.overlay !== undefined ? bannerConfig.overlay : 0.4}" style="width: 100%; margin-top: 8px; cursor: pointer;" />
          </div>
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-banner-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-banner-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Banner</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("hero-banner-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("hero-banner-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-banner-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-banner-modal").addEventListener("click", closeModal);

  // Render Slides List UI
  const slidesListContainer = document.getElementById("banner-slides-list");
  const slideCountText = document.getElementById("slide-count-text");
  const sliderOptionsBox = document.getElementById("banner-slider-options");

  const renderSlidesList = () => {
    slideCountText.innerText = currentImages.length;
    sliderOptionsBox.style.display = currentImages.length > 1 ? 'grid' : 'none';

    if (currentImages.length === 0) {
      slidesListContainer.innerHTML = `
        <div style="padding: 18px; text-align: center; color: #94a3b8; font-size: 12px; border: 1.5px dashed #cbd5e1; border-radius: 8px; background: #fff;">
          <i class="fa-solid fa-image" style="margin-right: 6px;"></i> No images added. Default dark gradient will be used.
        </div>
      `;
      return;
    }

    slidesListContainer.innerHTML = currentImages.map((img, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; gap: 10px;">
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
          <img src="${img}" style="width: 44px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid #cbd5e1; flex-shrink: 0;" />
          <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
            <span style="font-size: 11.5px; font-weight: 700; color: #1e293b; display: block;">Slide #${idx + 1}</span>
            <span style="font-size: 10.5px; color: #64748b; font-family: monospace; display: block; overflow: hidden; text-overflow: ellipsis;">${img}</span>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
          <button type="button" class="btn-slide-up" data-idx="${idx}" style="background: none; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px; cursor: pointer; color: #475569; font-size: 11px;" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''} title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
          <button type="button" class="btn-slide-down" data-idx="${idx}" style="background: none; border: 1px solid #e2e8f0; border-radius: 4px; padding: 4px 6px; cursor: pointer; color: #475569; font-size: 11px;" ${idx === currentImages.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''} title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
          <button type="button" class="btn-slide-del" data-idx="${idx}" style="background: none; border: 1px solid #fee2e2; border-radius: 4px; padding: 4px 6px; cursor: pointer; color: #dc2626; font-size: 11px;" title="Remove Slide"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `).join("");

    // Attach Slide Actions
    slidesListContainer.querySelectorAll(".btn-slide-up").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        if (i > 0) {
          const temp = currentImages[i];
          currentImages[i] = currentImages[i - 1];
          currentImages[i - 1] = temp;
          renderSlidesList();
        }
      });
    });

    slidesListContainer.querySelectorAll(".btn-slide-down").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        if (i < currentImages.length - 1) {
          const temp = currentImages[i];
          currentImages[i] = currentImages[i + 1];
          currentImages[i + 1] = temp;
          renderSlidesList();
        }
      });
    });

    slidesListContainer.querySelectorAll(".btn-slide-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.getAttribute("data-idx"), 10);
        currentImages.splice(i, 1);
        renderSlidesList();
      });
    });
  };

  renderSlidesList();

  // Overlay Slider update
  const overlaySlider = document.getElementById("banner-overlay");
  const overlayValSpan = document.getElementById("overlay-val");
  overlaySlider.addEventListener("input", (e) => {
    overlayValSpan.innerText = `${Math.round(parseFloat(e.target.value) * 100)}%`;
  });

  // Add custom URL
  const customUrlInput = document.getElementById("banner-custom-url");
  const btnAddCustomUrl = document.getElementById("btn-add-custom-url");
  btnAddCustomUrl.addEventListener("click", () => {
    const val = customUrlInput.value.trim();
    if (!val) return;
    currentImages.push(val);
    customUrlInput.value = "";
    renderSlidesList();
  });

  // Multiple File Upload handler
  const bannerFileInput = document.getElementById("banner-file-input");
  const bannerUploadBtn = document.getElementById("btn-upload-banner-files");
  const bannerUploadText = document.getElementById("banner-upload-text");

  bannerUploadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    bannerFileInput.click();
  });

  bannerFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    bannerUploadText.innerText = `Uploading (${files.length})...`;
    bannerUploadBtn.disabled = true;

    try {
      let token = "";
      if (auth && auth.currentUser) {
        token = await auth.currentUser.getIdToken();
      }

      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) {
          showToast(`File ${file.name} exceeds 8MB limit.`, "warning");
          continue;
        }

        try {
          const fileData = await file.arrayBuffer();
          const filename = `banners/${siteId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const res = await fetch(`${API_BASE}/api/upload?filename=${encodeURIComponent(filename)}`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${token}`,
              "Content-Type": file.type || "application/octet-stream"
            },
            body: fileData
          });

          if (res.ok) {
            const data = await res.json();
            if (data.url) {
              currentImages.push(data.url);
            }
          } else {
            const base64Data = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.readAsDataURL(file);
            });
            currentImages.push(base64Data);
          }
        } catch {
          // Fallback to base64
          const base64Data = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
          });
          currentImages.push(base64Data);
        }
      }

      renderSlidesList();
      showToast(`${files.length} image(s) added.`);
    } catch (err) {
      showToast("Upload failed.", "danger");
    } finally {
      bannerUploadText.innerText = "Upload Photo(s)";
      bannerUploadBtn.disabled = false;
      bannerFileInput.value = "";
    }
  });

  // Save Banner
  document.getElementById("btn-save-banner-modal").addEventListener("click", () => {
    const title = document.getElementById("banner-title").value.trim();
    const subtitle = document.getElementById("banner-subtitle").value.trim();
    const buttonText = document.getElementById("banner-btn-text").value.trim() || "Explore Products";
    const buttonLink = document.getElementById("banner-btn-link").value.trim() || "#products";
    const height = document.getElementById("banner-height").value;
    const overlayVal = parseFloat(overlaySlider.value);
    const autoplay = document.getElementById("banner-autoplay") ? document.getElementById("banner-autoplay").checked : true;
    const showDots = document.getElementById("banner-show-dots") ? document.getElementById("banner-show-dots").checked : true;
    const showArrows = document.getElementById("banner-show-arrows") ? document.getElementById("banner-show-arrows").checked : true;

    const newConfig = {
      title,
      subtitle,
      buttonText,
      buttonLink,
      images: currentImages,
      imageUrl: currentImages[0] || "",
      height,
      overlay: overlayVal,
      autoplay,
      interval: 5000,
      showDots,
      showArrows
    };

    let targetComp = selectedComponent || (grapesEditor && grapesEditor.getSelected());
    if (targetComp) {
      let curr = targetComp;
      while (curr) {
        if (curr.get && (curr.get('type') === 'hero-banner' || (curr.getAttributes && curr.getAttributes()['data-banner-config'] !== undefined))) {
          targetComp = curr;
          break;
        }
        curr = curr.parent && curr.parent();
      }
    }

    const isMultiple = currentImages.length > 1;
    const firstImg = currentImages[0] || "";

    const innerHtml = `
      <div class="ib-hero-banner-container ${isMultiple ? 'ib-hero-slider' : ''}" data-banner-config='${JSON.stringify(newConfig)}' style="position: relative; width: 100%; min-height: ${height}; ${!isMultiple ? (firstImg ? `background: linear-gradient(rgba(15, 23, 42, ${overlayVal}), rgba(15, 23, 42, ${overlayVal})), url('${firstImg}') center / cover no-repeat;` : `background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);`) : `background: #0f172a;`} display: flex; align-items: center; justify-content: center; text-align: center; padding: 60px 24px; box-sizing: border-box; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; overflow: hidden;">
        
        ${isMultiple ? `
          <!-- Multi-Image Slider Track -->
          <div class="ib-hero-slides-track" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;">
            ${currentImages.map((img, i) => `
              <div class="ib-hero-slide ${i === 0 ? 'active' : ''}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: url('${img}') center / cover no-repeat; opacity: ${i === 0 ? 1 : 0}; transition: opacity 0.8s ease-in-out; pointer-events: none;"></div>
            `).join("")}
          </div>
          <!-- Dark Overlay for Slider -->
          <div class="ib-hero-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, ${overlayVal}); z-index: 2; pointer-events: none;"></div>
        ` : ''}

        <!-- Hero Content -->
        <div class="ib-hero-banner-content" style="position: relative; z-index: 3; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <span style="font-size: 12px; font-weight: 700; color: #93C5FD; text-transform: uppercase; letter-spacing: 1.5px; background: rgba(255,255,255,0.1); padding: 4px 14px; border-radius: 20px;">Premium Selection</span>
          <h1 class="ib-hero-title" style="font-size: 38px; font-weight: 800; line-height: 1.2; margin: 0; color: #ffffff;">${title || 'Authentic Culinary Flavors'}</h1>
          ${subtitle ? `<p class="ib-hero-subtitle" style="font-size: 16px; color: #E2E8F0; line-height: 1.6; margin: 0; max-width: 620px;">${subtitle}</p>` : ''}
          <a class="ib-hero-btn" href="${buttonLink}" style="display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 12px 28px; background: #0B57D0; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; box-shadow: 0 4px 14px rgba(11,87,208,0.4); transition: transform 0.15s ease;">
            ${buttonText} <i class="fa-solid fa-arrow-right" style="font-size: 12px;"></i>
          </a>
        </div>

        ${isMultiple && showArrows ? `
          <!-- Prev / Next Chevron Arrows -->
          <button class="ib-hero-arrow ib-hero-prev" type="button" style="position: absolute; left: 20px; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border-radius: 50%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.25); color: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 4; transition: background 0.2s ease;">
            <i class="fa-solid fa-chevron-left" style="font-size: 15px;"></i>
          </button>
          <button class="ib-hero-arrow ib-hero-next" type="button" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border-radius: 50%; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.25); color: #FFFFFF; display: flex; align-items: center; justify-content: center; cursor: pointer; z-index: 4; transition: background 0.2s ease;">
            <i class="fa-solid fa-chevron-right" style="font-size: 15px;"></i>
          </button>
        ` : ''}

        ${isMultiple && showDots ? `
          <!-- Slide Navigation Dots -->
          <div class="ib-hero-dots" style="position: absolute; bottom: 18px; left: 0; width: 100%; display: flex; justify-content: center; gap: 8px; z-index: 4;">
            ${currentImages.map((_, i) => `
              <button class="ib-hero-dot ${i === 0 ? 'active' : ''}" data-idx="${i}" type="button" style="width: ${i === 0 ? '24px' : '8px'}; height: 8px; border-radius: 4px; border: none; background: ${i === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.45)'}; cursor: pointer; transition: all 0.3s ease; padding: 0;"></button>
            `).join("")}
          </div>
        ` : ''}
      </div>
    `;

    if (targetComp) {
      const newEl = targetComp.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    } else if (selectedComponent) {
      const newEl = selectedComponent.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    }
    builderHasUnsavedChanges = true;

    showToast("Hero banner & slider updated!");
    closeModal();
  });
}

// --- Inquiry Form Config Modal inside Editor ---
async function openContactFormModal(selectedComponent, siteId) {
  let formConfig = {
    title: "Send Us an Inquiry",
    subtitle: "Have questions about our products or retail availability? Fill out the form below.",
    recipientEmail: "",
    buttonText: "Send Message"
  };

  let targetComp = selectedComponent || (grapesEditor && grapesEditor.getSelected());
  if (targetComp) {
    let curr = targetComp;
    while (curr) {
      if (curr.get && (curr.get('type') === 'contact-form' || (curr.getAttributes && curr.getAttributes()['data-site-id'] !== undefined))) {
        targetComp = curr;
        break;
      }
      curr = curr.parent && curr.parent();
    }
  }

  if (targetComp) {
    const attrs = targetComp.getAttributes ? targetComp.getAttributes() : {};
    try {
      const raw = attrs["data-form-config"];
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        formConfig = { ...formConfig, ...parsed };
      }
    } catch {}
    if (attrs["data-recipient-email"]) {
      formConfig.recipientEmail = attrs["data-recipient-email"];
    }
  }

  const overlay = document.createElement("div");
  overlay.id = "contact-form-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="contact-form-modal-card" style="
      width: 520px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-envelope-open-text" style="margin-right: 8px; color: #0B57D0;"></i>Configure Inquiry Form</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Set headline, subtitle, action button, and recipient email routing.</p>
        </div>
        <button id="btn-close-form-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Form Title -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Form Headline</label>
          <input type="text" id="cfg-form-title" value="${formConfig.title || ''}" placeholder="e.g. Send Us an Inquiry" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

        <!-- Form Subtitle -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Subtitle / Instruction</label>
          <textarea id="cfg-form-subtitle" rows="2" placeholder="e.g. Have questions about our products or retail availability? Fill out the form below." style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; background: #fff; box-sizing: border-box; resize: vertical;">${formConfig.subtitle || ''}</textarea>
        </div>

        <!-- Recipient Email Override -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #1E293B; margin-bottom: 4px;">
            <i class="fa-solid fa-at" style="color: #0B57D0;"></i> Override Recipient Email(s)
          </label>
          <input type="text" id="cfg-form-recipient" value="${formConfig.recipientEmail || ''}" placeholder="e.g. info@brand.com, sales@brand.com" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box; margin-bottom: 4px;" />
          <span style="font-size: 11px; color: #64748B; line-height: 1.4; display: block;">
            Leave empty to automatically send notifications to all brand owners assigned to this site (dispatches from <strong>no-reply@hsgglobal.sg</strong>). Or enter comma-separated custom emails.
          </span>
        </div>

        <!-- Button Text -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Submit Button Label</label>
          <input type="text" id="cfg-form-btn-text" value="${formConfig.buttonText || 'Send Message'}" placeholder="e.g. Send Message" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-form-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-form-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Form</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("contact-form-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("contact-form-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-form-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-form-modal").addEventListener("click", closeModal);

  document.getElementById("btn-save-form-modal").addEventListener("click", () => {
    const title = document.getElementById("cfg-form-title").value.trim() || "Send Us an Inquiry";
    const subtitle = document.getElementById("cfg-form-subtitle").value.trim();
    const recipientEmail = document.getElementById("cfg-form-recipient").value.trim();
    const buttonText = document.getElementById("cfg-form-btn-text").value.trim() || "Send Message";

    const newConfig = {
      title,
      subtitle,
      recipientEmail,
      buttonText
    };

    let target = targetComp || selectedComponent || (grapesEditor && grapesEditor.getSelected());
    if (target) {
      let curr = target;
      while (curr) {
        if (curr.get && (curr.get('type') === 'contact-form' || (curr.getAttributes && curr.getAttributes()['data-site-id'] !== undefined))) {
          target = curr;
          break;
        }
        curr = curr.parent && curr.parent();
      }
    }

    const innerHtml = `
      <div class="ib-site-form-wrapper" data-form-config='${JSON.stringify(newConfig)}' style="max-width: 540px; margin: 30px auto; padding: 32px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 4px 16px rgba(0,0,0,0.04); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; box-sizing: border-box;">
        <h3 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 6px;">${title}</h3>
        ${subtitle ? `<p style="font-size: 13px; color: #64748b; margin-bottom: 20px;">${subtitle}</p>` : ''}
        
        <form class="ib-site-form" data-site-id="${siteId}" data-recipient-email="${recipientEmail}" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Full Name *</label>
            <input type="text" name="name" required placeholder="Your Name" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
          </div>

          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Email Address *</label>
              <input type="email" name="email" required placeholder="you@example.com" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
            </div>
            <div style="flex: 1; min-width: 200px;">
              <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Phone Number</label>
              <input type="tel" name="phone" placeholder="+65 9123 4567" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Subject</label>
            <input type="text" name="subject" placeholder="General Inquiry / Bulk Order" style="width: 100%; height: 38px; padding: 0 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none;" />
          </div>

          <div>
            <label style="display: block; font-size: 12px; font-weight: 600; color: #334155; margin-bottom: 4px;">Message *</label>
            <textarea name="message" required rows="4" placeholder="How can we help you?" style="width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; box-sizing: border-box; outline: none; resize: vertical;"></textarea>
          </div>

          <button type="submit" style="height: 42px; background: #0B57D0; color: #ffffff; border: none; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: background 0.15s ease; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <i class="fa-solid fa-paper-plane"></i> ${buttonText}
          </button>
          
          <div class="ib-form-status" style="display: none; padding: 10px; border-radius: 8px; font-size: 12.5px; text-align: center;"></div>
        </form>
      </div>
    `;

    if (target) {
      const newEl = target.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    } else if (selectedComponent) {
      const newEl = selectedComponent.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    }
    builderHasUnsavedChanges = true;

    showToast("Inquiry form updated!");
    closeModal();
  });
}

// --- Posts & News Grid Config Modal inside Editor ---
async function openPostsGridModal(selectedComponent, siteId) {
  let postsConfig = {
    site_id: siteId || "main",
    category: "ALL",
    columns: 3,
    limit: 6,
    showCover: true,
    showCategory: true,
    showDate: true,
    showPhotoCount: true,
    showExcerpt: true,
    showButton: true,
    buttonText: "Read Article"
  };

  let target = selectedComponent || (grapesEditor && grapesEditor.getSelected());
  if (target) {
    let curr = target;
    while (curr) {
      if (curr.get && (curr.get('type') === 'posts-grid' || (curr.getAttributes && curr.getAttributes()['data-posts-config'] !== undefined))) {
        target = curr;
        break;
      }
      curr = curr.parent && curr.parent();
    }
  }

  if (target) {
    const attrs = target.getAttributes ? target.getAttributes() : {};
    try {
      const raw = attrs["data-posts-config"];
      if (raw) {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        postsConfig = { ...postsConfig, ...parsed };
      }
    } catch {}
  }

  let sitesList = [];
  try {
    const sRes = await apiRequest("/api/tenant/sites");
    if (sRes.ok) sitesList = await sRes.json();
  } catch {}

  const overlay = document.createElement("div");
  overlay.id = "posts-grid-modal-overlay";
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  overlay.innerHTML = `
    <div id="posts-grid-modal-card" style="
      width: 540px;
      max-width: 94%;
      max-height: 90vh;
      background: white;
      border-radius: 16px;
      border: 1px solid #e4e4e7;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      transform: scale(0.95);
      transition: transform 0.2s ease;
      box-sizing: border-box;
      overflow: hidden;
    ">
      <!-- Header -->
      <div style="padding: 18px 24px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
        <div>
          <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a;"><i class="fa-solid fa-newspaper" style="margin-right: 8px; color: #0B57D0;"></i>Configure Posts Grid</h3>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #64748b;">Set filtering, layout columns, card elements, and order (newest on top).</p>
        </div>
        <button id="btn-close-posts-grid-modal" style="background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <!-- Body -->
      <div style="flex: 1; overflow-y: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box;">
        
        <!-- Filter by Site -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Filter by Site</label>
          <select id="cfg-posts-site" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
            <option value="${siteId}" ${postsConfig.site_id === siteId ? 'selected' : ''}>Current Site (${siteId})</option>
            <option value="ALL" ${postsConfig.site_id === "ALL" ? 'selected' : ''}>All Managed Sites</option>
            ${sitesList.filter(s => s.id !== siteId).map(s => `<option value="${s.id}" ${postsConfig.site_id === s.id ? 'selected' : ''}>${s.name || s.id} (${s.id})</option>`).join("")}
          </select>
        </div>

        <!-- Filter by Category -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Category Filter</label>
          <select id="cfg-posts-category" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
            <option value="ALL" ${postsConfig.category === "ALL" ? 'selected' : ''}>All Categories (Events, News, etc.)</option>
            <option value="Event" ${postsConfig.category === "Event" ? 'selected' : ''}>🎉 Events</option>
            <option value="News" ${postsConfig.category === "News" ? 'selected' : ''}>📢 News</option>
            <option value="Promotion" ${postsConfig.category === "Promotion" ? 'selected' : ''}>🏷️ Promotions</option>
            <option value="Announcement" ${postsConfig.category === "Announcement" ? 'selected' : ''}>📣 Announcements</option>
            <option value="Recipe" ${postsConfig.category === "Recipe" ? 'selected' : ''}>🍳 Recipes</option>
            <option value="Press" ${postsConfig.category === "Press" ? 'selected' : ''}>📰 Press</option>
          </select>
        </div>

        <!-- Columns & Limit -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <div style="flex: 1; min-width: 160px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Grid Columns</label>
            <select id="cfg-posts-columns" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              <option value="1" ${postsConfig.columns == 1 ? 'selected' : ''}>1 Column (List view)</option>
              <option value="2" ${postsConfig.columns == 2 ? 'selected' : ''}>2 Columns</option>
              <option value="3" ${postsConfig.columns == 3 || !postsConfig.columns ? 'selected' : ''}>3 Columns (Standard)</option>
              <option value="4" ${postsConfig.columns == 4 ? 'selected' : ''}>4 Columns (Compact)</option>
            </select>
          </div>

          <div style="flex: 1; min-width: 160px;">
            <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Maximum Posts to Show</label>
            <select id="cfg-posts-limit" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; cursor: pointer;">
              <option value="3" ${postsConfig.limit == 3 ? 'selected' : ''}>3 Posts</option>
              <option value="6" ${postsConfig.limit == 6 || !postsConfig.limit ? 'selected' : ''}>6 Posts</option>
              <option value="9" ${postsConfig.limit == 9 ? 'selected' : ''}>9 Posts</option>
              <option value="12" ${postsConfig.limit == 12 ? 'selected' : ''}>12 Posts</option>
              <option value="24" ${postsConfig.limit == 24 ? 'selected' : ''}>24 Posts</option>
            </select>
          </div>
        </div>

        <!-- Display Switches -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 12px; color: #334155;">
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-cover" ${postsConfig.showCover !== false ? 'checked' : ''} />
            <span>Show Cover Photo</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-cat" ${postsConfig.showCategory !== false ? 'checked' : ''} />
            <span>Show Category</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-date" ${postsConfig.showDate !== false ? 'checked' : ''} />
            <span>Show Date</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-photos-count" ${postsConfig.showPhotoCount !== false ? 'checked' : ''} />
            <span>Show Photo Count</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-excerpt" ${postsConfig.showExcerpt !== false ? 'checked' : ''} />
            <span>Show Excerpt</span>
          </label>
          <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="cfg-show-button" ${postsConfig.showButton !== false ? 'checked' : ''} />
            <span>Show Action Button</span>
          </label>
        </div>

        <!-- Button Text -->
        <div>
          <label style="display: block; font-size: 11.5px; font-weight: 700; color: #475569; margin-bottom: 6px;">Button Label</label>
          <input type="text" id="cfg-posts-btn-text" value="${postsConfig.buttonText || 'Read Article'}" style="width: 100%; height: 36px; padding: 0 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 12.5px; outline: none; background: #fff; box-sizing: border-box;" />
        </div>

      </div>

      <!-- Footer -->
      <div style="padding: 14px 24px; border-top: 1px solid #e2e8f0; background: #F8FAFC; display: flex; justify-content: flex-end; gap: 10px;">
        <button class="btn btn-secondary" id="btn-cancel-posts-grid-modal" style="height: 36px; padding: 0 16px; border-radius: 8px; font-size: 12.5px;">Cancel</button>
        <button class="btn btn-primary" id="btn-save-posts-grid-modal" style="height: 36px; padding: 0 18px; border-radius: 8px; font-size: 12.5px; font-weight: 600;">Save Grid</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    document.getElementById("posts-grid-modal-card").style.transform = "scale(1)";
  });

  const closeModal = () => {
    overlay.style.opacity = "0";
    document.getElementById("posts-grid-modal-card").style.transform = "scale(0.95)";
    setTimeout(() => overlay.remove(), 200);
  };

  document.getElementById("btn-close-posts-grid-modal").addEventListener("click", closeModal);
  document.getElementById("btn-cancel-posts-grid-modal").addEventListener("click", closeModal);

  document.getElementById("btn-save-posts-grid-modal").addEventListener("click", async () => {
    const siteVal = document.getElementById("cfg-posts-site").value;
    const catVal = document.getElementById("cfg-posts-category").value;
    const columns = parseInt(document.getElementById("cfg-posts-columns").value, 10) || 3;
    const limit = parseInt(document.getElementById("cfg-posts-limit").value, 10) || 6;
    const showCover = document.getElementById("cfg-show-cover").checked;
    const showCategory = document.getElementById("cfg-show-cat").checked;
    const showDate = document.getElementById("cfg-show-date").checked;
    const showPhotoCount = document.getElementById("cfg-show-photos-count").checked;
    const showExcerpt = document.getElementById("cfg-show-excerpt").checked;
    const showButton = document.getElementById("cfg-show-button").checked;
    const buttonText = document.getElementById("cfg-posts-btn-text").value.trim() || "Read Article";

    const newConfig = {
      site_id: siteVal,
      category: catVal,
      columns,
      limit,
      showCover,
      showCategory,
      showDate,
      showPhotoCount,
      showExcerpt,
      showButton,
      buttonText
    };

    let postsList = [];
    try {
      const endpoint = siteVal && siteVal !== "ALL" ? `/api/public/posts?site_id=${encodeURIComponent(siteVal)}` : "/api/public/posts";
      const pRes = await fetch(`${API_BASE}${endpoint}`);
      if (pRes.ok) {
        postsList = await pRes.json();
      }
    } catch {}

    if (catVal && catVal !== "ALL") {
      postsList = postsList.filter(p => p.category === catVal);
    }
    postsList = postsList.slice(0, limit);

    const innerHtml = `
      <div class="ib-posts-grid-container" data-posts-config='${JSON.stringify(newConfig)}' style="padding: 40px 20px; width: 100%; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="max-width: 1140px; margin: 0 auto;">
          
          ${postsList.length === 0 ? `
            <div style="text-align: center; padding: 48px 24px; border: 1.5px dashed #cbd5e1; border-radius: 12px; background: #f8fafc; color: #64748b;">
              <i class="fa-solid fa-newspaper" style="font-size: 28px; color: #0B57D0; margin-bottom: 10px; display: block;"></i>
              <h4 style="margin: 0 0 6px 0; font-size: 15px; font-weight: 700; color: #1e293b;">No published posts found</h4>
              <p style="margin: 0; font-size: 12.5px;">Create and publish posts in the <strong>Posts</strong> dashboard tab to display them here.</p>
            </div>
          ` : `
            <div class="ib-posts-grid" style="display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 24px;">
              ${postsList.map(post => {
                const pDate = post.created_at ? new Date(Number(post.created_at)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : "";
                const photos = Array.isArray(post.photos) ? post.photos : [];
                const coverImg = post.cover_image || (photos[0] || "");

                return `
                  <div class="ib-post-card" data-post='${JSON.stringify(post).replace(/'/g, "&apos;")}' style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 4px 12px rgba(0,0,0,0.03); transition: transform 0.2s ease, box-shadow 0.2s ease; cursor: pointer;">
                    
                    ${showCover ? `
                      <div class="ib-post-cover" style="position: relative; width: 100%; height: 180px; background: #f1f5f9; overflow: hidden;">
                        ${coverImg ? `<img src="${coverImg}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<div style="display:flex; height:100%; align-items:center; justify-content:center; color:#94a3b8;"><i class="fa-regular fa-image" style="font-size:24px;"></i></div>`}
                        
                        ${showCategory && post.category ? `
                          <span style="position: absolute; top: 10px; left: 10px; background: rgba(11, 87, 208, 0.9); backdrop-filter: blur(4px); color: #ffffff; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase;">
                            ${post.category}
                          </span>
                        ` : ''}

                        ${showPhotoCount && photos.length > 0 ? `
                          <span style="position: absolute; bottom: 10px; right: 10px; background: rgba(0, 0, 0, 0.65); backdrop-filter: blur(4px); color: #ffffff; font-size: 10.5px; font-weight: 600; padding: 2px 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                            <i class="fa-solid fa-camera"></i> ${photos.length}
                          </span>
                        ` : ''}
                      </div>
                    ` : ''}

                    <div style="padding: 18px 20px; display: flex; flex-direction: column; gap: 8px; flex: 1;">
                      ${showDate && pDate ? `
                        <div style="font-size: 11.5px; color: #64748b; font-weight: 500; display: flex; align-items: center; gap: 4px;">
                          <i class="fa-regular fa-calendar" style="font-size: 11px;"></i> ${pDate}
                        </div>
                      ` : ''}

                      <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                        ${post.title}
                      </h3>

                      ${showExcerpt && post.excerpt ? `
                        <p style="margin: 0; font-size: 13px; color: #475569; line-height: 1.5; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;">
                          ${post.excerpt}
                        </p>
                      ` : ''}

                      <div style="margin-top: auto; padding-top: 10px;">
                        ${showButton ? `
                          <span style="display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600; color: #0B57D0;">
                            ${buttonText} <i class="fa-solid fa-arrow-right" style="font-size: 11px;"></i>
                          </span>
                        ` : ''}
                      </div>
                    </div>

                  </div>
                `;
              }).join("")}
            </div>
          `}

        </div>
      </div>
    `;

    if (target) {
      const newEl = target.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    } else if (selectedComponent) {
      const newEl = selectedComponent.replaceWith(innerHtml);
      if (newEl && grapesEditor) {
        setTimeout(() => grapesEditor.select(newEl), 50);
      }
    }
    builderHasUnsavedChanges = true;

    showToast("Posts grid updated!");
    closeModal();
  });
}

function initPostsGrids() {
  document.querySelectorAll(".ib-post-card").forEach(card => {
    if (card.getAttribute("data-bound") === "true") return;
    card.setAttribute("data-bound", "true");

    card.addEventListener("click", () => {
      let post = null;
      try {
        const raw = card.getAttribute("data-post");
        if (raw) post = JSON.parse(raw);
      } catch {}
      if (post) {
        openPostPreviewModal(post);
      }
    });
  });
}

// --- Dynamic Runtime Initializers for Public Views ---
function initProductCarousels() {
  document.querySelectorAll(".ib-product-carousel-container").forEach(container => {
    const track = container.querySelector(".ib-carousel-track");
    const prevBtn = container.querySelector(".ib-carousel-prev");
    const nextBtn = container.querySelector(".ib-carousel-next");
    if (!track) return;

    if (prevBtn && !prevBtn.getAttribute("data-bound")) {
      prevBtn.setAttribute("data-bound", "true");
      prevBtn.addEventListener("click", () => {
        track.scrollBy({ left: -260, behavior: "smooth" });
      });
    }

    if (nextBtn && !nextBtn.getAttribute("data-bound")) {
      nextBtn.setAttribute("data-bound", "true");
      nextBtn.addEventListener("click", () => {
        track.scrollBy({ left: 260, behavior: "smooth" });
      });
    }
  });
}

function initProductImageSliders() {
  document.querySelectorAll(".ib-product-slider").forEach(wrap => {
    if (wrap.getAttribute("data-bound") === "true") return;
    wrap.setAttribute("data-bound", "true");

    let photos = [];
    try {
      const raw = wrap.getAttribute("data-photos");
      if (raw) photos = JSON.parse(raw);
    } catch {}

    if (!Array.isArray(photos) || photos.length <= 1) return;

    const img = wrap.querySelector(".ib-product-image");
    const dots = wrap.querySelectorAll(".ib-dot");
    let currentIdx = 0;

    const showPhoto = (idx) => {
      currentIdx = (idx + photos.length) % photos.length;
      if (img) img.src = photos[currentIdx];
      dots.forEach((dot, i) => {
        dot.style.background = i === currentIdx ? '#0B57D0' : 'rgba(255,255,255,0.7)';
      });
    };

    // Cycle on click or hover
    wrap.style.cursor = "pointer";
    wrap.addEventListener("click", (e) => {
      e.stopPropagation();
      showPhoto(currentIdx + 1);
    });
  });
}

function initHeroBannerSliders() {
  document.querySelectorAll(".ib-hero-slider").forEach(container => {
    if (container.getAttribute("data-slider-bound") === "true") return;
    container.setAttribute("data-slider-bound", "true");

    const slides = container.querySelectorAll(".ib-hero-slide");
    const dots = container.querySelectorAll(".ib-hero-dot");
    const prevBtn = container.querySelector(".ib-hero-prev");
    const nextBtn = container.querySelector(".ib-hero-next");
    if (slides.length <= 1) return;

    let currentIdx = 0;
    let timer = null;

    let config = {};
    try {
      const raw = container.getAttribute("data-banner-config");
      if (raw) config = JSON.parse(raw);
    } catch {}

    const interval = config.interval || 5000;
    const autoplay = config.autoplay !== false;

    const goToSlide = (idx) => {
      currentIdx = (idx + slides.length) % slides.length;
      slides.forEach((s, i) => {
        s.style.opacity = i === currentIdx ? "1" : "0";
        s.classList.toggle("active", i === currentIdx);
      });
      dots.forEach((d, i) => {
        d.style.width = i === currentIdx ? "24px" : "8px";
        d.style.background = i === currentIdx ? "#FFFFFF" : "rgba(255,255,255,0.45)";
        d.classList.toggle("active", i === currentIdx);
      });
    };

    const startAutoplay = () => {
      if (!autoplay) return;
      stopAutoplay();
      timer = setInterval(() => {
        goToSlide(currentIdx + 1);
      }, interval);
    };

    const stopAutoplay = () => {
      if (timer) clearInterval(timer);
    };

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(currentIdx - 1);
        startAutoplay();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(currentIdx + 1);
        startAutoplay();
      });
    }

    dots.forEach((dot, i) => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(i);
        startAutoplay();
      });
    });

    container.addEventListener("mouseenter", stopAutoplay);
    container.addEventListener("mouseleave", startAutoplay);

    startAutoplay();
  });
}

// --- Visitor Store Map Renderer ---
async function initVisitorMap(siteId, mapDiv, pagePath = "") {
  // 1. Ensure Leaflet CSS is loaded
  if (!document.getElementById("visitor-leaflet-css")) {
    const link = document.createElement("link");
    link.id = "visitor-leaflet-css";
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }

  // 2. Ensure Leaflet JS is loaded
  const loadLeaflet = () => {
    return new Promise((resolve) => {
      if (window.L) {
        resolve(window.L);
        return;
      }
      if (document.getElementById("visitor-leaflet-js")) {
        const check = setInterval(() => {
          if (window.L) {
            clearInterval(check);
            resolve(window.L);
          }
        }, 100);
        return;
      }
      const script = document.createElement("script");
      script.id = "visitor-leaflet-js";
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.onload = () => resolve(window.L);
      document.body.appendChild(script);
    });
  };

  const L = await loadLeaflet();
  if (!L) return;

  // Insert greyscale tile filter styles & hidden scrollbar for tabs
  if (!document.getElementById("map-tiles-style")) {
    const style = document.createElement("style");
    style.id = "map-tiles-style";
    style.innerHTML = `
      .leaflet-container { background: #f4f4f5 !important; }
      .leaflet-tile-container { filter: grayscale(100%) contrast(1.1) brightness(0.95); }
      .leaflet-control-zoom { display: none !important; }
      .visitor-map-retailer-tabs {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch !important;
        touch-action: pan-x !important;
        pointer-events: auto !important;
      }
      .visitor-map-retailer-tabs::-webkit-scrollbar {
        display: none !important;
        width: 0 !important;
        height: 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  try {
    const rawAttr = mapDiv.getAttribute("data-product-skus") || 
                    mapDiv.getAttribute("data-product-sku") || 
                    mapDiv.getAttribute("data-skus") || 
                    mapDiv.getAttribute("data-sku") || 
                    (mapDiv.dataset ? (mapDiv.dataset.productSkus || mapDiv.dataset.skus) : "") || 
                    "";

    let centerLat = parseFloat(mapDiv.getAttribute("data-center-lat") || "1.3521");
    let centerLng = parseFloat(mapDiv.getAttribute("data-center-lng") || "103.8198");
    let zoom = parseInt(mapDiv.getAttribute("data-zoom") || "12");
    let pins = [];

    // Clear GrapesJS editor placeholder text for public view
    mapDiv.innerHTML = "";

    // 1. Try fetching pre-resolved pins directly from Cloudflare Worker API
    try {
      const targetSiteId = siteId || "main";
      const apiUrl = `${API_BASE}/api/sites/${encodeURIComponent(targetSiteId)}/map-config?page_path=${encodeURIComponent(pagePath || "")}${rawAttr ? `&product_skus=${encodeURIComponent(rawAttr)}` : ''}`;
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        if (data.pins && Array.isArray(data.pins) && data.pins.length > 0) {
          pins = data.pins;
          if (data.map_center_lat) centerLat = parseFloat(data.map_center_lat);
          if (data.map_center_lng) centerLng = parseFloat(data.map_center_lng);
          if (data.map_zoom) zoom = parseInt(data.map_zoom);
        }
      }
    } catch (apiErr) {
      console.warn("Worker map-config API fetch failed, falling back to CSV calculation:", apiErr);
    }

    // 2. Fallback to client-side CSV calculation if API returned 0 pins
    if (pins.length === 0) {
      let mapProductSkus = [];
      if (rawAttr) {
        try {
          const decoded = rawAttr.replace(/&quot;/g, '"').trim();
          if (decoded.startsWith("[") && decoded.endsWith("]")) {
            mapProductSkus = JSON.parse(decoded);
          } else {
            mapProductSkus = decoded.split(",").map(s => s.trim()).filter(Boolean);
          }
        } catch {}
      }

      const targetSkus = (Array.isArray(mapProductSkus) ? mapProductSkus : [])
        .map(s => String(s).trim().toLowerCase().replace(/^["']|["']$/g, ""))
        .filter(Boolean);

      if (targetSkus.length > 0) {

      const retailerCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=1081696917&single=true&output=csv";
      const storeCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=1954354905&single=true&output=csv";
      const stockCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=2022682874&single=true&output=csv";
      const productCsvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSpLnulzvd5tnGT1vo9Ys3ucQIDi8VcpTxbjIyP2Paz3QOFYLw8Yytk1W-X6yYkrJzjTnsf3dsxo3DA/pub?gid=140966730&single=true&output=csv";

      const [retailers, stores, productLogs, products] = await Promise.all([
        getCachedCSVData("cached_retailers", retailerCsvUrl),
        getCachedCSVData("cached_stores", storeCsvUrl),
        getCachedCSVData("cached_stock", stockCsvUrl),
        getCachedCSVData("cached_products", productCsvUrl)
      ]);

      const thirtyDaysAgoMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const parseTs = (val) => {
        if (!val) return 0;
        if (typeof val === "number") return val < 1e11 ? val * 1000 : val;
        const n = Number(val);
        if (!isNaN(n) && n > 0) return n < 1e11 ? n * 1000 : n;
        const p = Date.parse(val);
        return isNaN(p) ? 0 : p;
      };

      const recentLogs = productLogs.filter(log => {
        const ts = parseTs(log["Timestamp"] || log["timestamp"] || log["Date"] || log["date"]);
        return ts >= thirtyDaysAgoMs;
      });

      const storeLatestLogMap = new Map();
      recentLogs.forEach(log => {
        const sId = String(log["Retailer Stores ID"] || log["Store ID"] || log["store_id"] || "").trim();
        if (!sId) return;
        const logTs = parseTs(log["Timestamp"] || log["timestamp"] || log["Date"] || log["date"]);
        const existing = storeLatestLogMap.get(sId);
        if (!existing || logTs > parseTs(existing["Timestamp"] || existing["timestamp"] || existing["Date"] || existing["date"])) {
          storeLatestLogMap.set(sId, log);
        }
      });

      storeLatestLogMap.forEach((latestLog, storeId) => {
        let auditedSkus = [];
        try {
          auditedSkus = JSON.parse(latestLog["Audit JSON"] || latestLog.audit_json || "[]");
        } catch {}

        const stockProducts = [];
        auditedSkus.forEach(auditItem => {
          const itemSku = String(auditItem.sku || auditItem.SKU || "").trim().toLowerCase();
          if (!itemSku) return;

          if (targetSkus.length > 0 && targetSkus.includes(itemSku)) {
            const qty = Number(auditItem.qty || auditItem.quantity) || 0;
            if (qty > 0) {
              const prodDetail = products.find(p => String(p.SKU || p.sku || "").trim().toLowerCase() === itemSku);
              stockProducts.push({
                sku: auditItem.sku || auditItem.SKU,
                name: prodDetail ? (prodDetail["Display Name"] || prodDetail.Name || prodDetail.name || auditItem.sku) : auditItem.sku,
                qty: qty,
                image: prodDetail ? (prodDetail["Image"] || prodDetail.Image || prodDetail.image || "") : ""
              });
            }
          }
        });

        if (stockProducts.length > 0) {
          const store = stores.find(s => String(s.ID || s.id || "").trim() === String(storeId));
          if (!store) return;

          const pinLoc = String(
            store["Pin Locations"] || 
            store["Pin Location"] || 
            store["Coordinates"] || 
            store["Location"] || 
            store["Lat,Lng"] || 
            store["lat,lng"] || 
            ""
          ).trim();
          if (!pinLoc) return;

          const coords = pinLoc.split(",").map(s => parseFloat(s.trim()));
          if (coords.length !== 2 || isNaN(coords[0]) || isNaN(coords[1])) return;

          const retId = store["Retailers ID"] || store["Retailer ID"] || store["retailer_id"];
          const retailer = retailers.find(r => String(r.ID || r.id || "").trim() === String(retId));
          const retailerName = retailer ? (retailer["Display Name"] || retailer["Name"] || retailer.name || "") : "";
          const storeName = store["Display Name"] || store["Name"] || store.name || `Store #${store.ID || store.id}`;
          const retailerTitleUpper = String(retailerName || storeName).toUpperCase();
          const storeAddress = store.Address || store["Store Address"] || store["Full Address"] || store["Address Details"] || store["Location Address"] || store.address || store.location || store["Alamat"] || "";

          pins.push({
            id: store.ID || store.id,
            name: retailerTitleUpper,
            address: storeAddress,
            lat: coords[0],
            lng: coords[1],
            retailer_logo: retailer ? (retailer["Logo Image"] || retailer.Logo || retailer.logo || "") : "",
            retailer_name: retailerTitleUpper,
            stock: stockProducts
          });
        }
      });
      }
    }

    // Ensure mapDiv is positioned relatively so absolute tabs overlay works
    mapDiv.style.position = "relative";

    // Create or locate the tab bar container as a floating overlay inside the map container
    let tabContainer = mapDiv.querySelector(".visitor-map-retailer-tabs");
    if (!tabContainer) {
      tabContainer = document.createElement("div");
      tabContainer.className = "visitor-map-retailer-tabs";
      tabContainer.style.cssText = `
        position: absolute;
        top: 8px;
        left: 0;
        right: 0;
        width: 100%;
        max-width: 100%;
        display: flex;
        gap: 6px;
        padding: 6px 14px 10px 14px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.92) 0%, rgba(255, 255, 255, 0.6) 70%, rgba(255, 255, 255, 0) 100%);
        border: none;
        box-shadow: none;
        box-sizing: border-box;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        white-space: nowrap;
        z-index: 1000;
        justify-content: safe center;
        align-items: center;
        scrollbar-width: none;
        -ms-overflow-style: none;
        touch-action: pan-x;
        pointer-events: auto;
      `;

      // Prevent map dragging when touching / swiping tabs on mobile
      if (L && L.DomEvent) {
        L.DomEvent.disableClickPropagation(tabContainer);
        L.DomEvent.disableScrollPropagation(tabContainer);
      }
      tabContainer.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      tabContainer.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
      tabContainer.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
      tabContainer.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

      mapDiv.appendChild(tabContainer);
    }

    let activeRetailer = "All";

    // Extract unique retailers from pins
    const uniqueRetailers = new Map();
    pins.forEach(pin => {
      if (pin.retailer_name) {
        uniqueRetailers.set(pin.retailer_name, pin.retailer_logo);
      }
    });

    // Display tab bar ONLY if more than 1 retailer exists
    if (uniqueRetailers.size <= 1) {
      tabContainer.style.display = "none";
    } else {
      tabContainer.style.display = "flex";
      tabContainer.style.webkitOverflowScrolling = "touch";
    }

    const map = L.map(mapDiv, { zoomControl: false }).setView([centerLat, centerLng], zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    // Responsive dynamic pin dimensions that scale down when zooming out, with max size cap and 15px 1:1 minimum
    const calculatePinSize = () => {
      const isMobile = window.innerWidth < 640;
      const maxPinSize = isMobile ? 32 : 40;
      const currentZoom = map ? map.getZoom() : 12;
      
      // Zoom 13+ is full max size (40px desktop / 32px mobile)
      // Smoothly scales down when zooming out, with a strict 15px minimum (1:1)
      const minPinSize = 15;
      const scaleDiff = (currentZoom - 13) * 6;
      const calculated = Math.round(maxPinSize + scaleDiff);
      return Math.max(minPinSize, Math.min(maxPinSize, calculated));
    };

    const filterPins = () => {
      markersGroup.clearLayers();
      const pinSize = calculatePinSize();
      const halfPin = pinSize / 2;
      const isMobile = window.innerWidth < 640;
      
      pins.forEach((pin) => {
        if (activeRetailer !== "All" && pin.retailer_name !== activeRetailer) {
          return;
        }

        const logoUrl = pin.retailer_logo;
        const hasLogo = !!logoUrl;
        const iconHtml = `
          <div style="
            width: ${pinSize}px;
            height: ${pinSize}px;
            aspect-ratio: 1 / 1;
            border-radius: 50%;
            background: ${hasLogo ? '#ffffff' : '#27272a'};
            border: ${pinSize <= 18 ? '1px' : '2px'} solid #ffffff;
            box-shadow: 0 1px ${pinSize < 24 ? '3px' : '6px'} rgba(0,0,0,0.18);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            flex-shrink: 0;
            transition: width 0.2s ease, height 0.2s ease;
          ">
            ${hasLogo ? `<img src="${logoUrl}" style="width: 100%; height: 100%; object-fit: contain; padding: ${pinSize <= 16 ? '1px' : '2px'}; box-sizing: border-box;" />` : `<i class="fa-solid fa-store" style="color: #ffffff; font-size: ${Math.max(6.5, Math.round(pinSize * 0.4))}px;"></i>`}
          </div>
        `;
        const customIcon = L.divIcon({
          html: iconHtml,
          className: 'custom-retailer-pin',
          iconSize: [pinSize, pinSize],
          iconAnchor: [halfPin, halfPin],
          popupAnchor: [0, -halfPin]
        });

        const marker = L.marker([pin.lat, pin.lng], { icon: customIcon });
        const productsHtml = pin.stock.map((p) => `
          <div style="width: 46px; height: 46px; border-radius: 8px; border: 1px solid #e4e4e7; overflow: hidden; background: #fafafa; display: flex; align-items: center; justify-content: center;" title="${p.name}">
            <img src="${p.image || 'https://via.placeholder.com/46'}" style="width: 100%; height: 100%; object-fit: cover;" />
          </div>
        `).join("");

        const titleUpper = String(pin.retailer_name || pin.name || "").toUpperCase();
        const storeAddressHtml = pin.address 
          ? `<p style="margin:0 0 8px 0; color:#71717a; font-size:11px; font-weight:500;">${pin.address}</p>` 
          : '';

        marker.bindPopup(`
          <div style="font-family: Inter, Outfit, sans-serif; font-size:12px; width: 220px; line-height: 1.4; text-align: center; box-sizing: border-box;">
            <h4 style="margin:0 0 2px 0; color:#18181b; font-weight:800; font-size:13.5px; text-transform: uppercase;">${titleUpper}</h4>
            ${storeAddressHtml}
            ${productsHtml ? `
              <div style="display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; border-top: 1px solid #e4e4e7; padding-top: 8px; margin-top: 4px;">
                ${productsHtml}
              </div>
            ` : ''}
          </div>
        `);

        markersGroup.addLayer(marker);
      });
    };

    // Re-scale pins whenever user zooms in/out
    map.on("zoomend", () => {
      filterPins();
    });

    // Physical growth styling pushing adjacent tabs outward with spring transition
    const getTabStyle = (isActive, isHovered = false) => {
      let pad = "5px 12px";
      let fontSize = "11.5px";
      let margin = "0 3px";
      let boxShadow = "0 1px 2px rgba(0,0,0,0.04)";
      let zIndex = "1";
      let transform = "scale(1)";

      if (isActive) {
        pad = "7px 18px";
        fontSize = "12.5px";
        margin = "0 8px";
        boxShadow = "0 4px 12px rgba(0,0,0,0.12)";
        zIndex = "5";
        transform = "scale(1.05)";
      } else if (isHovered) {
        pad = "6px 15px";
        fontSize = "12px";
        margin = "0 5px";
        boxShadow = "0 3px 8px rgba(0,0,0,0.08)";
        zIndex = "4";
        transform = "scale(1.02)";
      }

      return `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: ${pad};
        font-size: ${fontSize};
        font-weight: 600;
        font-family: Inter, Outfit, sans-serif;
        border: 1px solid ${isActive ? '#c4c4c7' : '#e4e4e7'};
        background: #f4f4f5;
        color: #3f3f46;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        transform: ${transform};
        box-shadow: ${boxShadow};
        margin: ${margin};
        z-index: ${zIndex};
        flex-shrink: 0;
      `;
    };

    const renderTabs = () => {
      tabContainer.innerHTML = "";

      const attachHoverEvents = (btn, isActive) => {
        btn.addEventListener("mouseenter", () => {
          if (!isActive) {
            btn.style.cssText = getTabStyle(false, true);
          }
        });
        btn.addEventListener("mouseleave", () => {
          if (!isActive) {
            btn.style.cssText = getTabStyle(false, false);
          }
        });
      };

      // "All" tab
      const isAllActive = activeRetailer === "All";
      const allTab = document.createElement("button");
      allTab.textContent = "All";
      allTab.style.cssText = getTabStyle(isAllActive);
      attachHoverEvents(allTab, isAllActive);
      allTab.addEventListener("click", () => {
        activeRetailer = "All";
        renderTabs();
        filterPins();
      });
      tabContainer.appendChild(allTab);

      // Retailer tabs
      uniqueRetailers.forEach((logoUrl, name) => {
        const isTabActive = activeRetailer === name;
        const tab = document.createElement("button");
        tab.style.cssText = getTabStyle(isTabActive);
        tab.innerHTML = `
          ${logoUrl ? `<img src="${logoUrl}" style="width:14px; height:14px; object-fit:contain; border-radius:2px;" />` : ''}
          <span>${name}</span>
        `;
        attachHoverEvents(tab, isTabActive);
        tab.addEventListener("click", () => {
          activeRetailer = name;
          renderTabs();
          filterPins();
        });
        tabContainer.appendChild(tab);
      });
    };

    // Initial render
    renderTabs();
    filterPins();

  } catch (e) {
    console.error("Failed to load visitor store locator map:", e);
  }
}

// --- Initialization ---
initAuthObserver();
handleRoute();
