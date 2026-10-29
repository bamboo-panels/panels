// Initialize Lucide Icons
lucide.createIcons();

// State Management
let specimenHistory = [];
let currentTestData = {
    name: "Bamboo Panel (1A)",
    frequencies: [250, 500, 1000, 2000, 3150, 4000, 5000],
    absorption: [0.12, 0.38, 0.72, 0.91, 0.85, 0.79, 0.72]
};

// Automatic Density Calculation Function
function calculateDensity() {
    const diameterMm = parseFloat(document.getElementById('tubeDiameter').value);
    const massGrams = parseFloat(document.getElementById('sampleMass').value) || 0;
    const thicknessMm = parseFloat(document.getElementById('sampleThickness').value) || 0;

    if (thicknessMm <= 0 || massGrams <= 0) return;

    // Convert to SI units
    const radiusM = (diameterMm / 2) / 1000;
    const thicknessM = thicknessMm / 1000;
    const massKg = massGrams / 1000;

    // Cylinder volume: V = π * r^2 * h
    const volumeM3 = Math.PI * Math.pow(radiusM, 2) * thicknessM;

    // Density: ρ = m / V
    const density = massKg / volumeM3;

    // Update material density field
    document.getElementById('materialDensity').value = Math.round(density);
}

// Chart Initialization
const ctx = document.getElementById('absorptionChart').getContext('2d');
const absorptionChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: currentTestData.frequencies,
        datasets: [{
            label: currentTestData.name,
            data: currentTestData.absorption,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointBackgroundColor: '#6366f1'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                title: { display: true, text: 'Frequency (Hz)', color: '#94a3b8' },
                grid: { color: '#1e293b' },
                ticks: { color: '#94a3b8' }
            },
            y: {
                title: { display: true, text: 'Absorption Coefficient (α)', color: '#94a3b8' },
                min: 0,
                max: 1,
                grid: { color: '#1e293b' },
                ticks: { color: '#94a3b8' }
            }
        },
        plugins: {
            legend: { labels: { color: '#f8fafc' } }
        }
    }
});

// Update Raw Data Table UI
function updateRawDataTable() {
    const tbody = document.getElementById('rawDataTable');
    tbody.innerHTML = '';
    for (let i = 0; i < currentTestData.frequencies.length; i++) {
        const row = document.createElement('tr');
        row.className = 'border-b border-slate-900 hover:bg-slate-900/50';
        row.innerHTML = `
            <td class="p-1">${currentTestData.frequencies[i]} Hz</td>
            <td class="p-1 font-semibold text-indigo-400">${currentTestData.absorption[i].toFixed(2)}</td>
        `;
        tbody.appendChild(row);
    }
}

// Run measurement simulation
function runTestSimulation() {
    const name = document.getElementById('specimenInput').value;
    const density = parseFloat(document.getElementById('materialDensity').value) || 100;
    
    currentTestData.name = name;
    currentTestData.absorption = currentTestData.frequencies.map(f => {
        let base = Math.min(0.95, (density / 150) * (1 - Math.abs(f - 2500) / 3000));
        return Math.max(0.1, parseFloat((base + (Math.random() * 0.1 - 0.05)).toFixed(2)));
    });

    absorptionChart.data.datasets[0].label = currentTestData.name;
    absorptionChart.data.datasets[0].data = currentTestData.absorption;
    absorptionChart.update();
    
    document.getElementById('currentActiveLabel').innerText = `Viewing: ${currentTestData.name}`;
    updateRawDataTable();
}

// Save current test to sidebar history
function saveCurrentTest() {
    const newRecord = {
        id: Date.now(),
        name: document.getElementById('specimenInput').value,
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        frequencies: [...currentTestData.frequencies],
        absorption: [...currentTestData.absorption]
    };
    specimenHistory.unshift(newRecord);
    renderHistorySidebar();
}

// Render Sidebar History List
function renderHistorySidebar() {
    const listEl = document.getElementById('historyList');
    document.getElementById('historyCount').innerText = `${specimenHistory.length} saved`;

    if (specimenHistory.length === 0) {
        listEl.innerHTML = `<p class="text-xs text-slate-500 text-center py-8">No saved specimens yet. Run a test and click "Save to History".</p>`;
        return;
    }

    listEl.innerHTML = '';
    specimenHistory.forEach(record => {
        const item = document.createElement('div');
        item.className = 'bg-slate-950 border border-slate-800 rounded-lg p-3 hover:border-indigo-500/50 transition flex flex-col gap-2';
        item.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-white truncate max-w-[150px]">${record.name}</span>
                <span class="text-[10px] text-slate-500">${record.date}</span>
            </div>
            <div class="flex items-center justify-between pt-1 border-t border-slate-900">
                <button onclick="loadRecord(${record.id})" class="text-xs text-indigo-400 hover:underline flex items-center gap-1">
                    <i data-lucide="eye" class="w-3 h-3"></i> Load
                </button>
                <button onclick="renameRecord(${record.id})" class="text-xs text-slate-400 hover:text-white flex items-center gap-1">
                    <i data-lucide="edit-2" class="w-3 h-3"></i> Rename
                </button>
                <button onclick="deleteRecord(${record.id})" class="text-xs text-rose-400 hover:underline flex items-center gap-1">
                    <i data-lucide="trash-2" class="w-3 h-3"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
    lucide.createIcons();
}

// Load specific specimen from history into active view
function loadRecord(id) {
    const record = specimenHistory.find(r => r.id === id);
    if (!record) return;

    currentTestData = {
        name: record.name,
        frequencies: [...record.frequencies],
        absorption: [...record.absorption]
    };

    document.getElementById('specimenInput').value = record.name;
    document.getElementById('currentActiveLabel').innerText = `Viewing: ${record.name}`;
    
    absorptionChart.data.datasets[0].label = record.name;
    absorptionChart.data.datasets[0].data = record.absorption;
    absorptionChart.update();
    updateRawDataTable();
}

// Rename specimen in history
function renameRecord(id) {
    const record = specimenHistory.find(r => r.id === id);
    if (!record) return;

    const newName = prompt("Enter new name for this specimen:", record.name);
    if (newName && newName.trim() !== "") {
        record.name = newName.trim();
        if (currentTestData.name === record.name) {
            document.getElementById('specimenInput').value = record.name;
        }
        renderHistorySidebar();
    }
}

// Delete record from history
function deleteRecord(id) {
    specimenHistory = specimenHistory.filter(r => r.id !== id);
    renderHistorySidebar();
}

// Export Raw Data as CSV
function exportCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Frequency (Hz),Absorption Coefficient (Alpha)\n";
    for (let i = 0; i < currentTestData.frequencies.length; i++) {
        csvContent += `${currentTestData.frequencies[i]},${currentTestData.absorption[i]}\n`;
    }
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `${currentTestData.name.replace(/\s+/g, '_')}_raw_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Initial setup
calculateDensity();
updateRawDataTable();
