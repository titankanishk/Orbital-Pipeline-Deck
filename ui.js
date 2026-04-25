const engine = new PipelineEngine();

const runBtn = document.getElementById('run-btn');
const stepBtn = document.getElementById('step-btn');
const resetBtn = document.getElementById('reset-btn');

const instInput = document.getElementById('instruction-input');
const modelSelect = document.getElementById('pipeline-model');
const fwdSelect = document.getElementById('forwarding-toggle');
const gridBody = document.getElementById('grid-body');
const cycleHeaders = document.getElementById('cycle-headers');
const hazardLog = document.getElementById('hazard-log');
const statusInd = document.getElementById('system-status');
const cycleCount = document.getElementById('cycle-count');

let isLoaded = false;
let isFinished = false;

function formatLogMessage(msg) {
    // Highlight [HAZARD] tags
    let formatted = msg.replace(/^(\[[^\]]+\])/, '<span class="hl-hazard-tag">$1</span>');
    // Highlight registers and instruction IDs
    formatted = formatted.replace(/\b([R\$][a-zA-Z0-9]+|I\d+)\b/g, '<span class="hl-reg">$1</span>');
    return formatted;
}

function initEngine() {
    const rawText = instInput.value;
    const model = modelSelect.value;
    const forwarding = fwdSelect.value;
    engine.load_program(rawText, model, forwarding);
    isLoaded = true;
    isFinished = false;
    
    statusInd.textContent = "ACTIVE";
    statusInd.className = "status-badge active";
    
    render_pipeline();
    render_logs();
}

function render_pipeline() {
    gridBody.innerHTML = '';
    cycleHeaders.innerHTML = '<th>INSTRUCTION</th>';
    
    if (engine.instructions.length === 0) return;

    for (let c = 1; c <= engine.cycle_counter; c++) {
        const th = document.createElement('th');
        th.textContent = `C${c}`;
        cycleHeaders.appendChild(th);
    }

    engine.instructions.forEach((inst, i) => {
        const tr = document.createElement('tr');
        
        const tdLabel = document.createElement('td');
        tdLabel.className = 'inst-label';
        tdLabel.textContent = `${inst.id}: ${inst.raw_text}`;
        tr.appendChild(tdLabel);

        for (let c = 1; c <= engine.cycle_counter; c++) {
            const td = document.createElement('td');
            const state = engine.history[c][i];
            
            if (state && state !== 'RETIRED') {
                const node = document.createElement('div');
                node.className = `node ${state}`;
                node.textContent = state === 'MEM_WB' ? 'MEM/WB' : (state === 'FWD_BYPASS' ? 'FWD' : state);
                td.appendChild(node);
            } else {
                const empty = document.createElement('div');
                empty.className = 'node EMPTY';
                td.appendChild(empty);
            }
            tr.appendChild(td);
        }
        
        gridBody.appendChild(tr);
    });
    
    // Auto-scroll grid to right
    const wrapper = document.querySelector('.grid-scroll');
    if (wrapper) wrapper.scrollLeft = wrapper.scrollWidth;
    
    // Update cycle count
    cycleCount.textContent = engine.cycle_counter;
}

function render_logs() {
    hazardLog.innerHTML = '';
    
    if (engine.hazard_log.length === 0) {
        const p = document.createElement('div');
        p.className = 'log-entry system';
        p.innerHTML = 'No hazards detected in current pipeline state.';
        hazardLog.appendChild(p);
        return;
    }
    
    engine.hazard_log.forEach(msg => {
        const p = document.createElement('div');
        p.className = 'log-entry hazard';
        p.innerHTML = formatLogMessage(msg);
        hazardLog.appendChild(p);
    });
    
    hazardLog.scrollTop = hazardLog.scrollHeight;
}

function markStale() {
    isLoaded = false;
    isFinished = false;
    statusInd.textContent = "STATE CHANGED";
    statusInd.className = "status-badge standby";
}

instInput.addEventListener('input', markStale);
modelSelect.addEventListener('change', markStale);
fwdSelect.addEventListener('change', markStale);

runBtn.addEventListener('click', () => {
    if (!isLoaded || isFinished) {
        initEngine();
    }
    engine.run_all();
    isFinished = true;
    render_pipeline();
    render_logs();
    statusInd.textContent = "FINISHED";
    statusInd.className = "status-badge standby";
});

stepBtn.addEventListener('click', () => {
    if (!isLoaded || isFinished) {
        initEngine();
    }
    
    if (!isFinished) {
        isFinished = engine.execute_cycle();
        render_pipeline();
        render_logs();
        
        if (isFinished) {
            statusInd.textContent = "FINISHED";
            statusInd.className = "status-badge standby";
        }
    }
});

resetBtn.addEventListener('click', () => {
    isLoaded = false;
    isFinished = false;
    engine.load_program("", 5, false);
    render_pipeline();
    hazardLog.innerHTML = '<div class="log-entry system">System state reset.</div>';
    statusInd.textContent = "STANDBY";
    statusInd.className = "status-badge standby";
    cycleCount.textContent = "0";
});

// Initial placeholder text execution
instInput.value = "ADD R1, R2, R3\nSUB R4, R1, R5\nLW R5, 0(R2)";
engine.load_program(instInput.value, modelSelect.value, fwdSelect.value);
isLoaded = true;
render_pipeline();
