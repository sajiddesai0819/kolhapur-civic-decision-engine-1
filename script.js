import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, onSnapshot, addDoc, updateDoc, increment, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- Configuration & Initialization ---
const firebaseConfig = (typeof __firebase_config !== 'undefined' && __firebase_config) ? JSON.parse(__firebase_config) : null;
let app = null;
let auth = null;
let db = null;
if (firebaseConfig) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} else {
    console.warn('No Firebase config provided — running without backend.');
}
const appId = typeof __app_id !== 'undefined' ? __app_id : 'kolhapur-civic-engine';

const TOTAL_WARD_BUDGET = 4.5; 
let user = null;
let proposals = [];
let votedIds = [];
let simChart = null;

// Load local proposals for offline/demo mode
if (!db) {
    try {
        const stored = localStorage.getItem('proposals');
        if (stored) proposals = JSON.parse(stored);
    } catch (e) { console.warn('Failed to parse local proposals', e); }
    try {
        const v = localStorage.getItem('votedIds');
        if (v) votedIds = JSON.parse(v);
    } catch (e) { console.warn('Failed to parse votedIds', e); }
}

const state = {
    currentRole: 'citizen',
    userName: '',
    userPhone: '',
    ward: '',
    budgetSim: { 'Roads': 40, 'Drainage': 20, 'Parks': 15, 'Lighting': 15, 'Safety': 10 }
};

const statusColors = {
    'Completed': 'bg-green-100 text-green-700',
    'Funded': 'bg-blue-100 text-blue-700',
    'Approved': 'bg-indigo-100 text-indigo-700',
    'Pending': 'bg-gray-100 text-gray-600'
};

// --- Splash Transition ---
function hideSplash() {
    const splash = document.getElementById('splash-screen');
    const login = document.getElementById('login-screen');
    if (!splash) return;
    splash.style.opacity = '0';
    setTimeout(() => {
        splash.classList.add('hidden');
        login.classList.remove('hidden');
    }, 500);
}
setTimeout(hideSplash, 2000);

// --- AUTHENTICATION ---
async function initAuth() {
    if (!auth) return;
    try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(auth, __initial_auth_token);
        } else {
            await signInAnonymously(auth);
        }
    } catch (err) {
        console.warn("Auth failed, retrying anonymous...", err);
        try { await signInAnonymously(auth); } catch (e) {
            const loginBtn = document.getElementById('login-btn');
            if (loginBtn) loginBtn.textContent = "Connection Error. Refresh.";
        }
    }
}

if (auth) {
    onAuthStateChanged(auth, (u) => {
        if (u) {
            user = u;
            const loginBtn = document.getElementById('login-btn');
            if (loginBtn) {
                loginBtn.textContent = "Join Decision Engine";
                loginBtn.disabled = false;
            }
            
            // Real-time Proposals Listener
            const q = query(collection(db, 'artifacts', appId, 'public', 'data', 'proposals'));
            onSnapshot(q, (snapshot) => {
                proposals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                refreshUI();
            });

            // Real-time Votes Listener
            const votesDoc = doc(db, 'artifacts', appId, 'users', user.uid, 'votes', 'my_votes');
            onSnapshot(votesDoc, (docSnap) => {
                if (docSnap.exists()) votedIds = docSnap.data().ids || [];
                refreshUI();
            });
        }
    });
} else {
    // No auth/db available — enable login button for offline/demo usage
    window.addEventListener('DOMContentLoaded', () => {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) { loginBtn.textContent = "Join Decision Engine"; loginBtn.disabled = false; }
    });
}

// --- UI CORE LOGIC ---
function refreshUI() {
    renderDashboard();
    renderProposals();
    renderAdmin();
    renderResults();
}

function parseCostToCrores(costStr) {
    if (!costStr) return 0;
    const numeric = parseFloat(costStr.replace(/[^\d.]/g, ''));
    if (isNaN(numeric)) return 0;
    if (costStr.toUpperCase().includes('L')) return numeric / 100;
    return numeric;
}

function renderDashboard() {
    let spent = 0;
    let activeCount = 0;
    proposals.forEach(p => {
        if (p.status === 'Funded' || p.status === 'Completed') spent += parseCostToCrores(p.cost);
        if (p.status !== 'Pending') activeCount++;
    });

    const remaining = TOTAL_WARD_BUDGET - spent;
    const utilizationPercent = Math.min((spent / TOTAL_WARD_BUDGET) * 100, 100);

    document.getElementById('dash-total-budget').textContent = `₹ ${TOTAL_WARD_BUDGET.toFixed(2)} Cr`;
    document.getElementById('dash-remaining-budget').textContent = `₹ ${Math.max(0, remaining).toFixed(2)} Cr`;
    document.getElementById('dash-utilization-text').textContent = `${utilizationPercent.toFixed(1)}% Used`;
    document.getElementById('dash-utilization-bar').style.width = `${utilizationPercent}%`;
    document.getElementById('dash-active-count').textContent = activeCount;

    const list = document.getElementById('dashboard-trending-list');
    list.innerHTML = proposals.length === 0 ? '<p class="text-sm text-gray-400 text-center py-8">📋 No active proposals yet</p>' : '';
    
    [...proposals].sort((a,b) => (b.votes || 0) - (a.votes || 0)).slice(0, 3).forEach(p => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between bg-white p-4 rounded-2xl border-2 border-gray-100 shadow-md hover:shadow-lg transition-all";
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-2 h-10 bg-gradient-to-b from-indigo-600 to-blue-600 rounded-full"></div>
                <div class="flex-1">
                    <p class="text-sm font-bold text-gray-900">${p.title}</p>
                    <p class="text-xs text-gray-500 mt-1">
                        <span class="font-semibold text-indigo-600">${p.votes || 0}</span> supports · 
                        <span class="font-medium">${p.category}</span>
                    </p>
                </div>
            </div>
            <span class="text-[10px] font-bold px-3 py-1 rounded-full ${statusColors[p.status] || statusColors.Pending}">${p.status || 'Pending'}</span>
        `;
        list.appendChild(div);
    });
}

function renderProposals() {
    const container = document.getElementById('proposals-list');
    container.innerHTML = proposals.length === 0 ? '<div class="text-center py-10 opacity-50"><p>No proposals yet. Share your first idea!</p></div>' : '';
    proposals.forEach(p => {
        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl p-5 border-2 border-gray-100 shadow-md hover:shadow-lg transition-all proposal-card";
        const isVoted = votedIds.includes(p.id);
        const categoryEmoji = { 'Roads': '🛣️', 'Drainage': '💧', 'Parks': '🌳', 'Lighting': '💡', 'Safety': '🛡️' };
        card.innerHTML = `
            <div class="flex justify-between items-start mb-3">
                <span class="text-xs font-bold uppercase bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full">${categoryEmoji[p.category] || '📋'} ${p.category}</span>
                <span class="text-[10px] font-bold px-3 py-1 rounded-full ${statusColors[p.status] || statusColors.Pending}">${p.status || 'Pending'}</span>
            </div>
            <h3 class="font-bold text-gray-900 mb-2 text-base">${p.title}</h3>
            <p class="text-sm text-gray-600 mb-3 line-clamp-2">${p.desc}</p>
            <p class="text-xs font-semibold text-gray-700 mb-4 bg-gray-50 inline-block px-3 py-1 rounded-lg">💰 ${p.cost}</p>
            <div class="flex items-center justify-between pt-4 border-t border-gray-100">
                <div class="flex items-center gap-1">
                    <svg class="w-4 h-4 text-indigo-600" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path></svg>
                    <span class="text-sm font-bold text-indigo-600">${p.votes || 0}</span>
                </div>
                <button id="vote-btn-${p.id}" class="${isVoted ? 'bg-gray-200 text-gray-600' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'} text-xs font-bold px-6 py-2 rounded-lg transition-all hover:shadow-lg transform hover:scale-105">
                    ${isVoted ? '✓ Supported' : '👍 Support'}
                </button>
            </div>
        `;
        container.appendChild(card);
        document.getElementById(`vote-btn-${p.id}`).onclick = () => window.voteProposal(p.id);
    });
}

function renderAdmin() {
    const container = document.getElementById('admin-pending-list');
    container.innerHTML = proposals.length === 0 ? '<p class="text-sm text-center text-gray-400 py-4">No active proposals in the system.</p>' : '';
    proposals.forEach(p => {
        const div = document.createElement('div');
        div.className = "bg-white p-4 rounded-xl border space-y-3 shadow-sm";
        div.innerHTML = `
            <div class="flex justify-between items-center">
                <div class="flex-1">
                    <h5 class="text-sm font-bold">${p.title}</h5>
                    <p class="text-[10px] text-gray-400">Current Status: <span class="text-blue-600 font-bold uppercase">${p.status}</span> | Cost: ${p.cost}</p>
                </div>
            </div>
            <div class="flex gap-2">
                <button id="adm-app-${p.id}" class="flex-1 py-2 text-[9px] font-bold bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">APPROVE</button>
                <button id="adm-fun-${p.id}" class="flex-1 py-2 text-[9px] font-bold bg-emerald-50 text-emerald-700 rounded-lg border border-emerald-100">FUND</button>
                <button id="adm-com-${p.id}" class="flex-1 py-2 text-[9px] font-bold bg-green-50 text-green-700 rounded-lg border border-green-100">DONE</button>
            </div>
        `;
        container.appendChild(div);
        document.getElementById(`adm-app-${p.id}`).onclick = () => window.updateStatus(p.id, 'Approved');
        document.getElementById(`adm-fun-${p.id}`).onclick = () => window.updateStatus(p.id, 'Funded');
        document.getElementById(`adm-com-${p.id}`).onclick = () => window.updateStatus(p.id, 'Completed');
    });
}

function renderResults() {
    const container = document.getElementById('results-status-list');
    container.innerHTML = proposals.length === 0 ? '<p class="text-sm text-center text-gray-400 py-4">No tracking data available yet.</p>' : '';
    proposals.forEach(p => {
        const div = document.createElement('div');
        div.className = "flex items-start gap-3 border-b pb-3 last:border-0";
        div.innerHTML = `
            <div class="w-3 h-3 rounded-full mt-1 ${p.status === 'Completed' ? 'bg-green-500' : 'bg-blue-400'}"></div>
            <div class="flex-1">
                <div class="flex justify-between items-center">
                    <h5 class="text-sm font-bold text-gray-800">${p.title}</h5>
                    <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColors[p.status]}">${p.status}</span>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

// --- GLOBAL ACTIONS (Exposed to window for HTML access) ---
window.handleLogin = () => {
    const name = document.getElementById('login-name').value.trim();
    const phone = document.getElementById('login-phone').value.trim();
    if(!name) return window.showToast("Please enter your name");
    if(!phone) return window.showToast("Please enter your phone number");
    
    state.userName = name;
    state.userPhone = phone;
    state.ward = document.getElementById('login-ward').value;
    
    document.getElementById('header-greeting').textContent = `Hello, ${state.userName.split(' ')[0]}`;
    document.getElementById('header-ward').textContent = state.ward.split(' - ')[0];
    document.getElementById('header-ward-location').textContent = state.ward;
    document.getElementById('header-phone').textContent = phone;
    document.getElementById('header-role').textContent = state.currentRole === 'admin' ? 'Admin' : 'Citizen';
    document.getElementById('header-role').className = state.currentRole === 'admin' 
        ? 'px-3 py-1 bg-amber-500/30 text-amber-100 text-[10px] font-bold rounded-full uppercase' 
        : 'px-3 py-1 bg-green-500/30 text-green-100 text-[10px] font-bold rounded-full uppercase';
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    initSimulator();
    // If no authenticated user (offline/demo), create a local demo user so actions work
    if (!user) {
        user = { uid: 'demo-' + Date.now(), isDemo: true };
        // ensure votedIds/proposals are in sync from localStorage
        try { votedIds = JSON.parse(localStorage.getItem('votedIds') || '[]'); } catch(e) { votedIds = []; }
        try { proposals = JSON.parse(localStorage.getItem('proposals') || '[]'); } catch(e) { /* ignore */ }
        refreshUI();
    }
};


window.submitProposal = async () => {
    // allow offline/demo submission even without Firebase auth/db
    if (!user && !db) {
        // create a temporary demo user
        user = { uid: 'demo-' + Date.now(), isDemo: true };
    }
    const title = document.getElementById('prop-title').value.trim();
    if(!title) return window.showToast("Title required");
    
    const proposalObj = {
        id: 'local-' + Date.now(),
        title,
        category: document.getElementById('prop-category').value,
        desc: document.getElementById('prop-desc').value,
        cost: document.getElementById('prop-est-cost').textContent,
        votes: 0,
        status: 'Pending',
        author: state.userName || 'Anonymous',
        createdAt: Date.now()
    };
    if (db && user) {
        try {
            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'proposals'), proposalObj);
            window.closeProposalModal();
            window.showToast("Proposal synchronized!");
        } catch (err) {
            window.showToast("Submission failed.");
        }
    } else {
        // Offline/local mode: store locally and refresh UI
        proposals.push(proposalObj);
        try { localStorage.setItem('proposals', JSON.stringify(proposals)); } catch (e) { console.warn(e); }
        window.closeProposalModal();
        window.showToast("Proposal saved locally");
        refreshUI();
    }
};

window.voteProposal = async (id) => {
    if (votedIds.includes(id)) return;
    if (!user && !db) {
        user = { uid: 'demo-' + Date.now(), isDemo: true };
    }
    if (db && user) {
        try {
            const proposalRef = doc(db, 'artifacts', appId, 'public', 'data', 'proposals', id);
            const votesRef = doc(db, 'artifacts', appId, 'users', user.uid, 'votes', 'my_votes');
            const newVotes = [...votedIds, id];
            await setDoc(votesRef, { ids: newVotes });
            await updateDoc(proposalRef, { votes: increment(1) });
            window.showToast("Support recorded.");
        } catch (err) {
            window.showToast("Vote failed.");
        }
    } else {
        // Offline: update local proposals and votedIds
        votedIds.push(id);
        try { localStorage.setItem('votedIds', JSON.stringify(votedIds)); } catch (e) { console.warn(e); }
        const p = proposals.find(x => x.id === id);
        if (p) { p.votes = (p.votes || 0) + 1; try { localStorage.setItem('proposals', JSON.stringify(proposals)); } catch (e) {} }
        refreshUI();
        window.showToast('Support recorded (offline)');
    }
};

window.updateStatus = async (id, newStatus) => {
    if (!user && !db) {
        user = { uid: 'demo-' + Date.now(), isDemo: true };
    }
    if (db && user) {
        try {
            const proposalRef = doc(db, 'artifacts', appId, 'public', 'data', 'proposals', id);
            await updateDoc(proposalRef, { status: newStatus });
            window.showToast(`Project status: ${newStatus}`);
        } catch (err) {
            window.showToast("Status update failed.");
        }
    } else {
        const p = proposals.find(x => x.id === id);
        if (p) {
            p.status = newStatus;
            try { localStorage.setItem('proposals', JSON.stringify(proposals)); } catch (e) { console.warn(e); }
            refreshUI();
            window.showToast(`Project status: ${newStatus} (local)`);
        }
    }
};

window.logout = () => {
    document.getElementById('app-content').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-name').value = '';
    window.showToast("Session ended.");
};

window.setRole = (role) => {
    state.currentRole = role;
    document.getElementById('role-citizen').className = role === 'citizen' ? "py-3 px-4 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-700 font-semibold" : "py-3 px-4 rounded-xl border-2 border-gray-200 text-gray-500 font-semibold";
    document.getElementById('role-admin').className = role === 'admin' ? "py-3 px-4 rounded-xl border-2 border-blue-600 bg-blue-50 text-blue-700 font-semibold" : "py-3 px-4 rounded-xl border-2 border-gray-200 text-gray-500 font-semibold";
    document.getElementById('nav-admin').classList.toggle('hidden', role !== 'admin');
    // Update header role badge if already logged in
    const headerRole = document.getElementById('header-role');
    if (headerRole) {
        headerRole.textContent = role === 'admin' ? 'Admin' : 'Citizen';
        headerRole.className = role === 'admin' 
            ? 'px-3 py-1 bg-amber-500/30 text-amber-100 text-[10px] font-bold rounded-full uppercase' 
            : 'px-3 py-1 bg-green-500/30 text-green-100 text-[10px] font-bold rounded-full uppercase';
    }
};

window.switchView = (viewId) => {
    document.querySelectorAll('nav button').forEach(btn => btn.classList.remove('active-nav'));
    document.getElementById(`nav-${viewId}`).classList.add('active-nav');
    document.querySelectorAll('main section').forEach(sec => sec.classList.add('hidden'));
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    if (viewId === 'simulator') setTimeout(updateSimChart, 50);
};

window.showToast = (msg) => {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.replace('opacity-0', 'opacity-100');
    setTimeout(() => toast.classList.replace('opacity-100', 'opacity-0'), 3000);
};

window.openProposalModal = () => document.getElementById('proposal-modal').classList.remove('hidden');
window.closeProposalModal = () => document.getElementById('proposal-modal').classList.add('hidden');
window.autoGenerateEstimate = () => {
    const costs = { 'Roads': '45 L', 'Drainage': '15 L', 'Parks': '22 L', 'Lighting': '6.5 L', 'Safety': '12 L' };
    document.getElementById('prop-est-cost').textContent = `₹ ${costs[document.getElementById('prop-category').value]}`;
};

function initSimulator() {
    const container = document.getElementById('simulator-controls');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(state.budgetSim).forEach(key => {
        const div = document.createElement('div');
        div.innerHTML = `<div class="flex justify-between mb-1"><label class="text-xs font-bold">${key}</label><span class="text-xs font-bold text-blue-600" id="val-${key}">${state.budgetSim[key]}%</span></div>
                         <input type="range" min="0" max="100" value="${state.budgetSim[key]}" oninput="window.updateAllocation('${key}', this.value)">`;
        container.appendChild(div);
    });
    const ctx = document.getElementById('simulatorChart').getContext('2d');
    simChart = new Chart(ctx, { type: 'doughnut', data: { labels: Object.keys(state.budgetSim), datasets: [{ data: Object.values(state.budgetSim), backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'], borderWidth: 0 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 9 } } } } } });
}

window.updateAllocation = (key, val) => {
    state.budgetSim[key] = parseInt(val);
    const el = document.getElementById(`val-${key}`);
    if (el) el.textContent = val + '%';
    if (simChart) { 
        simChart.data.datasets[0].data = Object.values(state.budgetSim); 
        simChart.update('none'); 
    }
};

function updateSimChart() { if (simChart) simChart.update(); }

initAuth();