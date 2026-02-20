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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'kcde-kolhapur';

const TOTAL_WARD_BUDGET = 4.5; // ₹ 4.5 Crore per ward for FY26-27
let user = null;
let proposals = [];
let votedIds = [];
let simChart = null;
let userIdentifier = ''; // Track user by name + ward to allow voting with different usernames
let currentWard = ''; // Track current ward for budget calculations

// Ward-specific proposal storage - store per ward in localStorage
function getWardProposals(ward) {
    try {
        const stored = localStorage.getItem(`proposals-${ward}`);
        if (stored) return JSON.parse(stored);
    } catch (e) { console.warn('Failed to parse ward proposals', e); }
    // Initialize with dummy proposals for new wards
    return JSON.parse(JSON.stringify(dummyProposals));
}

function saveWardProposals(ward, proposals) {
    try {
        localStorage.setItem(`proposals-${ward}`, JSON.stringify(proposals));
    } catch (e) { console.warn('Failed to save ward proposals', e); }
}

// Load local proposals for offline/demo mode
if (!db) {
    try {
        const v = localStorage.getItem('userVotedIds');
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

// Dummy proposals with votes
const dummyProposals = [
    {
        id: 'dummy-1',
        title: 'Repair Main Street Potholes',
        category: 'Roads',
        desc: 'Fix dangerous potholes on Main Street causing accidents and damage to vehicles.',
        cost: '₹ 45 L',
        votes: 234,
        status: 'Approved',
        author: 'Rajvardhan Patil',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000
    },
    {
        id: 'dummy-2',
        title: 'New Community Park in Shahupuri',
        category: 'Parks',
        desc: 'Create a green space for children and families with playground equipment and benches.',
        cost: '₹ 22 L',
        votes: 189,
        status: 'Funded',
        author: 'Meera Sharma',
        createdAt: Date.now() - 25 * 24 * 60 * 60 * 1000
    },
    {
        id: 'dummy-3',
        title: 'Smart Street Lighting System',
        category: 'Lighting',
        desc: 'Install LED lights with motion sensors to save electricity and improve night safety.',
        cost: '₹ 6.5 L',
        votes: 156,
        status: 'Pending',
        author: 'Vikram Desai',
        createdAt: Date.now() - 20 * 24 * 60 * 60 * 1000
    },
    {
        id: 'dummy-4',
        title: 'Drainage System Overhaul in Rajarampuri',
        category: 'Drainage',
        desc: 'Upgrade outdated sewer lines causing waterlogging during monsoon season.',
        cost: '₹ 15 L',
        votes: 142,
        status: 'Approved',
        author: 'Anjali Ghate',
        createdAt: Date.now() - 15 * 24 * 60 * 60 * 1000
    },
    {
        id: 'dummy-5',
        title: 'Women Safety Patrol Initiative',
        category: 'Safety',
        desc: 'Increase police presence in market areas especially during evening hours.',
        cost: '₹ 12 L',
        votes: 178,
        status: 'Pending',
        author: 'Priya Kulkarni',
        createdAt: Date.now() - 10 * 24 * 60 * 60 * 1000
    }
];

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
        // Load localStorage votes for offline mode
        try { votedIds = JSON.parse(localStorage.getItem('userVotedIds') || '[]'); } catch(e) { votedIds = []; }
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
    
    const categoryEmoji = { 'Roads': '🛣️', 'Drainage': '💧', 'Parks': '🌳', 'Lighting': '💡', 'Safety': '🛡️' };
    const categoryColors = {
        'Roads': 'from-orange-100 to-orange-50 border-orange-200 text-orange-700',
        'Drainage': 'from-blue-100 to-blue-50 border-blue-200 text-blue-700',
        'Parks': 'from-green-100 to-green-50 border-green-200 text-green-700',
        'Lighting': 'from-yellow-100 to-yellow-50 border-yellow-200 text-yellow-700',
        'Safety': 'from-red-100 to-red-50 border-red-200 text-red-700'
    };
    
    proposals.forEach(p => {
        const card = document.createElement('div');
        card.className = "bg-white rounded-2xl border-2 border-gray-200 shadow-md hover:shadow-xl transition-all proposal-card overflow-hidden";
        const isVoted = votedIds.includes(p.id);
        const colors = categoryColors[p.category] || 'from-gray-100 to-gray-50 border-gray-200 text-gray-700';
        
        // Vote strength indicator
        let voteStrength = 'bg-gray-100';
        let voteText = 'No Support';
        if ((p.votes || 0) > 150) { voteStrength = 'bg-gradient-to-r from-green-400 to-emerald-400'; voteText = 'High Support'; }
        else if ((p.votes || 0) > 100) { voteStrength = 'bg-gradient-to-r from-blue-400 to-indigo-400'; voteText = 'Good Support'; }
        else if ((p.votes || 0) > 50) { voteStrength = 'bg-gradient-to-r from-yellow-400 to-amber-400'; voteText = 'Growing'; }
        
        card.innerHTML = `
            <div class="bg-gradient-to-r ${colors} p-4 border-b-2 ${colors.split(' ')[colors.split(' ').length - 1]}">
                <div class="flex justify-between items-start">
                    <span class="text-2xl">${categoryEmoji[p.category] || '📋'}</span>
                    <span class="text-[10px] font-bold px-2.5 py-1 rounded-full ${statusColors[p.status] || statusColors.Pending}">${p.status || 'Pending'}</span>
                </div>
            </div>
            <div class="p-4">
                <h3 class="font-bold text-gray-900 mb-1 text-sm line-clamp-2">${p.title}</h3>
                <p class="text-xs text-gray-600 mb-3 line-clamp-2">${p.desc}</p>
                
                <div class="flex items-center gap-2 mb-4 text-xs">
                    <span class="inline-block px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold rounded-lg">📊 ${p.category}</span>
                    <span class="inline-block px-2.5 py-1 bg-gray-100 border border-gray-300 text-gray-700 font-semibold rounded-lg">💰 ${p.cost}</span>
                </div>
                
                <div class="mb-4">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-xs font-bold text-gray-700">Community Support</span>
                        <span class="text-xs font-bold ${voteStrength.includes('green') ? 'text-green-600' : voteStrength.includes('blue') ? 'text-blue-600' : voteStrength.includes('yellow') ? 'text-amber-600' : 'text-gray-600'}">${voteText}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                        <div class="${voteStrength} h-2 rounded-full transition-all" style="width: ${Math.min((p.votes || 0) / 2.5, 100)}%"></div>
                    </div>
                    <p class="text-xs text-gray-500 mt-2 font-semibold">${p.votes || 0} people support this idea</p>
                </div>
                
                <button id="vote-btn-${p.id}" class="${isVoted ? 'bg-gray-100 text-gray-600 border border-gray-300' : 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white'} w-full text-xs font-bold py-3 rounded-lg transition-all hover:shadow-lg transform hover:scale-105">
                    ${isVoted ? '✓ Supported by You' : '👍 Show Support'}
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
    
    // Calculate metrics
    let totalProposals = proposals.length;
    let pendingCount = proposals.filter(p => p.status === 'Pending').length;
    let completedCount = proposals.filter(p => p.status === 'Completed').length;
    let totalVotes = proposals.reduce((sum, p) => sum + (p.votes || 0), 0);
    
    // Update metrics
    document.getElementById('admin-total').textContent = totalProposals;
    document.getElementById('admin-pending').textContent = pendingCount;
    document.getElementById('admin-completed').textContent = completedCount;
    document.getElementById('admin-total-votes').textContent = totalVotes;
    
    // Sort proposals by votes (highest first)
    [...proposals].sort((a,b) => (b.votes || 0) - (a.votes || 0)).forEach((p, index) => {
        const div = document.createElement('div');
        const votePercentage = totalVotes > 0 ? ((p.votes || 0) / totalVotes * 100).toFixed(1) : 0;
        
        // Status color styling
        let statusBg = 'from-gray-100 to-gray-50 border-gray-200';
        let statusText = 'text-gray-700';
        if (p.status === 'Pending') { statusBg = 'from-amber-100 to-amber-50 border-amber-200'; statusText = 'text-amber-700'; }
        else if (p.status === 'Approved') { statusBg = 'from-indigo-100 to-indigo-50 border-indigo-200'; statusText = 'text-indigo-700'; }
        else if (p.status === 'Funded') { statusBg = 'from-blue-100 to-blue-50 border-blue-200'; statusText = 'text-blue-700'; }
        else if (p.status === 'Completed') { statusBg = 'from-green-100 to-green-50 border-green-200'; statusText = 'text-green-700'; }
        
        div.className = "bg-white rounded-2xl border-2 border-gray-200 shadow-md hover:shadow-lg transition-all p-4";
        div.innerHTML = `
            <div class="flex items-start justify-between mb-3">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="text-lg font-bold text-gray-400">#${index + 1}</span>
                        <h5 class="text-sm font-bold text-gray-900 flex-1 line-clamp-1">${p.title}</h5>
                    </div>
                    <p class="text-xs text-gray-500 mb-2 line-clamp-1">Category: <span class="font-semibold">${p.category}</span> | Cost: <span class="font-semibold">${p.cost}</span></p>
                </div>
                <span class="text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap ${statusColors[p.status] || statusColors.Pending}">${p.status || 'Pending'}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-2 mb-4">
                <div class="bg-gradient-to-br from-indigo-50 to-indigo-100 rounded-lg p-3 border border-indigo-200">
                    <p class="text-[9px] text-indigo-600 font-bold uppercase">Support</p>
                    <p class="text-lg font-bold text-indigo-700">👍 ${p.votes || 0}</p>
                    <p class="text-[8px] text-indigo-600 mt-1">${votePercentage}% of total</p>
                </div>
                <div class="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-3 border border-purple-200">
                    <p class="text-[9px] text-purple-600 font-bold uppercase">Status</p>
                    <p class="text-sm font-bold text-purple-700">${p.status}</p>
                    <p class="text-[8px] text-purple-600 mt-1">Ready to Action</p>
                </div>
            </div>
            
            <div class="flex gap-2 mb-3">
                ${p.status !== 'Completed' ? `<button id="adm-app-${p.id}" class="flex-1 py-2.5 text-[9px] font-bold bg-gradient-to-r from-indigo-500 to-indigo-600 text-white rounded-lg hover:from-indigo-600 hover:to-indigo-700 transition transform hover:scale-105 shadow-sm">✓ APPROVE</button>` : ''}
                ${['Pending', 'Approved'].includes(p.status) ? `<button id="adm-fun-${p.id}" class="flex-1 py-2.5 text-[9px] font-bold bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg hover:from-emerald-600 hover:to-emerald-700 transition transform hover:scale-105 shadow-sm">💰 FUND</button>` : ''}
                ${p.status !== 'Pending' ? `<button id="adm-com-${p.id}" class="flex-1 py-2.5 text-[9px] font-bold bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition transform hover:scale-105 shadow-sm">✅ COMPLETE</button>` : ''}
            </div>
            
            <div class="bg-gray-50 rounded-lg p-2 border border-gray-200">
                <p class="text-[8px] text-gray-600">By <span class="font-semibold">${p.author || 'Community'}</span> • ${new Date(p.createdAt).toLocaleDateString()}</p>
            </div>
        `;
        container.appendChild(div);
        
        if (p.status !== 'Completed' && document.getElementById(`adm-app-${p.id}`)) {
            document.getElementById(`adm-app-${p.id}`).onclick = () => window.updateStatus(p.id, 'Approved');
        }
        if (['Pending', 'Approved'].includes(p.status) && document.getElementById(`adm-fun-${p.id}`)) {
            document.getElementById(`adm-fun-${p.id}`).onclick = () => window.updateStatus(p.id, 'Funded');
        }
        if (p.status !== 'Pending' && document.getElementById(`adm-com-${p.id}`)) {
            document.getElementById(`adm-com-${p.id}`).onclick = () => window.updateStatus(p.id, 'Completed');
        }
    });
}

function renderResults() {
    const container = document.getElementById('results-status-list');
    container.innerHTML = proposals.length === 0 ? '<p class="text-sm text-center text-gray-400 py-4">No tracking data available yet.</p>' : '';
    
    // Calculate statistics
    const totalProposals = proposals.length;
    const completedProposals = proposals.filter(p => p.status === 'Completed').length;
    const progressProposals = proposals.filter(p => p.status === 'Funded' || p.status === 'Approved').length;
    
    // Update stats
    document.getElementById('total-proposals').textContent = totalProposals;
    document.getElementById('completed-count').textContent = completedProposals;
    document.getElementById('progress-count').textContent = progressProposals;
    
    // Sort by status priority: Completed, Funded, Approved, Pending
    const statusOrder = { 'Completed': 0, 'Funded': 1, 'Approved': 2, 'Pending': 3 };
    [...proposals].sort((a, b) => (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99)).forEach((p, index) => {
        const div = document.createElement('div');
        div.className = "flex items-start gap-4 pb-4 border-b border-gray-200 last:border-0";
        
        // Status icon and color
        let statusIcon = '⏳';
        let statusColor = 'text-gray-400 bg-gray-100';
        let progressPercent = 33;
        
        if (p.status === 'Completed') {
            statusIcon = '✅';
            statusColor = 'text-green-600 bg-green-100';
            progressPercent = 100;
        } else if (p.status === 'Funded') {
            statusIcon = '💰';
            statusColor = 'text-blue-600 bg-blue-100';
            progressPercent = 75;
        } else if (p.status === 'Approved') {
            statusIcon = '✓';
            statusColor = 'text-indigo-600 bg-indigo-100';
            progressPercent = 50;
        }
        
        div.innerHTML = `
            <div class="flex-shrink-0 w-12 h-12 rounded-full ${statusColor} flex items-center justify-center text-lg font-bold mt-1">
                ${statusIcon}
            </div>
            <div class="flex-1 min-w-0 pt-1">
                <div class="flex justify-between items-start gap-2 mb-2">
                    <div class="min-w-0 flex-1">
                        <h5 class="text-sm font-bold text-gray-800 line-clamp-2">${p.title}</h5>
                        <p class="text-xs text-gray-500 mt-0.5">${p.category} • ${p.cost}</p>
                    </div>
                    <span class="text-[9px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${statusColors[p.status]}">${p.status}</span>
                </div>
                
                <div class="mb-2">
                    <div class="flex justify-between items-center mb-1">
                        <p class="text-[11px] font-bold text-gray-600">Progress</p>
                        <p class="text-[9px] text-gray-500">${progressPercent}%</p>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2">
                        <div class="h-2 rounded-full transition-all ${
                            p.status === 'Completed' ? 'bg-green-500' :
                            p.status === 'Funded' ? 'bg-blue-500' :
                            p.status === 'Approved' ? 'bg-indigo-500' :
                            'bg-gray-400'
                        }" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
                
                <div class="flex gap-2 text-[10px]">
                    <span class="px-2 py-1 bg-indigo-50 text-indigo-700 rounded font-bold">👍 ${p.votes || 0} Support</span>
                    <span class="px-2 py-1 bg-gray-100 text-gray-700 rounded font-bold">👤 ${p.author || 'Community'}</span>
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
    currentWard = state.ward; // Set current ward for budget calculations
    
    // Clear previous ward data completely
    proposals = [];
    votedIds = [];
    
    // Load ward-specific proposals - completely isolated per ward
    proposals = getWardProposals(state.ward);
    
    // Create userIdentifier based on name and ward to allow voting with different usernames
    userIdentifier = `${name}|${state.ward}`;
    
    // Load user-specific votes from localStorage - ward-isolated
    try {
        const userVotes = localStorage.getItem(`votes-${userIdentifier}`);
        votedIds = userVotes ? JSON.parse(userVotes) : [];
    } catch(e) {
        votedIds = [];
    }
    
    document.getElementById('header-greeting').textContent = `Hello, ${state.userName.split(' ')[0]}`;
    document.getElementById('header-ward').textContent = state.ward.split(' - ')[0];
    document.getElementById('header-ward-location').textContent = state.ward;
    document.getElementById('header-phone').textContent = phone;
    document.getElementById('header-role').textContent = state.currentRole === 'admin' ? 'Admin' : 'Citizen';
    document.getElementById('header-role').className = state.currentRole === 'admin' 
        ? 'px-4 py-2 bg-gradient-to-r from-amber-400 to-orange-400 text-amber-900 text-[10px] font-bold rounded-full shadow-md uppercase tracking-wider' 
        : 'px-4 py-2 bg-gradient-to-r from-green-400 to-emerald-400 text-green-900 text-[10px] font-bold rounded-full shadow-md uppercase';
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-content').classList.remove('hidden');
    initSimulator();
    // If no authenticated user (offline/demo), create a local demo user so actions work
    if (!user) {
        user = { uid: 'demo-' + Date.now(), isDemo: true };
        // ensure votedIds/proposals are in sync from localStorage
        try { votedIds = JSON.parse(localStorage.getItem(`votes-${userIdentifier}`) || '[]'); } catch(e) { votedIds = []; }
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
        try { saveWardProposals(currentWard, proposals); } catch (e) { console.warn(e); }
        window.closeProposalModal();
        window.showToast("Proposal saved locally");
        refreshUI();
    }
};

window.voteProposal = async (id) => {
    if (votedIds.includes(id)) return window.showToast("You've already supported this proposal");
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
            votedIds = newVotes;
            window.showToast("Support recorded.");
        } catch (err) {
            window.showToast("Vote failed.");
        }
    } else {
        // Offline: update local proposals and votedIds based on userIdentifier
        votedIds.push(id);
        try { localStorage.setItem(`votes-${userIdentifier}`, JSON.stringify(votedIds)); } catch (e) { console.warn(e); }
        const p = proposals.find(x => x.id === id);
        if (p) { p.votes = (p.votes || 0) + 1; try { saveWardProposals(currentWard, proposals); } catch (e) {} }
        refreshUI();
        window.showToast('Support recorded!');
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
            try { saveWardProposals(currentWard, proposals); } catch (e) { console.warn(e); }
            refreshUI();
            window.showToast(`Project status: ${newStatus} (local)`);
        }
    }
};

window.logout = () => {
    // Clear all ward/user-specific data
    proposals = [];
    votedIds = [];
    userIdentifier = '';
    currentWard = '';
    state.userName = '';
    state.userPhone = '';
    state.ward = '';
    state.currentRole = 'citizen';
    
    document.getElementById('app-content').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-name').value = '';
    document.getElementById('login-phone').value = '';
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
