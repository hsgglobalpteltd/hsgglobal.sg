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

const API_BASE = "https://ib.hsgglobalpteltd.workers.dev";

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

// --- Main Route Router Core ---
async function handleRoute() {
  const route = parseRoute();
  
  if (route.name === "login") {
    if (isAuthInitializing) return; // Keep loading spinner showing
    renderLoginView();
    return;
  }
  
  if (route.name === "dashboard") {
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
    await renderPublicSiteView(route.siteId, route.pagePath);
    return;
  }
}

// --- Views Rendering ---

// 1. Matches Project 1 Google Login Page Layout exactly with inline SVG icon
function renderLoginView() {
  document.body.style.overflow = "hidden";
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="login-wrapper">
      <div class="login-card">
        <div class="login-card-header">
          <h1 class="login-logo">iB HSG Global</h1>
          <p class="login-subtitle">Connecting Teams. Bridging Operations.</p>
        </div>
        <div class="login-card-divider"></div>
        <p class="login-desc">
          Welcome to the HSG Global Internal Bridge. Authenticate below using your Google login to access your workspaces.
        </p>
        
        <button id="google-login-btn" class="login-btn">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" style="margin-right: 10px;">
            <path fill="#4285F4" d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.47h4.84c-.21 1.12-.84 2.07-1.79 2.7v2.25h2.9c1.69-1.55 2.69-3.84 2.69-6.58z"></path>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.2l-2.9-2.25c-.8.54-1.84.85-3.06.85-2.35 0-4.34-1.58-5.05-3.71H.92v2.32C2.4 16.03 5.48 18 9 18z"></path>
            <path fill="#FBBC05" d="M3.95 10.69A5.4 5.4 0 0 1 3.6 9c0-.59.1-1.17.28-1.69V4.99H.92A8.998 8.998 0 0 0 0 9c0 1.58.4 3.09 1.12 4.42l2.83-2.31z"></path>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35L15 2.3C13.46.86 11.42 0 9 0 5.48 0 2.4 1.97.92 4.99l2.83 2.31c.71-2.13 2.7-3.72 5.05-3.72z"></path>
          </svg>
          <span>Sign In with Google</span>
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
  
  // Fetch tenant sites for sidebar dynamically
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

  // Set default active sub-module if dashboard is active and sites exist
  if (activeSidebar === "dashboard" && sites.length > 0) {
    activeSidebar = sites[0].id;
  }

  const isAdmin = currentUser.email === "hsgglobalpteltd@gmail.com" || (currentTenant && ["Administrator", "Manager", "Operator"].includes(currentTenant.role));

  let breadcrumbText = "Portal Builder";
  if (activeSidebar === "admin") {
    breadcrumbText += " / Main Site";
  } else {
    const activeSite = sites.find(s => s.id === activeSidebar);
    if (activeSite) {
      breadcrumbText += ` / ${activeSite.name}`;
    }
  }

  app.innerHTML = `
    <div class="app-container">
      <!-- 1. Side Panel Navigation -->
      <aside class="side-panel" id="side-panel">
        <div class="side-panel-header">
          <div class="brand">iB HSG Global Sites</div>
          <button class="toggle-sidebar-btn" id="toggle-sidebar-btn">
            <i class="fa-solid fa-bars"></i>
          </button>
        </div>
        <ul class="side-menu">
          ${isAdmin ? `
            <li style="position: relative;">
              <a class="side-menu-item ${activeSidebar === "admin" ? "active" : ""}" id="menu-admin" style="padding-right: 40px;">
                <i class="fa-solid fa-globe"></i>
                <span class="side-menu-text">Main Site</span>
              </a>
              <button class="btn-icon" id="btn-site-settings-main" title="Site Settings" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 100; color: var(--text-muted); font-size: 13px; padding: 4px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.15s ease;">
                <i class="fa-solid fa-gear"></i>
              </button>
            </li>

            <!-- Admin Owned Sites (No Assigned Users) -->
            ${sites.filter(s => s.id !== "main" && (!s.tenant_emails || s.tenant_emails.length === 0)).map(site => `
              <li style="position: relative;">
                <a class="side-menu-item ${activeSidebar === site.id ? "active" : ""}" id="menu-site-${site.id}" style="padding-right: 40px;">
                  ${site.favicon ? `
                    <img src="${site.favicon}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
                  ` : `
                    <div style="width: 22px; height: 22px; border-radius: 50%; background-color: #e4e4e7; border: 1px solid #d4d4d8; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #71717a; flex-shrink: 0;">
                      <i class="fa-solid fa-globe"></i>
                    </div>
                  `}
                  <span class="side-menu-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">${site.name}</span>
                </a>
                <button class="btn-icon" id="btn-site-settings-${site.id}" title="Site Settings" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 100; color: var(--text-muted); font-size: 13px; padding: 4px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.15s ease;">
                  <i class="fa-solid fa-gear"></i>
                </button>
              </li>
            `).join("")}

            <li style="border-top: 1px dashed var(--border-color); margin-top: 8px; padding-top: 8px;">
              <a class="side-menu-item" id="menu-create-site" style="color: var(--accent-color);">
                <i class="fa-solid fa-circle-plus"></i>
                <span class="side-menu-text">Create Site</span>
              </a>
            </li>
          ` : `
            <!-- Flat Assigned Sites List (DFT only) -->
            ${sites.map(site => `
              <li style="position: relative;">
                <a class="side-menu-item ${activeSidebar === site.id ? "active" : ""}" id="menu-site-${site.id}" style="padding-right: 40px;">
                  ${site.favicon ? `
                    <img src="${site.favicon}" style="width: 22px; height: 22px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
                  ` : `
                    <div style="width: 22px; height: 22px; border-radius: 50%; background-color: #e4e4e7; border: 1px solid #d4d4d8; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #71717a; flex-shrink: 0;">
                      <i class="fa-solid fa-globe"></i>
                    </div>
                  `}
                  <span class="side-menu-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px;">${site.name}</span>
                </a>
                <button class="btn-icon" id="btn-site-settings-${site.id}" title="Site Settings" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 100; color: var(--text-muted); font-size: 13px; padding: 4px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.15s ease;">
                  <i class="fa-solid fa-gear"></i>
                </button>
              </li>
            `).join("")}
          `}
        </ul>
        <div class="side-panel-footer" style="padding: 16px; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 12px; box-sizing: border-box; flex-shrink: 0;">
          
          ${isAdmin ? `
            <!-- Collapsible Sites Selector (Searchable & Scrollable - DFA only) -->
            <div class="sidebar-sites-selector" style="display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 4px;">
              <button id="btn-toggle-sites-collapse" style="background: none; border: none; display: flex; justify-content: space-between; align-items: center; width: 100%; text-align: left; font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; cursor: pointer; padding: 0;">
                <span>Projects / Sites</span>
                <i class="fa-solid ${isSidebarSitesExpanded ? 'fa-chevron-down' : 'fa-chevron-up'}" style="font-size: 9px; color: var(--text-muted);"></i>
              </button>
              
              <div id="sidebar-sites-panel" style="display: ${isSidebarSitesExpanded ? 'flex' : 'none'}; flex-direction: column; gap: 8px;">
                <input type="text" id="sidebar-sites-search" placeholder="Search sites..." value="${sidebarSearchTerm}" style="width: 100%; border: 1px solid var(--border-color); border-radius: 6px; padding: 6px 10px; font-size: 11px; outline: none; background: var(--bg-card); box-sizing: border-box; color: var(--text-color);" />
                
                <div id="sidebar-sites-list" style="display: flex; flex-direction: column; gap: 4px; max-height: 250px; overflow-y: auto; box-sizing: border-box;">
                  <!-- Dynamically populated in JavaScript below -->
                </div>
              </div>
            </div>
          ` : ""}

          <!-- User Profile Widget -->
          <div id="user-profile-widget" style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; background-color: var(--bg-hover, #f4f4f5); cursor: pointer; transition: all 0.15s ease;" title="Edit Profile">
            <!-- Avatar Circle -->
            <div style="width: 32px; height: 32px; border-radius: 50%; background-color: var(--accent-color); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; flex-shrink: 0;">
              ${(currentTenant?.name || currentUser.displayName || currentUser.email).substring(0, 2).toUpperCase()}
            </div>
            <!-- User Text info -->
            <div style="flex: 1; min-width: 0; display: flex; flex-direction: column;">
              <span style="font-size: 13px; font-weight: 700; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${currentTenant?.name || currentUser.displayName || currentUser.email}</span>
              <span style="font-size: 11px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${currentUser.email}</span>
            </div>
            <i class="fa-solid fa-user-pen" style="font-size: 12px; color: #a1a1aa;"></i>
          </div>
          
          <button class="btn btn-secondary" id="logout-btn" style="width: 100%; max-width: 100%; margin: 0; height: 36px; display: flex; align-items: center; justify-content: center; gap: 8px;"><i class="fa-solid fa-right-from-bracket"></i> <span class="side-menu-text">Logout</span></button>
        </div>
      </aside>
      
      <!-- 2. Workspace Wrapper -->
      <div class="workspace-wrapper">
        <!-- 3. TopBar -->
        <header class="top-bar">
          <div class="top-bar-left">
            <i class="fa-solid fa-house-laptop"></i>
            <span id="breadcrumb-title">${breadcrumbText}</span>
          </div>
          <div class="top-bar-right">
            <span>Welcome, <strong>${currentUser.displayName || currentUser.email}</strong></span>
          </div>
        </header>
        
        <!-- 4. Main Content Area -->
        <main class="main-content">
          <div class="container-alignment" id="workspace-content">
            <!-- Dynamic Subview Mount -->
          </div>
        </main>
      </div>
    </div>
  `;
  
  // Bind Sidebar toggler
  document.getElementById("toggle-sidebar-btn").addEventListener("click", () => {
    document.getElementById("side-panel").classList.toggle("collapsed");
  });
  
  document.getElementById("logout-btn").addEventListener("click", logoutTenant);
 
  const profileWidget = document.getElementById("user-profile-widget");
  if (profileWidget) {
    profileWidget.addEventListener("click", () => {
      openUserProfileModal();
    });
    profileWidget.addEventListener("mouseenter", () => {
      profileWidget.style.backgroundColor = "#e4e4e7";
    });
    profileWidget.addEventListener("mouseleave", () => {
      profileWidget.style.backgroundColor = "var(--bg-hover, #f4f4f5)";
    });
  }

  if (!isAdmin) {
    // Bind Tenant-specific Assigned Sites click events (DFT)
    sites.forEach(site => {
      const menuEl = document.getElementById(`menu-site-${site.id}`);
      if (menuEl) {
        menuEl.addEventListener("click", (e) => {
          e.preventDefault();
          activeSidebar = site.id;
          renderDashboardView();
        });
      }

      const settingsEl = document.getElementById(`btn-site-settings-${site.id}`);
      if (settingsEl) {
        settingsEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          await openSiteSettingsModal(site);
        });
      }
    });
  } else {
    // Render & bind the collapsible sites list (DFA only)
    const renderSidebarSitesList = () => {
      const listDiv = document.getElementById("sidebar-sites-list");
      if (!listDiv) return;

      const filtered = sites.filter(s => 
        s.id !== "main" && 
        (s.tenant_emails && s.tenant_emails.length > 0) &&
        (
          s.name.toLowerCase().includes(sidebarSearchTerm.toLowerCase()) || 
          s.id.toLowerCase().includes(sidebarSearchTerm.toLowerCase())
        )
      );

      listDiv.innerHTML = filtered.length === 0 
        ? `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; padding: 8px 0; text-align: center;">No sites found.</div>`
        : filtered.map(site => `
            <div style="position: relative; display: flex; align-items: center; width: 100%; box-sizing: border-box;">
              <a class="side-menu-item ${activeSidebar === site.id ? 'active' : ''}" id="menu-site-${site.id}" style="padding-right: 40px; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; text-decoration: none; border-radius: 6px; padding: 6px 12px; font-size: 12px; cursor: pointer; color: var(--text-color);">
                ${site.favicon ? `
                  <img src="${site.favicon}" style="width: 18px; height: 18px; border-radius: 50%; object-fit: cover; flex-shrink: 0;" />
                ` : `
                  <div style="width: 18px; height: 18px; border-radius: 50%; background-color: #e4e4e7; border: 1px solid #d4d4d8; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #71717a; flex-shrink: 0;">
                    <i class="fa-solid fa-globe"></i>
                  </div>
                `}
                <span class="side-menu-text" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 120px; font-weight: 600;">${site.name}</span>
              </a>
              <button class="btn-icon" id="btn-site-settings-${site.id}" title="Site Settings" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 100; color: var(--text-muted); font-size: 12px; padding: 4px; border: none; background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: color 0.15s ease;">
                <i class="fa-solid fa-gear"></i>
              </button>
            </div>
          `).join("");

      // Bind click handlers for site selections
      filtered.forEach(site => {
        const menuEl = document.getElementById(`menu-site-${site.id}`);
        if (menuEl) {
          menuEl.addEventListener("click", (e) => {
            e.preventDefault();
            activeSidebar = site.id;
            renderDashboardView();
          });
        }
        
        const settingsEl = document.getElementById(`btn-site-settings-${site.id}`);
        if (settingsEl) {
          settingsEl.addEventListener("click", async (e) => {
            e.stopPropagation();
            await openSiteSettingsModal(site);
          });
        }
      });
    };

    // Initial render of the sites list
    renderSidebarSitesList();

    // Search input change handler
    const searchInput = document.getElementById("sidebar-sites-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        sidebarSearchTerm = e.target.value;
        renderSidebarSitesList();
      });
    }

    // Toggle collapse handler
    const toggleBtn = document.getElementById("btn-toggle-sites-collapse");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        isSidebarSitesExpanded = !isSidebarSitesExpanded;
        const panel = document.getElementById("sidebar-sites-panel");
        if (panel) panel.style.display = isSidebarSitesExpanded ? "flex" : "none";
        const icon = toggleBtn.querySelector("i");
        if (icon) {
          icon.className = isSidebarSitesExpanded ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
        }
      });
    }

    const adminTab = document.getElementById("menu-admin");
    if (adminTab) {
      adminTab.addEventListener("click", () => {
        activeSidebar = "admin";
        renderDashboardView();
      });
    }

    const mainSettingsEl = document.getElementById("btn-site-settings-main");
    if (mainSettingsEl) {
      mainSettingsEl.addEventListener("click", async (e) => {
        e.stopPropagation();
        const mainSite = sites.find(s => s.id === "main") || {
          id: "main",
          name: "Main Corporate Website",
          favicon: "",
          custom_domain: "",
          fb_pixel: "",
          adsense_id: "",
          tiktok_pixel: "",
          allowed_brand_ids: "[]"
        };
        await openSiteSettingsModal(mainSite);
      });
    }

    // Bind click handlers for Admin-owned sites (DFA only)
    const adminOwnedSites = sites.filter(s => s.id !== "main" && (!s.tenant_emails || s.tenant_emails.length === 0));
    adminOwnedSites.forEach(site => {
      const menuEl = document.getElementById(`menu-site-${site.id}`);
      if (menuEl) {
        menuEl.addEventListener("click", (e) => {
          e.preventDefault();
          activeSidebar = site.id;
          renderDashboardView();
        });
      }
      
      const settingsEl = document.getElementById(`btn-site-settings-${site.id}`);
      if (settingsEl) {
        settingsEl.addEventListener("click", async (e) => {
          e.stopPropagation();
          await openSiteSettingsModal(site);
        });
      }
    });
  }

  const createSiteTab = document.getElementById("menu-create-site");
  if (createSiteTab) {
    createSiteTab.addEventListener("click", async () => {
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
          activeSidebar = cleanId; // automatically select the newly created site
          renderDashboardView();
        } else {
          const err = await res.json().catch(() => ({}));
          showToast(err.error || "Failed to create site container.", "danger");
        }
      } catch (e) {
        showToast("Network error creating site.", "danger");
      }
    });
  }

  // Load appropriate View content inside .content-body
  if (activeSidebar === "admin") {
    await renderAdminSettingsSubView();
  } else if (activeSidebar === "dashboard" || sites.length === 0) {
    await renderTenantDashboardSubView();
  } else {
    const activeSite = sites.find(s => s.id === activeSidebar);
    await renderSitePagesSubView(activeSidebar, activeSite ? activeSite.name : activeSidebar);
  }
}

// --- Tenant View ---
async function renderTenantDashboardSubView() {
  const workspace = document.getElementById("workspace-content");
  workspace.innerHTML = `<div style="padding: 40px; text-align: center;"><i class="fa-solid fa-spinner fa-spin" style="font-size: 32px; color: var(--accent-color);"></i><p style="margin-top: 15px;">Loading your sites...</p></div>`;

  try {
    const res = await apiRequest("/api/tenant/sites");
    if (!res.ok) throw new Error("Failed to load sites");
    const sites = await res.json();
    sites.forEach(s => {
      if (s.favicon) s.favicon = s.favicon.replace(/ /g, "%20");
    });
    
    if (sites.length === 0) {
      workspace.innerHTML = "";
      return;
    }

    workspace.innerHTML = `
      <div class="content-header">
        <div>
          <h1>Other Sites</h1>
          <p>Manage and visually edit the website layouts assigned to your account.</p>
        </div>
      </div>
      <div class="content-body">
        <div class="dashboard-grid" id="tenant-sites-grid">
          <!-- Sites list -->
        </div>
      </div>
    `;
    
    for (const site of sites) {
      const card = document.createElement("div");
      card.className = "stat-card glass-card";
      card.style.flexDirection = "column";
      card.style.alignItems = "stretch";
      card.style.cursor = "default";
      card.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="stat-icon"><i class="fa-solid fa-globe"></i></div>
            <div>
              <h3 style="font-size: 15px; font-weight:700;">${site.name}</h3>
              <p style="font-size: 11px; font-family: monospace;">/${site.id}</p>
            </div>
          </div>
          <span class="badge badge-approved">Active</span>
        </div>
        <div style="border-top: 1px solid var(--border-color); padding-top: 12px; margin-top: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <span style="font-size: 12px; color: var(--text-muted);">Pages limit (Max 5):</span>
            <strong style="font-size: 13px;" id="page-count-${site.id}">0 / 5</strong>
          </div>
          <div id="pages-list-${site.id}" style="display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;">
            <!-- Loading Pages -->
          </div>
          <div style="display: flex; gap: 10px;">
            <button class="btn btn-primary" id="btn-add-page-${site.id}" style="flex: 1;"><i class="fa-solid fa-plus"></i> Add Page</button>
            <a href="/${site.id}" target="_blank" class="btn btn-secondary" style="max-width: 60px; min-width: 48px; padding: 0;"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>
          </div>
        </div>
      `;
      grid.appendChild(card);
      
      // Load pages for this site
      loadTenantSitePages(site.id);
      
      document.getElementById(`btn-add-page-${site.id}`).addEventListener("click", () => {
        addNewPagePrompt(site.id);
      });
    }
  } catch (e) {
    workspace.innerHTML = `<div class="glass-card" style="color: var(--danger-color); padding: 20px;">Error loading sites: ${e.message}</div>`;
  }
}

async function renderSitePagesSubView(siteId, siteName) {
  await renderSitePreviewDashboard(siteId, siteName, false);
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
    <div style="display: flex; width: calc(100% + 40px); height: calc(100vh - 56px); margin: -20px; gap: 0; overflow: hidden; box-sizing: border-box;">
      
      <!-- 1. Center Simulator Area -->
      <div style="flex: 1; display: flex; flex-direction: column; background-color: var(--bg-card); overflow: hidden; height: 100%;">
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

  // Swap Welcome Message with Device Switcher in topbar-right
  const topBarRight = document.querySelector(".top-bar-right");
  if (topBarRight) {
    topBarRight.innerHTML = `
      <div style="display: flex; gap: 4px; background-color: var(--bg-card); padding: 4px; border-radius: 6px; border: 1px solid var(--border-color); flex-shrink: 0;">
        <button class="btn-icon active" id="btn-device-desktop" title="Desktop View" style="padding: 6px 10px; border-radius: 4px;"><i class="fa-solid fa-desktop"></i></button>
        <button class="btn-icon" id="btn-device-tablet" title="Tablet View" style="padding: 6px 10px; border-radius: 4px;"><i class="fa-solid fa-tablet-screen-button"></i></button>
        <button class="btn-icon" id="btn-device-phone" title="Mobile View" style="padding: 6px 10px; border-radius: 4px;"><i class="fa-solid fa-mobile-screen-button"></i></button>
      </div>
    `;
  }

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
  });

  grapesEditor.DomComponents.addType("store-map", {
    model: {
      defaults: {
        "double-click": "open-map-config-modal",
        traits: [
          {
            type: "button",
            text: "⚙ Configure Map settings",
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
  
  // Load page HTML/CSS/JSON
  let editorProjectData = {};
  try {
    editorProjectData = typeof pageData.json === "string" ? JSON.parse(pageData.json) : (pageData.json || {});
  } catch {}

  if (editorProjectData.assets || editorProjectData.components) {
    grapesEditor.loadProjectData(editorProjectData);
  } else {
    grapesEditor.setComponents(pageData.html || "");
    grapesEditor.setStyle(pageData.css || "");
  }
  
  builderHasUnsavedChanges = false;
  grapesEditor.on("component:add component:remove component:update style:update", () => {
    builderHasUnsavedChanges = true;
  });
  
  // Add some basic custom block components for GrapesJS builder
  const bm = grapesEditor.BlockManager;
  
  bm.add("container-block", {
    label: "<div style='text-align:center;'><i class='fa-regular fa-square' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Container</div></div>",
    category: "Block Elements",
    content: `<div style="padding: 40px 20px; min-height: 150px; background-color: #f9fafb; border: 1px dashed #d1d5db; box-sizing: border-box; border-radius: 6px;"></div>`
  });

  bm.add("column-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-columns' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Column</div></div>",
    category: "Block Elements",
    content: `<div style="display: flex; gap: 20px; padding: 20px; box-sizing: border-box; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px; padding: 20px; border: 1px dashed #d1d5db; border-radius: 6px; min-height: 100px;">Column 1</div>
                <div style="flex: 1; min-width: 200px; padding: 20px; border: 1px dashed #d1d5db; border-radius: 6px; min-height: 100px;">Column 2</div>
              </div>`
  });

  bm.add("icon-block", {
    label: "<div style='text-align:center;'><i class='fa-regular fa-star' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Icon</div></div>",
    category: "Block Elements",
    content: `<span style="display: inline-block; text-align: center;"><i class="fa-solid fa-star" style="font-size: 32px; color: #3b82f6; padding: 10px;"></i></span>`
  });

  bm.add("title-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-heading' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Title</div></div>",
    category: "Block Elements",
    content: `<h2 style="font-size: 28px; font-weight: bold; margin-bottom: 12px; color: #111827; font-family: sans-serif;">Section Title</h2>`
  });

  bm.add("section-hero", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-rectangle-ad' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Hero Block</div></div>",
    category: "Block Elements",
    content: `<header style="padding: 80px 20px; text-align: center; background-color: #1e3a8a; color: white;">
                <h1 style="font-size: 40px; margin-bottom:12px;">Stunning Headline</h1>
                <p style="font-size: 16px; opacity: 0.8; margin-bottom:20px;">Provide some interesting subtitle describing your brand value proposition.</p>
                <a href="#" style="background:#ffffff; color:#1e3a8a; text-decoration:none; padding:10px 20px; border-radius:6px; font-weight:600;">Get Started</a>
              </header>`,
  });

  bm.add("text-block", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-align-left' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Paragraph</div></div>",
    category: "Block Elements",
    content: `<p style="padding: 10px 0; color: #4b5563; font-family: sans-serif; line-height: 1.6;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>`,
  });

  bm.add("feature-columns", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-list-check' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Features</div></div>",
    category: "Block Elements",
    content: `<div style="display: flex; gap: 20px; padding: 40px 20px; font-family: sans-serif; justify-content: space-around; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 250px; text-align: center; padding: 20px; border:1px solid #e5e7eb; border-radius:8px;">
                  <i class="fa-solid fa-bolt" style="font-size: 32px; color: #3b82f6; margin-bottom: 12px;"></i>
                  <h3 style="margin-bottom: 8px;">Fast Delivery</h3>
                  <p style="color: #6b7280; font-size:14px;">Instant checkout and immediate deployment pipelines.</p>
                </div>
                <div style="flex: 1; min-width: 250px; text-align: center; padding: 20px; border:1px solid #e5e7eb; border-radius:8px;">
                  <i class="fa-solid fa-shield-halved" style="font-size: 32px; color: #10b981; margin-bottom: 12px;"></i>
                  <h3 style="margin-bottom: 8px;">Secure Cloud</h3>
                  <p style="color: #6b7280; font-size:14px;">Enterprise-grade security caching layer for transactions.</p>
                </div>
              </div>`,
  });

  bm.add("image-placeholder", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-image' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Image</div></div>",
    category: "Block Elements",
    content: { type: "image", style: { width: "100%", "max-width": "500px", "min-height": "150px" } }
  });

  bm.add("store-map", {
    label: "<div style='text-align:center;'><i class='fa-solid fa-map-location-dot' style='font-size:20px;'></i><div style='font-size:10px; margin-top:4px;'>Store Map</div></div>",
    category: "Block Elements",
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
    const css = grapesEditor.getCss();
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
  const css = grapesEditor.getCss();
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
    let targetSiteId = siteId;
    let targetPagePath = pagePath;
    
    let res = await fetch(`${API_BASE}/api/pages/resolve?siteId=${targetSiteId}&pagePath=${targetPagePath}`);
    
    if (!res.ok && targetPagePath === "") {
      targetSiteId = "main";
      targetPagePath = siteId;
      res = await fetch(`${API_BASE}/api/pages/resolve?siteId=${targetSiteId}&pagePath=${targetPagePath}`);
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
    if (page.favicon) {
      let favLink = document.querySelector("link[rel*='icon']");
      if (!favLink) {
        favLink = document.createElement("link");
        favLink.rel = "icon";
        document.head.appendChild(favLink);
      }
      favLink.href = page.favicon;
    }
    
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

    // 3. Initialize dynamic features like the store stock locator map
    const mapDiv = document.getElementById("visitor-store-map");
    if (mapDiv) {
      initVisitorMap(targetSiteId, mapDiv, targetPagePath);
    }
    
  } catch (err) {
    renderErrorMessage("500 Server Error", "Could not connect to the database resolver.");
  }
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
          <div id="favicon-preview-container" style="width: 36px; height: 36px; border-radius: 50%; background-color: #fff; border: 1px solid var(--border-color); display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
            ${uploadedFaviconUrl ? `
              <img src="${uploadedFaviconUrl}" id="favicon-preview" style="width: 100%; height: 100%; object-fit: cover;" />
            ` : `
              <i class="fa-solid fa-image" style="color: var(--text-muted); font-size: 14px;"></i>
            `}
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
        previewContainer.innerHTML = `<i class="fa-solid fa-image" style="color: var(--text-muted); font-size: 14px;"></i>`;
        fileStatus.innerText = "No file chosen";
        removeBtn.remove();
        showToast("Favicon removed. Save changes to apply.");
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
        previewContainer.innerHTML = `<img src="${uploadedFaviconUrl}" id="favicon-preview" style="width: 100%; height: 100%; object-fit: cover;" />`;
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
          <select id="map-modal-brand-select" style="width:100%; border:1px solid var(--border-color); border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; outline:none; background:var(--bg-hover); color:var(--text-main); cursor:pointer;"></select>
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
          <div id="map-modal-products-list" style="border:1px solid var(--border-color); border-radius:8px; background:var(--bg-hover); color:var(--text-main); max-height:200px; overflow-y:auto; padding:10px; display:flex; flex-direction:column; gap:8px; box-sizing:border-box;">
            <!-- Checkboxes injected here -->
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; border-top:1px solid var(--border-color); padding-top:16px;">
          <button id="map-modal-cancel" style="padding:8px 16px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-hover); color:var(--text-muted); font-size:12px; font-weight:600; cursor:pointer;">Cancel</button>
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
        label.style.cssText = "display:flex; align-items:start; gap:8px; padding:6px; background:white; border:1px solid #f4f4f5; border-radius:6px; cursor:pointer; font-size:12px; text-align:left; box-sizing:border-box;";
        
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
      .visitor-map-retailer-tabs {
        scrollbar-width: none !important;
        -ms-overflow-style: none !important;
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
      const apiUrl = `${API_BASE}/api/public/map-config?siteId=${encodeURIComponent(siteId)}&pagePath=${encodeURIComponent(pagePath || "")}${rawAttr ? `&productSkus=${encodeURIComponent(rawAttr)}` : ''}`;
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
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        max-width: 92%;
        width: max-content;
        max-width: 92%;
        display: flex;
        gap: 6px;
        padding: 5px 8px;
        background: transparent;
        border: none;
        box-shadow: none;
        box-sizing: border-box;
        overflow-x: auto;
        white-space: nowrap;
        z-index: 1000;
        justify-content: center;
        align-items: center;
      `;
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

    const map = L.map(mapDiv).setView([centerLat, centerLng], zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20
    }).addTo(map);

    const markersGroup = L.layerGroup().addTo(map);

    // Responsive dynamic pin dimensions suitable for desktop and mobile
    const isMobile = window.innerWidth < 640;
    const pinSize = isMobile ? 32 : 40;
    const halfPin = pinSize / 2;

    const filterPins = () => {
      markersGroup.clearLayers();
      
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
            border-radius: 50%;
            background: ${hasLogo ? '#ffffff' : '#27272a'};
            border: 2px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.12);
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
          ">
            ${hasLogo ? `<img src="${logoUrl}" style="width: 100%; height: 100%; object-fit: contain; padding: 2px; box-sizing: border-box;" />` : `<i class="fa-solid fa-store" style="color: #ffffff; font-size: ${isMobile ? 13 : 16}px;"></i>`}
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
