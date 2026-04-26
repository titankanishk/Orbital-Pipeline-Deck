class PipelineEngine {
    constructor() {
        this.instructions = [];
        this.cycle_counter = 0;
        this.pipeline_model = 5;
        this.forwarding_enabled = false;
        this.hazard_log = [];
        this.history = []; 
    }

    parse_instruction(raw_text) {
        let normalized = raw_text.toUpperCase().replace(/[,()]/g, ' ').replace(/\s+/g, ' ').trim();
        let parts = normalized.split(' ');
        let opcode = parts[0];
        let dest = null, src1 = null, src2 = null;
        
        if (['ADD', 'SUB', 'AND', 'OR', 'XOR', 'MUL'].includes(opcode)) {
            dest = parts[1];
            src1 = parts[2];
            src2 = parts[3];
        } else if (['ADDI', 'SUBI', 'ANDI', 'ORI', 'XORI'].includes(opcode)) {
            dest = parts[1];
            src1 = parts[2];
            src2 = null; // parts[3] is immediate
        } else if (opcode === 'LW') {
            dest = parts[1];
            src1 = parts[3] ? parts[3] : parts[2];
        } else if (opcode === 'SW') {
            src1 = parts[1];
            src2 = parts[3] ? parts[3] : parts[2];
        }
        return { opcode, dest, src1, src2, raw_text };
    }

    load_program(text, model, forwarding) {
        this.pipeline_model = parseInt(model);
        this.forwarding_enabled = (forwarding === 'true' || forwarding === true);
        this.cycle_counter = 0;
        this.hazard_log = [];
        this.history = [];
        
        let lines = text.split('\n').map(l => l.trim()).filter(l => l);
        this.instructions = lines.slice(0, 10).map((l, i) => {
            let inst = this.parse_instruction(l);
            inst.id = `I${i+1}`;
            return inst;
        });
        
        if (this.instructions.length > 0) {
            this.history[0] = new Array(this.instructions.length).fill(null);
        }
    }

    get_physical_stage(status) {
        if (!status) return null;
        if (status === 'IF') return 'IF';
        if (status === 'ID' || status === 'STALL') return 'ID';
        if (status === 'EX') return 'EX';
        if (status === 'MEM') return 'MEM';
        if (status === 'WB') return 'WB';
        if (status === 'MEM_WB') return 'MEM_WB';
        return null;
    }

    execute_cycle() {
        if (this.instructions.length === 0) return true;

        let next_states = new Array(this.instructions.length).fill(null);
        let current_cycle_states = this.history[this.cycle_counter];
        
        for (let i = 0; i < this.instructions.length; i++) {
            let inst = this.instructions[i];
            let current = current_cycle_states[i];
            
            if (current === null) {
                if (i === 0) {
                    next_states[i] = 'IF';
                } else {
                    let prev_next = next_states[i - 1];
                    if (this.get_physical_stage(prev_next) !== 'IF') {
                        next_states[i] = 'IF';
                    } else {
                        next_states[i] = null;
                    }
                }
            }
            else if (current === 'RETIRED') {
                next_states[i] = 'RETIRED';
            }
            else {
                let physical = this.get_physical_stage(current);
                
                if (physical === 'IF') {
                    // Wants to decode
                    let id_busy = next_states.some(s => this.get_physical_stage(s) === 'ID');

                    if (id_busy) {
                        next_states[i] = 'IF'; // Stay in IF to structurally block others behind
                    } else {
                        next_states[i] = 'ID';
                    }
                } else if (physical === 'ID') {
                    let stall_reason = null;
                    let hazard_log_msg = null;
                    
                    for (let j = i - 1; j >= 0; j--) {
                        let older = this.instructions[j];
                        if (!older.dest) continue;
                    
                        if (inst.src1 === older.dest || inst.src2 === older.dest) {
                            let older_phys = this.get_physical_stage(current_cycle_states[j]);
                            if (current_cycle_states[j] === 'RETIRED') continue;
                    
                            if (!this.forwarding_enabled) {
                                if (older_phys !== 'WB' && older_phys !== 'MEM_WB' && older_phys !== null) {
                                    stall_reason = 'STALL';
                                    hazard_log_msg = `[RAW HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. Pipeline stalled.`;
                                }
                            } else {
                                if (older.opcode === 'LW') {
                                    if (older_phys === 'EX') {
                                        stall_reason = 'STALL'; // load-use hazard
                                        hazard_log_msg = `[LOAD-USE HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. Pipeline stalled.`;
                                    }
                                } else {
                                    if (older_phys === 'ID' || older_phys === 'IF') {
                                        stall_reason = 'STALL';
                                        hazard_log_msg = `[RAW HAZARD] Cycle ${this.cycle_counter + 1}: ${inst.id} requires ${older.dest}. Pipeline stalled.`;
                                    }
                                }
                            }
                        }
                    
                        if (stall_reason) break;
                    }
                    
                    if (stall_reason) {
                        next_states[i] = 'STALL';
                        if (hazard_log_msg && !this.hazard_log.includes(hazard_log_msg)) {
                            this.hazard_log.push(hazard_log_msg);
                        }
                    } else {
                        next_states[i] = 'EX';
                    }
                }
                else if (physical === 'EX') {
                    next_states[i] = this.pipeline_model === 5 ? 'MEM' : 'MEM_WB';
                }
                else if (physical === 'MEM') {
                    next_states[i] = 'WB';
                }
                else if (physical === 'WB' || physical === 'MEM_WB') {
                    next_states[i] = 'RETIRED';
                }
            }
        }
        
        let really_all_retired = next_states.every(s => s === 'RETIRED');
        
        this.cycle_counter++;
        this.history[this.cycle_counter] = next_states;
        
        return really_all_retired;
    }

    run_all() {
        if (this.instructions.length === 0) return;
        let max_cycles = 50;
        while (this.cycle_counter < max_cycles) {
            let done = this.execute_cycle();
            if (done) break;
        }
    }
}
const fs = require('fs');
const content = fs.readFileSync('pipeline.js', 'utf8');
eval(content);

function runTest(testName, program, model) {
    console.log(`\n=== ${testName} ===`);
    let p = new PipelineEngine();
    
    p.load_program(program, model, false);
    p.run_all();
    console.log('Without Forwarding');
    console.log('Cycle ' + Array.from({length: p.cycle_counter}, (_,i)=>i+1).join(' '));
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' '));
    });

    p.load_program(program, model, true);
    p.run_all();
    console.log('With Forwarding');
    console.log('Cycle ' + Array.from({length: p.cycle_counter}, (_,i)=>i+1).join(' '));
    p.instructions.forEach((inst, i) => {
        let stages = p.history.map(h => h[i] ? h[i] : '  ').filter((_, cycle) => cycle > 0);
        console.log(inst.id + ' ' + stages.join(' '));
    });
}

runTest("Test Case 1", "add $t0, $t1, $t2\nsub $t3, $t0, $t4", 4);
runTest("Test Case 2", "add $t0, $t1, $t2\nand $t5, $t6, $t7\nsub $t3, $t0, $t4", 4);
runTest("Test Case 3", "lw $t0, 0($t1)\nadd $t2, $t0, $t3", 4);
runTest("Test Case 4", "lw $t0, 0($t1)\nori $t5, $t6, 7\nadd $t2, $t0, $t3", 4);
runTest("Test Case 5", "add $t0, $t1, $t2\nadd $t0, $t0, $t3\nsub $t4, $t0, $t5", 4);
runTest("Test Case 6", "add $t0, $t1, $t2\nsw $t0, 0($t3)", 4);
